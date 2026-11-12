import { displayTonnes } from "./collection-weights";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "crypto";
import * as QRCode from "qrcode";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "../common/current-user.decorator";
import {
  CollectionGpTripDto,
  CollectionWeightCorrectionDto,
  CollectionFactoryDto,
  CollectionProductionDto,
  CollectionShipmentDto,
  CollectionTripDto,
  CollectionWashDto,
} from "./collection.dto";
import { readDriverRoute } from "./collection-route";
type Tx = Prisma.TransactionClient;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function assertCollectionDatabase() {
  if (process.env.COLLECTION_ENABLED !== "true")
    throw new NotFoundException("Рабочий контур Collection не включён");
  const name = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
  if (
    !name.startsWith("collection_") ||
    (process.env.COLLECTION_DATABASE_NAME &&
      name !== process.env.COLLECTION_DATABASE_NAME)
  )
    throw new Error(
      "Collection requires its own collection_* database; legacy database access refused",
    );
}
export function kg(value: string) {
  if (!/^\d{1,10}(\.\d{1,3})?$/.test(value))
    throw new BadRequestException("Некорректный вес");
  const result = new Prisma.Decimal(value);
  if (result.lte(0))
    throw new BadRequestException("Вес должен быть больше нуля");
  return result;
}
@Injectable()
export class CollectionService {
  constructor(readonly db: PrismaService) {}
  owner(user: CurrentUser) {
    return (
      user.roles?.some((role) => ["OWNER", "ADMIN"].includes(role)) ?? false
    );
  }
  require(user: CurrentUser, roles: string[] = []) {
    assertCollectionDatabase();
    if (!this.owner(user) && !user.roles?.some((role) => roles.includes(role)))
      throw new ForbiddenException("Нет доступа к операции");
  }
  async location(
    tx: Tx,
    id: string,
    user: CurrentUser,
    kind: "WAREHOUSE" | "FACTORY",
  ) {
    const location = await tx.collectionLocation.findFirst({
      where: { id, organizationId: user.organizationId, kind, active: true },
    });
    if (!location) throw new NotFoundException("Объект не найден");
    this.require(user, [
      kind === "WAREHOUSE" ? "WAREHOUSE_MANAGER" : "FACTORY_MANAGER",
    ]);
    if (
      !this.owner(user) &&
      !(await tx.collectionMembership.findUnique({
        where: { userId_locationId: { userId: user.id, locationId: id } },
      }))
    )
      throw new ForbiddenException("Вам не назначен этот объект");
    await tx.$queryRaw`SELECT id FROM "CollectionLocation" WHERE id = ${id} FOR UPDATE`;
    return location;
  }
  async command(
    user: CurrentUser,
    key: string,
    action: string,
    input: unknown,
    apply: (tx: Tx) => Promise<unknown>,
  ) {
    const fingerprint = hash(
      JSON.stringify({ action, input, actorId: user.id }),
    );
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.organizationId + ":" + key}, 0))`;
        const previous = await tx.collectionCommand.findUnique({
          where: {
            organizationId_key: { organizationId: user.organizationId, key },
          },
        });
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new ConflictException(
              "Ключ операции уже использован с другими данными",
            );
          return previous.response;
        }
        const result = json(await apply(tx));
        await tx.collectionCommand.create({
          data: {
            organizationId: user.organizationId,
            key,
            fingerprint,
            response: result,
          },
        });
        return result;
      },
      { timeout: 15000 },
    );
  }
  async correctTripWeight(
    id: string,
    dto: CollectionWeightCorrectionDto,
    user: CurrentUser,
  ) {
    this.require(user);
    const revised = kg(dto.weightKg);
    const expected = kg(dto.expectedWeightKg);
    return this.command(
      user,
      dto.idempotencyKey,
      "trip.weight.correct",
      { id, ...dto },
      async (tx) => {
        const trip = await tx.collectionTrip.findFirst({
          where: { id, organizationId: user.organizationId, kind: "RAW" },
        });
        if (!trip || trip.status === "CANCELLED")
          throw new NotFoundException("Отправка не найдена");
        await this.location(tx, trip.warehouseId!, user, "WAREHOUSE");
        await tx.$queryRaw`SELECT id FROM "CollectionTrip" WHERE id = ${id} FOR UPDATE`;
        const current = await tx.collectionTrip.findUniqueOrThrow({
          where: { id },
        });
        if (!current.weightKg.eq(expected))
          throw new ConflictException("Вес уже изменён; обновите отправку");
        const delta = revised.minus(current.weightKg);
        if (delta.isZero()) throw new BadRequestException("Укажите новый вес");
        const batch = await tx.collectionBatch.findUnique({
          where: {
            organizationId_sourceType_sourceId_state: {
              organizationId: user.organizationId,
              sourceType: "TRIP",
              sourceId: id,
              state: "RAW",
            },
          },
        });
        if (batch) {
          const remaining =
            batch.status === "ACTIVE"
              ? batch.remainingKg.plus(delta)
              : batch.remainingKg;
          if (remaining.lt(0))
            throw new ConflictException(
              "Нельзя уменьшить вес ниже уже использованного сырья",
            );
          await tx.collectionBatch.update({
            where: { id: batch.id },
            data: { totalKg: revised, remainingKg: remaining },
          });
        }
        const result = await tx.collectionTrip.update({
          where: { id },
          data: { weightKg: revised },
        });
        const details = {
          tripId: id,
          previousWeightKg: current.weightKg.toString(),
          weightKg: revised.toString(),
          reason: dto.reason,
        };
        await tx.collectionAction.create({
          data: {
            organizationId: user.organizationId,
            locationId: trip.warehouseId!,
            kind: "WEIGHT_CORRECTION",
            quantityKg:
              current.status === "ACCEPTED" ? delta : new Prisma.Decimal(0),
            createdById: user.id,
            details,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            action: "collection.trip.weight.correct",
            entity: "CollectionTrip",
            entityId: id,
            newValue: details,
            reason: dto.reason,
          },
        });
        await this.notify(
          tx,
          user.organizationId,
          [trip.createdById, ...(await this.managers(tx, trip.warehouseId!))],
          "Исправлен вес отправки",
          `${trip.number}: вес исправлен с ${displayTonnes(current.weightKg)} т на ${displayTonnes(revised)} т. ${dto.reason}`,
          "COLLECTION_WEIGHT_CORRECTED",
          { section: "inbound", entityId: id, locationId: trip.warehouseId! },
        );
        return result;
      },
    );
  }
  async notify(
    tx: Tx,
    organizationId: string,
    recipients: string[],
    title: string,
    body: string,
    type = "COLLECTION_EVENT",
    link?: { section: string; entityId: string; locationId?: string },
  ) {
    const owners = await tx.user.findMany({
      where: {
        organizationId,
        isBlocked: false,
        userRoles: { some: { role: { code: { in: ["OWNER", "ADMIN"] } } } },
      },
      select: { id: true },
    });
    const location = link?.locationId
      ? await tx.collectionLocation.findFirst({
          where: { id: link.locationId, organizationId },
          select: { name: true },
        })
      : null;
    const contextualBody = location ? `${location.name}: ${body}` : body;
    for (const userId of [
      ...new Set([...recipients, ...owners.map((owner) => owner.id)]),
    ]) {
      if (
        !(await tx.user.findFirst({
          where: { id: userId, organizationId, isBlocked: false },
        }))
      )
        continue;
      const notice = await tx.notification.create({
        data: { organizationId, userId, title, body: contextualBody, type },
      });
      if (link)
        await tx.collectionNoticeLink.create({
          data: { notificationId: notice.id, ...link },
        });
      const devices = await tx.device.findMany({
        where: { userId, pushToken: { not: null } },
      });
      for (const device of devices)
        await tx.pushDelivery.create({
          data: { notificationId: notice.id, deviceId: device.id },
        });
    }
  }
  async managers(tx: Tx, locationId: string) {
    return (
      await tx.collectionMembership.findMany({
        where: { locationId },
        select: { userId: true },
      })
    ).map((member) => member.userId);
  }
  async consume(
    tx: Tx,
    user: CurrentUser,
    locationId: string,
    state: string,
    quantity: Prisma.Decimal,
  ) {
    const batches = await tx.collectionBatch.findMany({
      where: {
        organizationId: user.organizationId,
        locationId,
        state,
        status: "ACTIVE",
        remainingKg: { gt: 0 },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const available = batches.reduce(
      (total, batch) => total.plus(batch.remainingKg),
      new Prisma.Decimal(0),
    );
    if (available.lt(quantity))
      throw new ConflictException(
        `Недостаточно сырья: доступно ${displayTonnes(available.toString())} т`,
      );
    let remaining = quantity;
    const consumed: { batchId: string; weightKg: string }[] = [];
    for (const batch of batches) {
      if (remaining.isZero()) break;
      const amount = Prisma.Decimal.min(batch.remainingKg, remaining);
      await tx.collectionBatch.update({
        where: { id: batch.id },
        data: { remainingKg: { decrement: amount } },
      });
      consumed.push({ batchId: batch.id, weightKg: amount.toString() });
      remaining = remaining.minus(amount);
    }
    return consumed;
  }
  createTrip(dto: CollectionTripDto, user: CurrentUser) {
    this.require(user, ["COLLECTOR"]);
    const weightKg = kg(dto.weightKg);
    return this.command(
      user,
      dto.idempotencyKey,
      "trip.create",
      dto,
      async (tx) => {
        const warehouse = await tx.collectionLocation.findFirst({
          where: {
            id: dto.warehouseId,
            organizationId: user.organizationId,
            kind: "WAREHOUSE",
            active: true,
          },
        });
        if (!warehouse)
          throw new BadRequestException("Выберите склад назначения");
        const token = randomBytes(32).toString("base64url");
        const trip = await tx.collectionTrip.create({
          data: {
            organizationId: user.organizationId,
            number: `C-${randomUUID().slice(0, 18).toUpperCase()}`,
            createdById: user.id,
            warehouseId: warehouse.id,
            bagCount: dto.bagCount,
            weightKg,
            qrTokenHash: hash(token),
          },
        });
        await this.notify(
          tx,
          user.organizationId,
          [user.id, ...(await this.managers(tx, warehouse.id))],
          "Сборщик создал отправку",
          `${trip.number}: на ${warehouse.name}, ${trip.bagCount} мешков, общий вес ${displayTonnes(weightKg)} т. QR готов.`,
          "COLLECTION_TRIP_CREATED",
          { section: "inbound", entityId: trip.id, locationId: warehouse.id },
        );
        // A QR is shown to the creator only; its hash never appears in list APIs.
        return {
          id: trip.id,
          number: trip.number,
          warehouse: warehouse.name,
          bagCount: trip.bagCount,
          weightKg: trip.weightKg,
          qrToken: token,
          qrImage: await QRCode.toDataURL(token, { width: 720, margin: 3 }),
        };
      },
    );
  }
  confirmTrip(id: string, key: string, user: CurrentUser) {
    this.require(user, ["WAREHOUSE_MANAGER"]);
    return this.command(user, key, "trip.confirm", { id }, async (tx) => {
      const trip = await tx.collectionTrip.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!trip) throw new NotFoundException();
      if (trip.kind !== "RAW" || !trip.warehouseId)
        throw new BadRequestException(
          "Эта доставка не является приходом сырья",
        );
      await this.location(tx, trip.warehouseId, user, "WAREHOUSE");
      await tx.$queryRaw`SELECT id FROM "CollectionTrip" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.collectionTrip.findUniqueOrThrow({
        where: { id },
      });
      if (current.status !== "ARRIVED")
        throw new ConflictException(
          "Приёмка доступна после отметки водителя «Прибыл»",
        );
      const pending = await tx.collectionBatch.findUniqueOrThrow({
        where: {
          organizationId_sourceType_sourceId_state: {
            organizationId: user.organizationId,
            sourceType: "TRIP",
            sourceId: id,
            state: "RAW",
          },
        },
      });
      await tx.collectionBatch.update({
        where: { id: pending.id },
        data: { status: "ACTIVE", remainingKg: current.weightKg },
      });
      await tx.collectionTrip.update({
        where: { id },
        data: {
          status: "ACCEPTED",
          confirmedAt: new Date(),
          confirmedById: user.id,
        },
      });
      await tx.collectionAction.create({
        data: {
          organizationId: user.organizationId,
          locationId: trip.warehouseId,
          kind: "RAW_RECEIPT",
          quantityKg: trip.weightKg,
          createdById: user.id,
          details: { tripId: id, batchId: pending.id },
        },
      });
      await this.notify(
        tx,
        user.organizationId,
        [trip.createdById, ...(await this.managers(tx, trip.warehouseId))],
        "Склад подтвердил приход",
        `${trip.number}: принято ${displayTonnes(trip.weightKg)} т немытого сырья, ${trip.bagCount} мешков.`,
        "COLLECTION_RAW_ACCEPTED",
        { section: "inbound", entityId: trip.id, locationId: trip.warehouseId },
      );
      return { confirmed: true, batchId: pending.id };
    });
  }
  wash(dto: CollectionWashDto, user: CurrentUser) {
    this.require(user, ["WAREHOUSE_MANAGER"]);
    const weightKg = kg(dto.weightKg);
    return this.command(user, dto.idempotencyKey, "wash", dto, async (tx) => {
      await this.location(tx, dto.locationId, user, "WAREHOUSE");
      const consumed = await this.consume(
        tx,
        user,
        dto.locationId,
        "RAW",
        weightKg,
      );
      const action = await tx.collectionAction.create({
        data: {
          organizationId: user.organizationId,
          locationId: dto.locationId,
          kind: "WASH",
          quantityKg: weightKg,
          createdById: user.id,
          details: json({ consumed }),
        },
      });
      const batch = await tx.collectionBatch.create({
        data: {
          organizationId: user.organizationId,
          locationId: dto.locationId,
          state: "WASHED",
          totalKg: weightKg,
          remainingKg: weightKg,
          sourceType: "WASH",
          sourceId: action.id,
          createdById: user.id,
        },
      });
      await this.notify(
        tx,
        user.organizationId,
        [user.id, ...(await this.managers(tx, dto.locationId))],
        "Мойка перевела сырьё в мытое",
        `${displayTonnes(weightKg)} т переведено из немытого в мытое сырьё.`,
        "COLLECTION_WASH",
        {
          section: "stock",
          entityId: dto.locationId,
          locationId: dto.locationId,
        },
      );
      return { id: action.id, batchId: batch.id, washedKg: weightKg };
    });
  }
  shipment(dto: CollectionShipmentDto, user: CurrentUser) {
    this.require(user, ["WAREHOUSE_MANAGER"]);
    const weightKg = kg(dto.weightKg);
    return this.command(
      user,
      dto.idempotencyKey,
      "shipment.create",
      dto,
      async (tx) => {
        await this.location(tx, dto.locationId, user, "WAREHOUSE");
        const factory = await tx.collectionLocation.findFirst({
          where: {
            id: dto.factoryId,
            organizationId: user.organizationId,
            kind: "FACTORY",
            active: true,
          },
        });
        if (!factory) throw new BadRequestException("Выберите завод");
        const consumed = await this.consume(
          tx,
          user,
          dto.locationId,
          "WASHED",
          weightKg,
        );
        const shipment = await tx.collectionShipment.create({
          data: {
            organizationId: user.organizationId,
            number: `F-${randomUUID().slice(0, 18).toUpperCase()}`,
            fromLocationId: dto.locationId,
            toLocationId: factory.id,
            bagCount: dto.bagCount,
            weightKg,
            averageBagKg: weightKg.div(dto.bagCount).toDecimalPlaces(3),
            createdById: user.id,
          },
        });
        await tx.collectionAction.create({
          data: {
            organizationId: user.organizationId,
            locationId: dto.locationId,
            kind: "FACTORY_SHIPMENT",
            quantityKg: weightKg,
            createdById: user.id,
            details: json({ shipmentId: shipment.id, consumed }),
          },
        });
        await this.notify(
          tx,
          user.organizationId,
          [
            user.id,
            ...(await this.managers(tx, factory.id)),
            ...(await this.managers(tx, dto.locationId)),
          ],
          "Отправлено мытое сырьё",
          `${shipment.number}: ${shipment.bagCount} бигбегов, ${displayTonnes(weightKg)} т. Средний вес бигбега ${displayTonnes(shipment.averageBagKg)} т. Подтвердите приход после получения.`,
          "COLLECTION_FACTORY_SHIPMENT",
          {
            section: "factory-inbound",
            entityId: shipment.id,
            locationId: factory.id,
          },
        );
        return shipment;
      },
    );
  }
  confirmShipment(id: string, key: string, user: CurrentUser) {
    this.require(user, ["FACTORY_MANAGER"]);
    return this.command(user, key, "shipment.confirm", { id }, async (tx) => {
      const shipment = await tx.collectionShipment.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!shipment) throw new NotFoundException();
      await this.location(tx, shipment.toLocationId, user, "FACTORY");
      await tx.$queryRaw`SELECT id FROM "CollectionShipment" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.collectionShipment.findUniqueOrThrow({
        where: { id },
      });
      if (current.status !== "IN_TRANSIT")
        throw new ConflictException("Приход уже подтверждён");
      const batch = await tx.collectionBatch.create({
        data: {
          organizationId: user.organizationId,
          locationId: shipment.toLocationId,
          state: "WASHED",
          totalKg: shipment.weightKg,
          remainingKg: shipment.weightKg,
          bagCount: shipment.bagCount,
          sourceType: "SHIPMENT",
          sourceId: id,
          createdById: user.id,
        },
      });
      await tx.collectionShipment.update({
        where: { id },
        data: {
          status: "ACCEPTED",
          confirmedById: user.id,
          confirmedAt: new Date(),
        },
      });
      await tx.collectionAction.create({
        data: {
          organizationId: user.organizationId,
          locationId: shipment.toLocationId,
          kind: "FACTORY_RECEIPT",
          quantityKg: shipment.weightKg,
          createdById: user.id,
          details: { shipmentId: id, batchId: batch.id },
        },
      });
      await this.notify(
        tx,
        user.organizationId,
        [
          shipment.createdById,
          ...(await this.managers(tx, shipment.fromLocationId)),
          ...(await this.managers(tx, shipment.toLocationId)),
        ],
        "Завод подтвердил приход",
        `${shipment.number}: принято ${displayTonnes(shipment.weightKg)} т, ${shipment.bagCount} бигбегов.`,
        "COLLECTION_FACTORY_ACCEPTED",
        {
          section: "factory-inbound",
          entityId: shipment.id,
          locationId: shipment.toLocationId,
        },
      );
      return { confirmed: true, batchId: batch.id };
    });
  }
  production(dto: CollectionProductionDto, user: CurrentUser) {
    this.require(user, ["FACTORY_MANAGER"]);
    const finished = dto.finished.map((b) => kg(b.weightKg));
    const rejected = dto.rejected.map((b) => kg(b.weightKg));
    const sum = (items: Prisma.Decimal[]) =>
      items.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));
    const finishedKg = sum(finished),
      rejectedKg = sum(rejected),
      total = finishedKg.plus(rejectedKg);
    if (total.lte(0))
      throw new BadRequestException(
        "Добавьте хотя бы один бигбег ГП или некондиции",
      );
    return this.command(
      user,
      dto.idempotencyKey,
      "production",
      dto,
      async (tx) => {
        await this.location(tx, dto.locationId, user, "FACTORY");
        const consumed = await this.consume(
          tx,
          user,
          dto.locationId,
          "WASHED",
          total,
        );
        const action = await tx.collectionAction.create({
          data: {
            organizationId: user.organizationId,
            locationId: dto.locationId,
            kind: "PRODUCTION",
            quantityKg: total,
            createdById: user.id,
            details: json({
              consumed,
              finished,
              rejected,
              finishedKg,
              rejectedKg,
            }),
          },
        });
        for (const [state, weights] of [
          ["FINISHED", finished],
          ["REJECT", rejected],
        ] as const) {
          if (!weights.length) continue;
          const quantity = sum([...weights]);
          const batch = await tx.collectionBatch.create({
            data: {
              organizationId: user.organizationId,
              locationId: dto.locationId,
              state,
              totalKg: quantity,
              remainingKg: quantity,
              bagCount: weights.length,
              bagWeights: json(weights),
              sourceType: "PRODUCTION",
              sourceId: action.id,
              createdById: user.id,
            },
          });
          await tx.collectionBag.createMany({
            data: weights.map((weight, index) => ({
              batchId: batch.id,
              index: index + 1,
              weightKg: weight,
            })),
          });
        }
        const firstBatch = await tx.collectionBatch.findFirstOrThrow({
          where: { sourceType: "PRODUCTION", sourceId: action.id },
        });
        await this.notify(
          tx,
          user.organizationId,
          [user.id, ...(await this.managers(tx, dto.locationId))],
          "Завод выпустил ГП и некондицию",
          `ГП: ${finished.length} бигбегов, ${displayTonnes(finishedKg)} т. Некондиция: ${rejected.length} бигбегов, ${displayTonnes(rejectedKg)} т. Из мытого сырья списано ${displayTonnes(total)} т.`,
          "COLLECTION_PRODUCTION",
          {
            section: "production",
            entityId: firstBatch.id,
            locationId: dto.locationId,
          },
        );
        return { id: action.id, finishedKg, rejectedKg, consumedKg: total };
      },
    );
  }
  gpTrip(dto: CollectionGpTripDto, user: CurrentUser) {
    this.require(user, ["FACTORY_MANAGER"]);
    if (new Set(dto.bagIds).size !== dto.bagIds.length)
      throw new BadRequestException("Бигбег выбран дважды");
    return this.command(
      user,
      dto.idempotencyKey,
      "gp-trip.create",
      dto,
      async (tx) => {
        await this.location(tx, dto.locationId, user, "FACTORY");
        const bags = await tx.collectionBag.findMany({
          where: {
            id: { in: dto.bagIds },
            status: "AVAILABLE",
            batch: {
              organizationId: user.organizationId,
              locationId: dto.locationId,
              state: "FINISHED",
              status: "ACTIVE",
            },
          },
        });
        if (bags.length !== dto.bagIds.length)
          throw new ConflictException(
            "Некоторые бигбеги уже отправлены или недоступны",
          );
        const weightKg = bags.reduce(
          (sum, bag) => sum.plus(bag.weightKg),
          new Prisma.Decimal(0),
        );
        const token = randomBytes(32).toString("base64url");
        const trip = await tx.collectionTrip.create({
          data: {
            organizationId: user.organizationId,
            kind: "GP",
            number: `GP-${randomUUID().slice(0, 18).toUpperCase()}`,
            createdById: user.id,
            fromLocationId: dto.locationId,
            recipientName: dto.recipientName.trim(),
            recipientAddress: dto.recipientAddress.trim(),
            bagCount: bags.length,
            weightKg,
            qrTokenHash: hash(token),
          },
        });
        for (const bag of bags) {
          await tx.collectionBag.update({
            where: { id: bag.id },
            data: { status: "IN_TRANSIT", tripId: trip.id },
          });
          await tx.collectionBatch.update({
            where: { id: bag.batchId },
            data: { remainingKg: { decrement: bag.weightKg } },
          });
        }
        await tx.collectionAction.create({
          data: {
            organizationId: user.organizationId,
            locationId: dto.locationId,
            kind: "GP_SHIPMENT",
            quantityKg: weightKg,
            createdById: user.id,
            details: json({
              tripId: trip.id,
              bagIds: dto.bagIds,
              recipientName: dto.recipientName,
              recipientAddress: dto.recipientAddress,
            }),
          },
        });
        await this.notify(
          tx,
          user.organizationId,
          [user.id, ...(await this.managers(tx, dto.locationId))],
          "Завод создал доставку ГП",
          `${trip.number}: ${trip.bagCount} бигбегов, ${displayTonnes(weightKg)} т → ${dto.recipientName}, ${dto.recipientAddress}. QR готов.`,
          "COLLECTION_GP_SHIPMENT",
          { section: "gp", entityId: trip.id, locationId: dto.locationId },
        );
        return {
          id: trip.id,
          number: trip.number,
          warehouse: `${dto.recipientName}, ${dto.recipientAddress}`,
          bagCount: trip.bagCount,
          weightKg,
          qrToken: token,
          qrImage: await QRCode.toDataURL(token, { width: 720, margin: 3 }),
        };
      },
    );
  }
  async qr(id: string, user: CurrentUser) {
    this.require(user, ["COLLECTOR", "FACTORY_MANAGER"]);
    const trip = await this.db.collectionTrip.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        ...(this.owner(user) ? {} : { createdById: user.id }),
      },
    });
    if (!trip) throw new NotFoundException();
    const responses = await this.db.collectionCommand.findMany({
      where: {
        organizationId: user.organizationId,
        response: { path: ["id"], equals: id },
      },
    });
    const saved = responses.find(
      ({ response }) =>
        response &&
        typeof response === "object" &&
        !Array.isArray(response) &&
        typeof response.qrToken === "string" &&
        typeof response.qrImage === "string",
    );
    if (!saved) throw new NotFoundException("QR не найден");
    return {
      ...(saved.response as Record<string, Prisma.JsonValue>),
      weightKg: trip.weightKg.toString(),
      bagCount: trip.bagCount,
      status: trip.status,
    };
  }
  factory(dto: CollectionFactoryDto, user: CurrentUser) {
    this.require(user);
    return this.command(
      user,
      dto.idempotencyKey,
      "factory.create",
      dto,
      async (tx) => {
        const factory = await tx.collectionLocation.create({
          data: {
            organizationId: user.organizationId,
            code: `FACTORY-${randomUUID()}`,
            kind: "FACTORY",
            name: dto.name.trim(),
          },
        });
        await this.notify(
          tx,
          user.organizationId,
          [user.id],
          "Добавлен завод",
          factory.name,
          "COLLECTION_FACTORY_CREATED",
          { section: "stock", entityId: factory.id, locationId: factory.id },
        );
        return factory;
      },
    );
  }
  async route(id: string, user: CurrentUser, cursor?: string) {
    this.require(user, ["COLLECTOR", "WAREHOUSE_MANAGER", "FACTORY_MANAGER"]);
    const trip = await this.db.collectionTrip.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { driver: { select: { id: true } } },
    });
    if (!trip) throw new NotFoundException("Рейс не найден");
    if (
      !this.owner(user) &&
      !(user.roles?.includes("COLLECTOR") && trip.createdById === user.id)
    ) {
      const scope = [trip.warehouseId, trip.fromLocationId].filter(
        (x): x is string => !!x,
      );
      const member = await this.db.collectionMembership.findFirst({
        where: { userId: user.id, locationId: { in: scope } },
      });
      if (!member)
        throw new ForbiddenException("Нет доступа к маршруту этого рейса");
    }
    if (!trip.driver) return { points: [], total: 0, nextCursor: null };
    return readDriverRoute(this.db, trip.driver.id, cursor);
  }
  async state(user: CurrentUser) {
    this.require(user, ["COLLECTOR", "WAREHOUSE_MANAGER", "FACTORY_MANAGER"]);
    const owner = this.owner(user);
    const collector = user.roles?.includes("COLLECTOR") ?? false;
    const memberships = await this.db.collectionMembership.findMany({
      where: { userId: user.id },
      select: { locationId: true },
    });
    const assigned = memberships.map((m) => m.locationId);
    const visible = owner ? undefined : assigned;
    const locations = await this.db.collectionLocation.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: [{ kind: "desc" }, { name: "asc" }],
    });
    const tripScope: Prisma.CollectionTripWhereInput = {
      organizationId: user.organizationId,
      ...(owner
        ? {}
        : {
            OR: [
              ...(collector ? [{ createdById: user.id }] : []),
              { warehouseId: { in: assigned } },
              { fromLocationId: { in: assigned } },
            ],
          }),
    };
    const shipmentScope = {
      organizationId: user.organizationId,
      ...(owner
        ? {}
        : {
            OR: [
              { fromLocationId: { in: assigned } },
              { toLocationId: { in: assigned } },
            ],
          }),
    };
    const [trips, tripTotal, shipments, stock, batches, actions, users] =
      await Promise.all([
        this.db.collectionTrip.findMany({
          where: tripScope,
          orderBy: { createdAt: "desc" },
          include: {
            driver: {
              include: { points: { orderBy: { recordedAt: "desc" }, take: 1 } },
            },
          },
        }),
        this.db.collectionTrip.aggregate({
          where: tripScope,
          _sum: { weightKg: true, bagCount: true },
          _count: true,
        }),
        this.db.collectionShipment.findMany({
          where: shipmentScope,
          orderBy: { createdAt: "desc" },
        }),
        this.db.collectionBatch.groupBy({
          by: ["locationId", "state"],
          where: {
            organizationId: user.organizationId,
            status: "ACTIVE",
            ...(visible ? { locationId: { in: visible } } : {}),
          },
          _sum: { remainingKg: true, bagCount: true },
        }),
        this.db.collectionBatch.findMany({
          where: {
            organizationId: user.organizationId,
            ...(visible ? { locationId: { in: visible } } : {}),
          },
          orderBy: { createdAt: "desc" },
          include: { bags: { orderBy: { index: "asc" } } },
        }),
        this.db.collectionAction.findMany({
          where: {
            organizationId: user.organizationId,
            ...(visible ? { locationId: { in: visible } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
        this.db.user.findMany({
          where: {
            organizationId: user.organizationId,
            ...(owner
              ? {}
              : {
                  id: {
                    in: [
                      user.id,
                      ...(
                        await this.db.collectionTrip.findMany({
                          where: tripScope,
                          select: { createdById: true },
                        })
                      ).map((t) => t.createdById),
                    ],
                  },
                }),
          },
          select: {
            id: true,
            fullName: true,
            phone: true,
            userRoles: {
              select: { role: { select: { code: true, name: true } } },
            },
          },
        }),
      ]);
    const factoryOpenings = await this.db.systemSetting.findMany({
      where: {
        organizationId: user.organizationId,
        key: { startsWith: "collection.factory-opening." },
      },
    });
    return {
      factoryOpenings: factoryOpenings
        .map((row) => row.value)
        .filter((row: any) => owner || assigned.includes(row.locationId)),
      locations: locations.filter(
        (l) =>
          owner ||
          (collector && l.kind === "WAREHOUSE") ||
          assigned.includes(l.id) ||
          l.kind === "FACTORY",
      ),
      assignedLocationIds: assigned,
      stock,
      batches,
      actions,
      shipments,
      users,
      trips: trips.map(({ qrTokenHash: _, driver, ...trip }) => ({
        ...trip,
        driver: driver
          ? {
              driverPlate: driver.driverPlate,
              driverPhone: driver.driverPhone,
              expiresAt: driver.expiresAt,
              stoppedAt: driver.stoppedAt,
              point: driver.points[0] ?? null,
            }
          : null,
      })),
      totals: tripTotal,
    };
  }
}
