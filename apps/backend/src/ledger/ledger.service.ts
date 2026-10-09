import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import * as QRCode from "qrcode";
import { CurrentUser } from "../common/current-user.decorator";
import { nextDocumentNumber as nextSequence } from "../common/document-numbers";
import { createdAtRange } from "../common/date-range";
import { PrismaService } from "../prisma/prisma.service";
import {
  AccessDto,
  BatchDto,
  CommandDto,
  LedgerQuery,
  LoadingDto,
  OperationDto,
  ReasonDto,
  ReceiptDto,
  StatusDto,
  TripDto,
} from "./ledger.dto";
import {
  allowed,
  mass,
  net,
  operationPermission,
  scopedBatch,
} from "./ledger-policy";

type Tx = Prisma.TransactionClient;
const nextDocumentNumber = async (tx: Tx, org: string, code: string) =>
  `${org}-${await nextSequence(tx, org, code)}`;
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value));
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private async command(
    user: CurrentUser,
    name: string,
    dto: CommandDto,
    fn: (tx: Tx) => Promise<unknown>,
  ) {
    if (!dto.idempotencyKey?.trim())
      throw new BadRequestException("Нужен ключ повторного запроса");
    const fingerprint = hash(canonical({ name, dto }));
    const key = `${user.id}:${dto.idempotencyKey}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const saved = await tx.commandReceipt.findUnique({
              where: {
                organizationId_key: {
                  organizationId: user.organizationId,
                  key,
                },
              },
            });
            if (saved) {
              if (saved.fingerprint !== fingerprint)
                throw new ConflictException(
                  "Ключ уже использован для другой команды",
                );
              const result = saved.response as { id?: string };
              if (result.id && name.startsWith("batch."))
                await this.batch(tx, result.id, user);
              if (result.id && name.startsWith("trip."))
                await this.trip(tx, result.id, user);
              if (result.id && name.startsWith("operation.")) {
                const op = await tx.batchOperation.findFirst({
                  where: { id: result.id, organizationId: user.organizationId },
                  include: { inputs: true },
                });
                if (!op) throw new NotFoundException("Операция недоступна");
                this.require(user, operationPermission(op.kind));
                if (op.fromWarehouseId)
                  await this.warehouse(tx, op.fromWarehouseId, user);
                if (op.toWarehouseId)
                  await this.warehouse(tx, op.toWarehouseId, user);
                for (const input of op.inputs)
                  await this.batch(tx, input.batchId, user);
              }
              return saved.response;
            }
            const result = json(await fn(tx));
            await tx.commandReceipt.create({
              data: {
                organizationId: user.organizationId,
                key,
                fingerprint,
                response: result,
              },
            });
            return result;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 20_000,
          },
        );
      } catch (e) {
        const retryable =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          (["P2034", "P2002"].includes(e.code) ||
            (e.code === "P2010" &&
              ["40001", "40P01"].includes(String(e.meta?.code))));
        if (retryable && attempt < 4) continue;
        if (retryable)
          throw new ConflictException(
            "Повторите операцию после параллельного изменения",
          );
        throw e;
      }
    }
    throw new ConflictException(
      "Повторите операцию после параллельного изменения",
    );
  }

  private require(user: CurrentUser, permission: string) {
    if (!user.permissions.includes(permission))
      throw new ForbiddenException("Недостаточно прав");
  }
  private reason(reason?: string) {
    if (!reason?.trim()) throw new BadRequestException("Укажите причину");
  }
  private async warehouse(tx: Tx, id: string, user: CurrentUser) {
    allowed(user, id);
    const warehouse = await tx.warehouse.findFirst({
      where: { id, organizationId: user.organizationId, archivedAt: null },
    });
    if (!warehouse) throw new NotFoundException("Склад не найден");
    return warehouse;
  }
  private async batch(tx: Tx, id: string, user: CurrentUser) {
    const batch = await tx.materialBatch.findFirst({
      where: { id, ...scopedBatch(user) },
    });
    if (!batch) throw new NotFoundException("Партия не найдена или недоступна");
    return batch;
  }
  private async trip(tx: Tx, id: string, user: CurrentUser) {
    const trip = await tx.waybill.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        batchId: { not: null },
      },
      include: { batch: true, vehicle: true },
    });
    if (!trip || !trip.batch)
      throw new NotFoundException("Перевозка не найдена");
    if (!user.accessAllObjects) {
      if (
        user.counterpartyScopeId &&
        trip.counterpartyId !== user.counterpartyScopeId
      )
        throw new NotFoundException("Перевозка не найдена");
      if (
        !(user.warehouseScopeIds ?? []).includes(trip.destinationWarehouseId) &&
        !(user.extractionScopeIds ?? []).includes(trip.extractionSiteId)
      )
        throw new NotFoundException("Перевозка не найдена");
    }
    return trip;
  }
  private async audit(
    tx: Tx,
    user: CurrentUser,
    action: string,
    entity: string,
    entityId: string,
    oldValue: unknown,
    newValue: unknown,
    reason?: string,
  ) {
    await tx.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        deviceId: user.deviceId,
        action,
        entity,
        entityId,
        oldValue: json(oldValue ?? {}),
        newValue: json(newValue ?? {}),
        reason,
      },
    });
  }
  private async notice(
    tx: Tx,
    user: CurrentUser,
    type: string,
    title: string,
    body: string,
    scope: { warehouseIds?: string[]; counterpartyId?: string } = {},
  ) {
    const notice = await tx.notification.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        type,
        title,
        body,
      },
    });
    const viewers = await tx.user.findMany({
      where: {
        organizationId: user.organizationId,
        isBlocked: false,
        OR: [
          {
            userRoles: { some: { role: { code: { in: ["OWNER", "ADMIN"] } } } },
          },
          {
            AND: [
              { warehouseScopeIds: { hasSome: scope.warehouseIds ?? [] } },
              {
                OR: [
                  { counterpartyScopeId: null },
                  { counterpartyScopeId: scope.counterpartyId ?? "__none__" },
                ],
              },
            ],
          },
        ],
      },
      select: { id: true },
    });
    const ids = [...new Set([user.id, ...viewers.map((x) => x.id)])];
    for (const viewerId of ids) {
      const n =
        viewerId === user.id
          ? notice
          : await tx.notification.create({
              data: {
                organizationId: user.organizationId,
                userId: viewerId,
                type,
                title,
                body,
              },
            });
      const devices = await tx.device.findMany({
        where: { userId: viewerId, pushToken: { not: null } },
      });
      for (const device of devices)
        await tx.pushDelivery.create({
          data: { notificationId: n.id, deviceId: device.id },
        });
    }
  }
  private async files(
    tx: Tx,
    fileIds: string[] | undefined,
    entityType: string,
    entityId: string,
    user: CurrentUser,
  ) {
    for (const id of [...new Set(fileIds ?? [])]) {
      const file = await tx.file.findFirst({
        where: {
          id,
          organizationId: user.organizationId,
          createdById: user.id,
          verifiedAt: { not: null },
        },
      });
      if (!file || (file.entityId && file.entityId !== entityId))
        throw new BadRequestException(
          "Вложение недоступно, не загружено или уже связано с другой операцией",
        );
      await tx.file.update({ where: { id }, data: { entityType, entityId } });
    }
  }

  createBatch(dto: BatchDto, user: CurrentUser) {
    this.require(user, "batches.manage");
    const quantity = mass(dto.quantity);
    if (!dto.measurementMethod.trim())
      throw new BadRequestException("Укажите метод измерения");
    return this.command(user, "batch.create", dto, async (tx) => {
      if (
        !user.accessAllObjects &&
        (!(user.extractionScopeIds ?? []).includes(dto.extractionSiteId) ||
          (user.counterpartyScopeId &&
            user.counterpartyScopeId !== dto.counterpartyId))
      )
        throw new ForbiddenException("Участок или контрагент не назначен");
      const [site, party, type] = await Promise.all([
        tx.extractionSite.findFirst({
          where: {
            id: dto.extractionSiteId,
            organizationId: user.organizationId,
            archivedAt: null,
          },
        }),
        tx.counterparty.findFirst({
          where: {
            id: dto.counterpartyId,
            organizationId: user.organizationId,
            status: "ACTIVE",
          },
        }),
        tx.materialType.findUnique({ where: { id: dto.materialTypeId } }),
      ]);
      if (!site || !party || !type)
        throw new BadRequestException(
          "Проверьте источник, контрагента и материал",
        );
      const qrToken = randomBytes(32).toString("base64url");
      const batch = await tx.materialBatch.create({
        data: {
          organizationId: user.organizationId,
          number: await nextDocumentNumber(tx, user.organizationId, "LOT"),
          qrTokenHash: hash(qrToken),
          counterpartyId: party.id,
          extractionSiteId: site.id,
          materialTypeId: type.id,
          originCounterpartyIds: [party.id],
          originExtractionSiteIds: [site.id],
          initialQuantity: quantity,
          availableSourceQuantity: quantity,
          measurementMethod: dto.measurementMethod,
          measuredAt: new Date(dto.measuredAt),
          createdById: user.id,
        },
      });
      await this.files(tx, dto.fileIds, "MaterialBatch", batch.id, user);
      await this.audit(
        tx,
        user,
        "batch.create",
        "MaterialBatch",
        batch.id,
        null,
        batch,
      );
      return { ...batch, qrToken, qrImage: await QRCode.toDataURL(qrToken) };
    });
  }
  batchAction(
    id: string,
    action: "confirm" | "close" | "cancel",
    dto: ReasonDto,
    user: CurrentUser,
  ) {
    this.require(user, "batches.manage");
    return this.command(user, `batch.${action}:${id}`, dto, async (tx) => {
      const batch = await this.batch(tx, id, user);
      if (action !== "confirm") this.reason(dto.reason);
      if (action === "confirm" && batch.status !== "DRAFT")
        throw new ConflictException("Подтверждается только черновик");
      if (
        action === "cancel" &&
        batch.availableSourceQuantity.lt(batch.initialQuantity)
      )
        throw new ConflictException("Партия уже используется в перевозках");
      if (["CLOSED", "CANCELLED"].includes(batch.status))
        throw new ConflictException("Партия закрыта");
      if (action === "close" && !batch.availableSourceQuantity.isZero())
        throw new ConflictException("У партии есть неотгруженный остаток");
      if (
        action === "close" &&
        (await tx.waybill.count({
          where: {
            batchId: id,
            status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED"] },
          },
        }))
      )
        throw new ConflictException(
          "Завершите перевозки перед закрытием партии",
        );
      const updated = await tx.materialBatch.update({
        where: { id },
        data: {
          status:
            action === "confirm"
              ? "CONFIRMED"
              : action === "cancel"
                ? "CANCELLED"
                : "CLOSED",
        },
      });
      await this.audit(
        tx,
        user,
        `batch.${action}`,
        "MaterialBatch",
        id,
        batch,
        updated,
        dto.reason,
      );
      return updated;
    });
  }
  async batches(query: LedgerQuery, user: CurrentUser) {
    const where: Prisma.MaterialBatchWhereInput = {
      ...scopedBatch(user),
      ...createdAtRange(query),
    };
    if (query.search)
      where.number = { contains: query.search, mode: "insensitive" };
    if (query.status) where.status = query.status;
    if (query.state)
      where.state = query.state as Prisma.EnumMaterialStateFilter;
    if (query.counterpartyId)
      where.originCounterpartyIds = { has: query.counterpartyId };
    if (query.extractionSiteId)
      where.originExtractionSiteIds = { has: query.extractionSiteId };
    if (query.materialTypeId) where.materialTypeId = query.materialTypeId;
    const size = Math.min(query.pageSize, 100);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.materialBatch.findMany({
        where,
        skip: (query.page - 1) * size,
        take: size,
        orderBy: { createdAt: "desc" },
        include: { stocks: true },
      }),
      this.prisma.materialBatch.count({ where }),
    ]);
    return {
      data: data.map((b) => ({
        ...b,
        stocks: b.stocks.filter(
          (s) =>
            user.accessAllObjects ||
            (user.warehouseScopeIds ?? []).includes(s.warehouseId),
        ),
      })),
      total,
      page: query.page,
      pageSize: size,
    };
  }

  createTrip(dto: TripDto, user: CurrentUser) {
    this.require(user, "waybills.manage");
    const quantity = mass(dto.quantity);
    return this.command(user, "trip.create", dto, async (tx) => {
      const batch = await this.batch(tx, dto.batchId, user);
      if (
        !["CONFIRMED", "PARTIALLY_SHIPPED"].includes(batch.status) ||
        batch.availableSourceQuantity.lt(quantity)
      )
        throw new ConflictException("Недостаточно доступного материала партии");
      if (
        !batch.counterpartyId ||
        !batch.extractionSiteId ||
        !batch.materialTypeId
      )
        throw new BadRequestException(
          "Перевозка должна относиться к партии добычи",
        );
      await this.warehouse(tx, dto.destinationWarehouseId, user);
      const vehicle = await tx.vehicle.findFirst({
        where: {
          id: dto.vehicleId,
          organizationId: user.organizationId,
          status: "ACTIVE",
          archivedAt: null,
        },
      });
      if (!vehicle) throw new BadRequestException("Транспорт недоступен");
      if (
        dto.driverId &&
        !(await tx.driver.findFirst({
          where: {
            id: dto.driverId,
            organizationId: user.organizationId,
            archivedAt: null,
          },
        }))
      )
        throw new BadRequestException("Водитель недоступен");
      const qrToken = randomBytes(32).toString("base64url");
      const trip = await tx.waybill.create({
        data: {
          organizationId: user.organizationId,
          number: await nextDocumentNumber(tx, user.organizationId, "WB"),
          batchId: batch.id,
          counterpartyId: batch.counterpartyId,
          extractionSiteId: batch.extractionSiteId,
          materialTypeId: batch.materialTypeId,
          vehicleId: vehicle.id,
          driverId: dto.driverId,
          destinationWarehouseId: dto.destinationWarehouseId,
          declaredWeight: quantity,
          documentDate: new Date(dto.documentDate),
          qrTokenHash: hash(qrToken),
          status: "CREATED",
          createdById: user.id,
        },
      });
      const remaining = batch.availableSourceQuantity.minus(quantity);
      await tx.materialBatch.update({
        where: { id: batch.id },
        data: {
          availableSourceQuantity: remaining,
          status: remaining.isZero() ? "FULLY_SHIPPED" : "PARTIALLY_SHIPPED",
        },
      });
      await this.audit(tx, user, "trip.create", "Waybill", trip.id, null, trip);
      await this.notice(
        tx,
        user,
        "WAYBILL_CREATED",
        "Создана перевозка",
        trip.number,
        {
          warehouseIds: [trip.destinationWarehouseId],
          counterpartyId: trip.counterpartyId,
        },
      );
      return { ...trip, qrToken, qrImage: await QRCode.toDataURL(qrToken) };
    });
  }
  loading(id: string, dto: LoadingDto, user: CurrentUser) {
    this.require(user, "loading.manage");
    const quantity = net(dto.grossWeight, dto.tareWeight);
    return this.command(user, `trip.load:${id}`, dto, async (tx) => {
      const trip = await this.trip(tx, id, user);
      if (trip.status !== "CREATED")
        throw new ConflictException("Перевозка уже погружена или закрыта");
      if (trip.vehicle.capacity && quantity.gt(trip.vehicle.capacity)) {
        const setting = await tx.systemSetting.findUnique({
          where: {
            organizationId_key: {
              organizationId: user.organizationId,
              key: "loading.capacityPolicy",
            },
          },
        });
        if (setting?.value !== "ALLOW_WITH_REASON")
          throw new BadRequestException("Превышена грузоподъёмность");
        this.reason(dto.reason);
      }
      const delta = quantity.minus(trip.declaredWeight);
      if (trip.batch!.availableSourceQuantity.lt(delta))
        throw new ConflictException("Погрузка превышает остаток партии");
      const remaining = trip.batch!.availableSourceQuantity.minus(delta);
      await tx.materialBatch.update({
        where: { id: trip.batchId! },
        data: {
          availableSourceQuantity: remaining,
          status: remaining.isZero() ? "FULLY_SHIPPED" : "PARTIALLY_SHIPPED",
        },
      });
      await this.files(tx, dto.fileIds, "Waybill", id, user);
      const updated = await tx.waybill.update({
        where: { id },
        data: {
          status: "LOADED",
          declaredWeight: quantity,
          grossWeight: mass(dto.grossWeight),
          tareWeight: mass(dto.tareWeight, false),
          events: {
            create: {
              type: "LOADED",
              payload: json({ userId: user.id, reason: dto.reason }),
            },
          },
        },
      });
      await this.audit(
        tx,
        user,
        "trip.load",
        "Waybill",
        id,
        trip,
        updated,
        dto.reason,
      );
      await this.notice(
        tx,
        user,
        "WAYBILL_LOADED",
        "Автомобиль загружен",
        updated.number,
        {
          warehouseIds: [trip.destinationWarehouseId],
          counterpartyId: trip.counterpartyId,
        },
      );
      return updated;
    });
  }
  status(id: string, dto: StatusDto, user: CurrentUser) {
    this.require(
      user,
      ["REVIEW", "REJECTED"].includes(dto.status)
        ? "waybills.accept"
        : dto.status === "ARRIVED" &&
            user.permissions.includes("waybills.accept")
          ? "waybills.accept"
          : "waybills.manage",
    );
    return this.command(user, `trip.status:${id}`, dto, async (tx) => {
      const trip = await this.trip(tx, id, user);
      const transitions: Record<string, string[]> = {
        CREATED: ["CANCELLED"],
        LOADED: ["IN_TRANSIT", "CANCELLED"],
        IN_TRANSIT: ["ARRIVED", "CANCELLED"],
        ARRIVED: ["REVIEW", "REJECTED"],
        REVIEW: ["ARRIVED", "REJECTED"],
        UNLOADED: ["COMPLETED"],
      };
      if (!(transitions[trip.status] ?? []).includes(dto.status))
        throw new ConflictException("Недопустимый переход статуса");
      if (["REVIEW", "CANCELLED", "REJECTED"].includes(dto.status))
        this.reason(dto.reason);
      if (["CANCELLED", "REJECTED"].includes(dto.status)) {
        const remaining = trip.batch!.availableSourceQuantity.plus(
          trip.declaredWeight,
        );
        await tx.materialBatch.update({
          where: { id: trip.batchId! },
          data: {
            availableSourceQuantity: remaining,
            status: remaining.eq(trip.batch!.initialQuantity)
              ? "CONFIRMED"
              : "PARTIALLY_SHIPPED",
          },
        });
      }
      const updated = await tx.waybill.update({
        where: { id },
        data: {
          status:
            dto.status as Prisma.EnumWaybillStatusFieldUpdateOperationsInput["set"],
          reviewReason: dto.reason,
          completedAt: dto.status === "COMPLETED" ? new Date() : undefined,
          events: {
            create: {
              type: dto.status,
              payload: json({ userId: user.id, reason: dto.reason }),
            },
          },
        },
      });
      await this.audit(
        tx,
        user,
        "trip.status",
        "Waybill",
        id,
        trip,
        updated,
        dto.reason,
      );
      await this.notice(
        tx,
        user,
        `WAYBILL_${dto.status}`,
        "Статус перевозки изменён",
        `${trip.number}: ${dto.status}`,
        {
          warehouseIds: [trip.destinationWarehouseId],
          counterpartyId: trip.counterpartyId,
        },
      );
      return updated;
    });
  }
  receipt(id: string, dto: ReceiptDto, user: CurrentUser) {
    this.require(user, "waybills.accept");
    const received = net(dto.grossWeight, dto.tareWeight);
    return this.command(user, `trip.receipt:${id}`, dto, async (tx) => {
      const trip = await this.trip(tx, id, user);
      if (!["ARRIVED", "PARTIALLY_ACCEPTED"].includes(trip.status))
        throw new ConflictException("Ожидается прибывшая перевозка");
      if (dto.warehouseId !== trip.destinationWarehouseId)
        throw new BadRequestException(
          "Склад отличается от назначения перевозки",
        );
      await this.warehouse(tx, dto.warehouseId, user);
      const total = (trip.receivedWeight ?? new Prisma.Decimal(0)).plus(
        received,
      );
      const difference = total.minus(trip.declaredWeight);
      const setting = await tx.systemSetting.findUnique({
        where: {
          organizationId_key: {
            organizationId: user.organizationId,
            key: "acceptance.differenceThresholdPercent",
          },
        },
      });
      const threshold = typeof setting?.value === "number" ? setting.value : 3;
      if (
        !dto.partial &&
        difference.abs().mul(100).gt(trip.declaredWeight.mul(threshold))
      )
        this.reason(dto.reason);
      if (dto.partial && total.gte(trip.declaredWeight))
        throw new BadRequestException(
          "Частичная приёмка должна быть меньше отправленной массы",
        );
      await this.files(tx, dto.fileIds, "Waybill", id, user);
      const updated = await tx.waybill.update({
        where: { id },
        data: {
          status: dto.partial
            ? "PARTIALLY_ACCEPTED"
            : difference.abs().mul(100).gt(trip.declaredWeight.mul(threshold))
              ? "ACCEPTED_WITH_DIFFERENCE"
              : "ACCEPTED",
          receivedWeight: total,
          receiptWarehouseId: dto.warehouseId,
          acceptedById: user.id,
          acceptedAt: new Date(),
          discrepancyReason: dto.reason,
          events: {
            create: {
              type: "RECEIPT",
              payload: json({
                userId: user.id,
                grossWeight: dto.grossWeight,
                tareWeight: dto.tareWeight,
                netWeight: received,
                partial: !!dto.partial,
                reason: dto.reason,
              }),
            },
          },
        },
      });
      await this.audit(
        tx,
        user,
        "trip.receipt",
        "Waybill",
        id,
        trip,
        updated,
        dto.reason,
      );
      return {
        ...updated,
        difference: difference.toString(),
        differencePercent: difference
          .mul(100)
          .div(trip.declaredWeight)
          .toFixed(3),
        unit: "т",
      };
    });
  }
  unload(id: string, dto: CommandDto, user: CurrentUser) {
    this.require(user, "waybills.accept");
    return this.command(user, `trip.unload:${id}`, dto, async (tx) => {
      const trip = await this.trip(tx, id, user);
      if (
        !["ACCEPTED", "ACCEPTED_WITH_DIFFERENCE"].includes(trip.status) ||
        !trip.receivedWeight ||
        !trip.receiptWarehouseId
      )
        throw new ConflictException("Требуется окончательная приёмка");
      await this.move(
        tx,
        user,
        trip.batchId!,
        trip.receiptWarehouseId,
        trip.receivedWeight,
        "RECEIPT",
        undefined,
        id,
        trip.discrepancyReason ?? undefined,
      );
      const updated = await tx.waybill.update({
        where: { id },
        data: { status: "UNLOADED", actualWeight: trip.receivedWeight },
      });
      await this.audit(tx, user, "trip.unload", "Waybill", id, trip, updated);
      await this.notice(
        tx,
        user,
        "WAYBILL_UNLOADED",
        "Выгрузка подтверждена",
        `${trip.number}: ${trip.receivedWeight} т`,
        {
          warehouseIds: [trip.destinationWarehouseId],
          counterpartyId: trip.counterpartyId,
        },
      );
      return updated;
    });
  }
  async trips(query: LedgerQuery, user: CurrentUser) {
    const where: Prisma.WaybillWhereInput = {
      organizationId: user.organizationId,
      batchId: { not: null },
      ...createdAtRange(query),
    };
    if (!user.accessAllObjects) {
      where.OR = [
        { destinationWarehouseId: { in: user.warehouseScopeIds ?? [] } },
        { extractionSiteId: { in: user.extractionScopeIds ?? [] } },
      ];
      if (user.counterpartyScopeId)
        where.counterpartyId = user.counterpartyScopeId;
    }
    if (query.search)
      where.AND = [
        {
          OR: [
            { number: { contains: query.search, mode: "insensitive" } },
            {
              vehicle: {
                plateNumber: { contains: query.search, mode: "insensitive" },
              },
            },
          ],
        },
      ];
    if (query.status)
      where.status = query.status as Prisma.EnumWaybillStatusFilter;
    if (query.extractionSiteId) where.extractionSiteId = query.extractionSiteId;
    if (query.materialTypeId) where.materialTypeId = query.materialTypeId;
    if (query.state)
      where.batch = { state: query.state as Prisma.EnumMaterialStateFilter };
    if (query.counterpartyId)
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        { counterpartyId: query.counterpartyId },
      ];
    if (query.warehouseId) {
      allowed(user, query.warehouseId);
      where.destinationWarehouseId = query.warehouseId;
    }
    const size = Math.min(query.pageSize, 100);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.waybill.findMany({
        where,
        skip: (query.page - 1) * size,
        take: size,
        orderBy: { createdAt: "desc" },
        include: { batch: true, vehicle: true, driver: true },
      }),
      this.prisma.waybill.count({ where }),
    ]);
    return { data, total, page: query.page, pageSize: size };
  }
  async getTrip(id: string, user: CurrentUser) {
    return this.trip(this.prisma, id, user);
  }
  async resolve(token: string, user: CurrentUser) {
    const trip = await this.prisma.waybill.findFirst({
      where: {
        organizationId: user.organizationId,
        qrTokenHash: hash(token),
        batchId: { not: null },
      },
    });
    if (trip) return this.trip(this.prisma, trip.id, user);
    const batch = await this.prisma.materialBatch.findFirst({
      where: { ...scopedBatch(user), qrTokenHash: hash(token) },
    });
    if (batch) return { ...batch, entityType: "MaterialBatch" };
    throw new NotFoundException("QR не найден");
  }

  private async move(
    tx: Tx,
    user: CurrentUser,
    batchId: string,
    warehouseId: string,
    delta: Prisma.Decimal,
    kind: string,
    operationId?: string,
    waybillId?: string,
    reason?: string,
    reservedDelta = new Prisma.Decimal(0),
    reversesId?: string,
  ) {
    const warehouse = await this.warehouse(tx, warehouseId, user);
    const batch = await tx.materialBatch.findFirstOrThrow({
      where: { id: batchId, organizationId: user.organizationId },
    });
    if (
      warehouse.allowedMaterialTypeIds.length &&
      batch.materialTypeId &&
      !warehouse.allowedMaterialTypeIds.includes(batch.materialTypeId)
    )
      throw new BadRequestException("Материал не разрешён на складе");
    const old = await tx.batchStock.findUnique({
      where: { batchId_warehouseId: { batchId, warehouseId } },
    });
    const quantity = (old?.quantity ?? new Prisma.Decimal(0)).plus(delta);
    const reserved = (old?.reserved ?? new Prisma.Decimal(0)).plus(
      reservedDelta,
    );
    if (quantity.lt(0) || reserved.lt(0) || quantity.lt(reserved))
      throw new ConflictException("Недостаточно свободного остатка");
    if (warehouse.capacity && delta.gt(0)) {
      const total = await tx.batchStock.aggregate({
        where: { warehouseId },
        _sum: { quantity: true },
      });
      if (
        (total._sum.quantity ?? new Prisma.Decimal(0))
          .plus(delta)
          .gt(warehouse.capacity)
      )
        throw new ConflictException("Превышена вместимость склада");
    }
    const stock = await tx.batchStock.upsert({
      where: { batchId_warehouseId: { batchId, warehouseId } },
      update: { quantity, reserved },
      create: { batchId, warehouseId, quantity, reserved },
    });
    const movement = await tx.batchMovement.create({
      data: {
        organizationId: user.organizationId,
        batchId,
        warehouseId,
        quantity: delta,
        reservedDelta,
        kind,
        operationId,
        waybillId,
        createdById: user.id,
        reason,
        reversesId,
      },
    });
    const total = await tx.batchStock.aggregate({
      where: { warehouseId },
      _sum: { quantity: true },
    });
    if (
      warehouse.lowStockLimit &&
      (total._sum.quantity ?? new Prisma.Decimal(0)).lt(warehouse.lowStockLimit)
    )
      await this.notice(
        tx,
        user,
        "LOW_STOCK",
        "Остаток ниже минимума",
        `${warehouse.name}: ${total._sum.quantity ?? 0} т`,
        { warehouseIds: [warehouseId] },
      );
    if (
      warehouse.capacity &&
      (total._sum.quantity ?? new Prisma.Decimal(0)).gte(
        warehouse.capacity.mul("0.9"),
      )
    )
      await this.notice(
        tx,
        user,
        "WAREHOUSE_CAPACITY",
        "Склад близок к заполнению",
        warehouse.name,
        { warehouseIds: [warehouseId] },
      );
    return { stock, movement };
  }

  createOperation(dto: OperationDto, user: CurrentUser) {
    this.require(user, operationPermission(dto.kind));
    if (new Set(dto.inputs.map((x) => x.batchId)).size !== dto.inputs.length)
      throw new BadRequestException("Входные партии повторяются");
    dto.inputs.forEach((x) =>
      dto.kind === "CORRECTION"
        ? this.signed(x.quantity)
        : mass(x.quantity, dto.kind !== "INVENTORY"),
    );
    if (
      ["WRITE_OFF", "CORRECTION", "INVENTORY", "RETURN", "RELEASE"].includes(
        dto.kind,
      )
    )
      this.reason(dto.reason);
    if (
      dto.kind === "SHIPMENT" &&
      (!dto.recipient?.trim() ||
        !dto.vehicleId ||
        !dto.documentNumber?.trim() ||
        !dto.fileIds?.length)
    )
      throw new BadRequestException(
        "Укажите получателя, автомобиль, документ и вложения",
      );
    if (
      dto.kind === "TRANSFER" &&
      (!dto.toWarehouseId || dto.fromWarehouseId === dto.toWarehouseId)
    )
      throw new BadRequestException("Укажите другой склад назначения");
    if (
      ["WASHING", "PRODUCTION"].includes(dto.kind) &&
      (!dto.outputQuantity || !dto.toWarehouseId || !dto.shift?.trim())
    )
      throw new BadRequestException("Укажите выход, склад назначения и смену");
    return this.command(user, "operation.create", dto, async (tx) => {
      await this.warehouse(tx, dto.fromWarehouseId, user);
      if (dto.toWarehouseId) await this.warehouse(tx, dto.toWarehouseId, user);
      for (const input of dto.inputs) await this.batch(tx, input.batchId, user);
      if (
        dto.vehicleId &&
        !(await tx.vehicle.findFirst({
          where: {
            id: dto.vehicleId,
            organizationId: user.organizationId,
            status: "ACTIVE",
            archivedAt: null,
          },
        }))
      )
        throw new BadRequestException("Транспорт недоступен");
      if (
        dto.productTypeId &&
        !(await tx.productType.findUnique({ where: { id: dto.productTypeId } }))
      )
        throw new BadRequestException("Вид продукции не найден");
      const operation = await tx.batchOperation.create({
        data: {
          organizationId: user.organizationId,
          number: await nextDocumentNumber(tx, user.organizationId, "OP"),
          kind: dto.kind,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          outputQuantity: dto.outputQuantity
            ? mass(dto.outputQuantity)
            : undefined,
          wasteQuantity: mass(dto.wasteQuantity ?? "0", false),
          lossQuantity: mass(dto.lossQuantity ?? "0", false),
          defectQuantity: mass(dto.defectQuantity ?? "0", false),
          reason: dto.reason,
          details: json(dto),
          idempotencyKey: `${user.id}:${dto.idempotencyKey}`,
          createdById: user.id,
          inputs: {
            create: dto.inputs.map((i) => ({
              batchId: i.batchId,
              quantity:
                dto.kind === "CORRECTION"
                  ? this.signed(i.quantity)
                  : mass(i.quantity, dto.kind !== "INVENTORY"),
            })),
          },
        },
        include: { inputs: true },
      });
      await this.files(tx, dto.fileIds, "BatchOperation", operation.id, user);
      await this.audit(
        tx,
        user,
        "operation.create",
        "BatchOperation",
        operation.id,
        null,
        operation,
      );
      await this.notice(
        tx,
        user,
        "OPERATION_PENDING",
        "Операция ожидает подтверждения",
        operation.number,
        {
          warehouseIds: [
            dto.fromWarehouseId,
            ...(dto.toWarehouseId ? [dto.toWarehouseId] : []),
          ],
        },
      );
      return operation;
    });
  }
  private signed(value: string) {
    const n = mass(value.replace(/^-/, ""));
    return value.startsWith("-") ? n.neg() : n;
  }
  confirmOperation(id: string, dto: CommandDto, user: CurrentUser) {
    return this.command(user, `operation.confirm:${id}`, dto, async (tx) => {
      const op = await tx.batchOperation.findFirst({
        where: { id, organizationId: user.organizationId },
        include: { inputs: { include: { batch: true } } },
      });
      if (!op) throw new NotFoundException("Операция не найдена");
      this.require(user, operationPermission(op.kind));
      if (op.status !== "DRAFT")
        throw new ConflictException("Операция уже обработана");
      await this.warehouse(tx, op.fromWarehouseId!, user);
      if (op.toWarehouseId) await this.warehouse(tx, op.toWarehouseId, user);
      for (const input of op.inputs) await this.batch(tx, input.batchId, user);
      let outputBatchId: string | undefined;
      if (["WASHING", "PRODUCTION"].includes(op.kind)) {
        const inputTotal = op.inputs.reduce(
          (n, i) => n.plus(i.quantity),
          new Prisma.Decimal(0),
        );
        if (
          op.inputs.some(
            (i) =>
              i.batch.state !== (op.kind === "WASHING" ? "DIRTY" : "WASHED"),
          )
        )
          throw new BadRequestException("Неверное состояние входной партии");
        if (new Set(op.inputs.map((i) => i.batch.materialTypeId)).size !== 1)
          throw new BadRequestException("Выберите партии одного материала");
        if (!op.outputQuantity)
          throw new BadRequestException("Не указан выход");
        const accounted = op.outputQuantity
          .plus(op.wasteQuantity)
          .plus(op.lossQuantity)
          .plus(op.defectQuantity);
        const setting = await tx.systemSetting.findUnique({
          where: {
            organizationId_key: {
              organizationId: user.organizationId,
              key: "production.balanceToleranceTonnes",
            },
          },
        });
        const tolerance =
          typeof setting?.value === "string"
            ? mass(setting.value, false)
            : new Prisma.Decimal(0);
        if (accounted.minus(inputTotal).abs().gt(tolerance))
          throw new BadRequestException(
            "Вход не равен выходу, отходам, браку и потерям",
          );
        const details = op.details as unknown as OperationDto;
        if (op.kind === "PRODUCTION" && !details.productTypeId)
          throw new BadRequestException("Укажите вид продукции");
        const batch = await tx.materialBatch.create({
          data: {
            organizationId: user.organizationId,
            number: await nextDocumentNumber(tx, user.organizationId, "LOT"),
            qrTokenHash: hash(randomBytes(32).toString("base64url")),
            state: op.kind === "WASHING" ? "WASHED" : "FINISHED",
            status: "CONFIRMED",
            materialTypeId:
              op.kind === "WASHING"
                ? op.inputs[0].batch.materialTypeId
                : undefined,
            productTypeId:
              op.kind === "PRODUCTION" ? details.productTypeId : undefined,
            originCounterpartyIds: [
              ...new Set(
                op.inputs.flatMap((i) => i.batch.originCounterpartyIds),
              ),
            ].sort(),
            originExtractionSiteIds: [
              ...new Set(
                op.inputs.flatMap((i) => i.batch.originExtractionSiteIds),
              ),
            ].sort(),
            initialQuantity: op.outputQuantity,
            availableSourceQuantity: 0,
            measurementMethod: "Производственное взвешивание",
            measuredAt: new Date(),
            createdById: user.id,
          },
        });
        outputBatchId = batch.id;
        for (const input of op.inputs)
          await this.move(
            tx,
            user,
            input.batchId,
            op.fromWarehouseId!,
            input.quantity.neg(),
            `${op.kind}_INPUT`,
            id,
            undefined,
            op.reason ?? undefined,
          );
        await this.move(
          tx,
          user,
          batch.id,
          op.toWarehouseId!,
          op.outputQuantity,
          `${op.kind}_OUTPUT`,
          id,
        );
      } else {
        for (const input of op.inputs) {
          if (op.kind === "RESERVE" || op.kind === "RELEASE")
            await this.move(
              tx,
              user,
              input.batchId,
              op.fromWarehouseId!,
              new Prisma.Decimal(0),
              op.kind,
              id,
              undefined,
              op.reason ?? undefined,
              op.kind === "RESERVE" ? input.quantity : input.quantity.neg(),
            );
          else if (op.kind === "CORRECTION")
            await this.move(
              tx,
              user,
              input.batchId,
              op.fromWarehouseId!,
              input.quantity,
              op.kind,
              id,
              undefined,
              op.reason ?? undefined,
            );
          else if (op.kind === "INVENTORY") {
            const current = await tx.batchStock.findUnique({
              where: {
                batchId_warehouseId: {
                  batchId: input.batchId,
                  warehouseId: op.fromWarehouseId!,
                },
              },
            });
            await this.move(
              tx,
              user,
              input.batchId,
              op.fromWarehouseId!,
              input.quantity.minus(current?.quantity ?? 0),
              op.kind,
              id,
              undefined,
              op.reason ?? undefined,
            );
          } else if (op.kind === "RETURN") {
            const originalId = (op.details as unknown as OperationDto)
              .reversesOperationId;
            const original = originalId
              ? await tx.batchOperation.findFirst({
                  where: {
                    id: originalId,
                    organizationId: user.organizationId,
                    kind: "SHIPMENT",
                    status: "CONFIRMED",
                  },
                  include: { inputs: true },
                })
              : null;
            if (
              !original ||
              !original.inputs.some(
                (i) =>
                  i.batchId === input.batchId && i.quantity.gte(input.quantity),
              )
            )
              throw new BadRequestException(
                "Возврат должен относиться к подтверждённой отгрузке",
              );
            const returned = await tx.batchMovement.aggregate({
              where: {
                kind: "RETURN",
                batchId: input.batchId,
                operation: {
                  details: {
                    path: ["reversesOperationId"],
                    equals: originalId,
                  },
                },
              },
              _sum: { quantity: true },
            });
            const originalQty = original.inputs.find(
              (i) => i.batchId === input.batchId,
            )!.quantity;
            if (
              (returned._sum.quantity ?? new Prisma.Decimal(0))
                .plus(input.quantity)
                .gt(originalQty)
            )
              throw new ConflictException(
                "Возврат превышает отгруженное количество",
              );
            await this.move(
              tx,
              user,
              input.batchId,
              op.fromWarehouseId!,
              input.quantity,
              op.kind,
              id,
              undefined,
              op.reason ?? undefined,
            );
          } else {
            if (op.kind === "SHIPMENT" && input.batch.state !== "FINISHED")
              throw new BadRequestException(
                "Отгружается только готовая продукция",
              );
            await this.move(
              tx,
              user,
              input.batchId,
              op.fromWarehouseId!,
              input.quantity.neg(),
              op.kind,
              id,
              undefined,
              op.reason ?? undefined,
            );
            if (op.kind === "TRANSFER")
              await this.move(
                tx,
                user,
                input.batchId,
                op.toWarehouseId!,
                input.quantity,
                "TRANSFER_IN",
                id,
              );
          }
        }
      }
      const updated = await tx.batchOperation.update({
        where: { id },
        data: {
          status: "CONFIRMED",
          outputBatchId,
          confirmedById: user.id,
          confirmedAt: new Date(),
        },
        include: { inputs: true, outputBatch: true },
      });
      await this.audit(
        tx,
        user,
        "operation.confirm",
        "BatchOperation",
        id,
        op,
        updated,
        op.reason ?? undefined,
      );
      await this.notice(
        tx,
        user,
        "OPERATION_CONFIRMED",
        "Операция подтверждена",
        updated.number,
        {
          warehouseIds: [
            op.fromWarehouseId!,
            ...(op.toWarehouseId ? [op.toWarehouseId] : []),
          ],
        },
      );
      return updated;
    });
  }
  cancelOperation(id: string, dto: ReasonDto, user: CurrentUser) {
    this.reason(dto.reason);
    return this.command(user, `operation.cancel:${id}`, dto, async (tx) => {
      const op = await tx.batchOperation.findFirst({
        where: { id, organizationId: user.organizationId },
        include: { movements: true, inputs: true },
      });
      if (!op) throw new NotFoundException("Операция не найдена");
      this.require(user, operationPermission(op.kind));
      if (op.status === "CANCELLED")
        throw new ConflictException("Операция уже отменена");
      if (op.kind === "RETURN")
        throw new ConflictException(
          "Возврат исправляется отдельной корректировкой",
        );
      if (
        op.kind === "SHIPMENT" &&
        (await tx.batchOperation.count({
          where: {
            organizationId: user.organizationId,
            kind: "RETURN",
            status: "CONFIRMED",
            details: { path: ["reversesOperationId"], equals: id },
          },
        }))
      )
        throw new ConflictException("Отгрузка имеет подтверждённый возврат");
      for (const input of op.inputs) await this.batch(tx, input.batchId, user);
      // Reverse positive outputs first. If consumed or reserved, the whole cancellation fails.
      const movements = [...op.movements].sort((a, b) =>
        b.quantity.comparedTo(a.quantity),
      );
      for (const movement of movements) {
        const reverse = await this.move(
          tx,
          user,
          movement.batchId,
          movement.warehouseId,
          movement.quantity.neg(),
          "REVERSAL",
          id,
          undefined,
          dto.reason,
          movement.reservedDelta.neg(),
          movement.id,
        );
      }
      if (op.outputBatchId)
        await tx.materialBatch.update({
          where: { id: op.outputBatchId },
          data: { status: "CANCELLED" },
        });
      const updated = await tx.batchOperation.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledById: user.id,
          cancelledAt: new Date(),
        },
      });
      await this.audit(
        tx,
        user,
        "operation.cancel",
        "BatchOperation",
        id,
        op,
        updated,
        dto.reason,
      );
      return updated;
    });
  }

  async operations(query: LedgerQuery, user: CurrentUser) {
    const where: Prisma.BatchOperationWhereInput = {
      organizationId: user.organizationId,
      ...createdAtRange(query),
      inputs: { every: { batch: scopedBatch(user) } },
    };
    if (!user.accessAllObjects)
      where.AND = [
        { fromWarehouseId: { in: user.warehouseScopeIds ?? [] } },
        {
          OR: [
            { toWarehouseId: null },
            { toWarehouseId: { in: user.warehouseScopeIds ?? [] } },
          ],
        },
      ];
    if (query.kind) where.kind = query.kind;
    if (query.search)
      where.number = { contains: query.search, mode: "insensitive" };
    if (query.warehouseId) {
      allowed(user, query.warehouseId);
      where.fromWarehouseId = query.warehouseId;
    }
    if (
      query.counterpartyId ||
      query.extractionSiteId ||
      query.materialTypeId ||
      query.state
    )
      where.inputs = {
        every: { batch: scopedBatch(user) },
        some: {
          batch: {
            ...scopedBatch(user),
            ...(query.counterpartyId
              ? { originCounterpartyIds: { has: query.counterpartyId } }
              : {}),
            ...(query.extractionSiteId
              ? { originExtractionSiteIds: { has: query.extractionSiteId } }
              : {}),
            ...(query.materialTypeId
              ? { materialTypeId: query.materialTypeId }
              : {}),
            ...(query.state
              ? { state: query.state as Prisma.EnumMaterialStateFilter }
              : {}),
          },
        },
      };
    if (query.status)
      where.status = query.status as Prisma.EnumOperationStatusFilter;
    const size = Math.min(query.pageSize, 100);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.batchOperation.findMany({
        where,
        skip: (query.page - 1) * size,
        take: size,
        orderBy: { createdAt: "desc" },
        include: { inputs: { include: { batch: true } }, outputBatch: true },
      }),
      this.prisma.batchOperation.count({ where }),
    ]);
    return { data, total, page: query.page, pageSize: size };
  }
  async stocks(query: LedgerQuery, user: CurrentUser) {
    const where: Prisma.BatchStockWhereInput = { batch: scopedBatch(user) };
    if (!user.accessAllObjects)
      where.warehouseId = { in: user.warehouseScopeIds ?? [] };
    if (query.warehouseId) {
      allowed(user, query.warehouseId);
      where.warehouseId = query.warehouseId;
    }
    if (query.search || query.state || query.materialTypeId)
      where.batch = {
        ...scopedBatch(user),
        ...(query.search
          ? { number: { contains: query.search, mode: "insensitive" } }
          : {}),
        ...(query.state
          ? { state: query.state as Prisma.EnumMaterialStateFilter }
          : {}),
        ...(query.materialTypeId
          ? { materialTypeId: query.materialTypeId }
          : {}),
      };
    const stocks = await this.prisma.batchStock.findMany({
      where,
      include: { batch: true },
      orderBy: { updatedAt: "desc" },
    });
    return stocks.map((stock) => ({
      ...stock,
      available: stock.quantity.minus(stock.reserved).toString(),
      unit: "т",
    }));
  }
  async trace(id: string, user: CurrentUser) {
    const seen = new Set<string>();
    const walk = async (batchId: string): Promise<unknown> => {
      if (seen.has(batchId)) return { id: batchId, reference: true };
      seen.add(batchId);
      const batch = await this.batch(this.prisma, batchId, user);
      const [operation, trips] = await Promise.all([
        this.prisma.batchOperation.findUnique({
          where: { outputBatchId: batchId },
          include: { inputs: true },
        }),
        this.prisma.waybill.findMany({
          where: { batchId, organizationId: user.organizationId },
          include: { vehicle: true, counterparty: true, extractionSite: true },
          orderBy: { createdAt: "asc" },
        }),
      ]);
      return {
        batch,
        operation,
        trips: trips.filter(
          (t) =>
            user.accessAllObjects ||
            (user.warehouseScopeIds ?? []).includes(t.destinationWarehouseId) ||
            (user.extractionScopeIds ?? []).includes(t.extractionSiteId),
        ),
        inputs: operation
          ? await Promise.all(
              operation.inputs.map(async (i) => ({
                quantity: i.quantity,
                source: await walk(i.batchId),
              })),
            )
          : [],
      };
    };
    return walk(id);
  }
  async accessibleEntity(type: string, id: string, user: CurrentUser) {
    if (type === "MaterialBatch") return this.batch(this.prisma, id, user);
    if (type === "Waybill") return this.trip(this.prisma, id, user);
    if (type === "BatchOperation") {
      const op = await this.prisma.batchOperation.findFirst({
        where: { id, organizationId: user.organizationId },
        include: { inputs: true },
      });
      if (!op) throw new NotFoundException("Операция не найдена");
      if (op.fromWarehouseId) allowed(user, op.fromWarehouseId);
      if (op.toWarehouseId) allowed(user, op.toWarehouseId);
      for (const input of op.inputs)
        await this.batch(this.prisma, input.batchId, user);
      return op;
    }
    throw new NotFoundException("Вложение недоступно");
  }
  async listFiles(type: string, id: string, user: CurrentUser) {
    await this.accessibleEntity(type, id, user);
    return this.prisma.file.findMany({
      where: {
        organizationId: user.organizationId,
        entityType: type,
        entityId: id,
        verifiedAt: { not: null },
      },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        size: true,
        createdAt: true,
      },
    });
  }
  async report(type: string, query: LedgerQuery, user: CurrentUser) {
    this.require(user, "reports.read");
    const permitted = [
      "extraction",
      "waybills",
      "discrepancies",
      "movements",
      "inventory",
      "turnover",
      "washing",
      "production",
      "losses",
      "transfers",
      "shipments",
      "reconciliation",
      "audit",
    ];
    if (!permitted.includes(type))
      throw new BadRequestException("Неизвестный отчёт");
    const batchWhere: Prisma.MaterialBatchWhereInput = {
      ...scopedBatch(user),
      AND: [
        ...(Array.isArray(scopedBatch(user).AND)
          ? (scopedBatch(user).AND as Prisma.MaterialBatchWhereInput[])
          : []),
        ...(query.counterpartyId
          ? [{ originCounterpartyIds: { has: query.counterpartyId } }]
          : []),
        ...(query.extractionSiteId
          ? [{ originExtractionSiteIds: { has: query.extractionSiteId } }]
          : []),
        ...(query.materialTypeId
          ? [{ materialTypeId: query.materialTypeId }]
          : []),
        ...(query.state
          ? [{ state: query.state as Prisma.EnumMaterialStateFilter }]
          : []),
      ],
    };
    let rows: unknown[];
    if (type === "extraction")
      rows = await this.prisma.materialBatch.findMany({
        where: {
          AND: [
            batchWhere,
            { extractionSiteId: { not: null } },
            createdAtRange(query),
          ],
        },
        orderBy: { createdAt: "asc" },
      });
    else if (["waybills", "discrepancies"].includes(type)) {
      const all: Awaited<ReturnType<LedgerService["trips"]>>["data"] = [];
      let page = 1;
      for (;;) {
        const result = await this.trips(
          { ...query, page, pageSize: 100 },
          user,
        );
        all.push(
          ...result.data.filter(
            (t) => type !== "discrepancies" || t.discrepancyReason !== null,
          ),
        );
        if (page++ * 100 >= result.total) break;
      }
      rows = all.map((trip) => ({
        ...trip,
        difference:
          trip.receivedWeight === null
            ? null
            : trip.receivedWeight.minus(trip.declaredWeight).toString(),
        differencePercent:
          trip.receivedWeight === null || trip.declaredWeight.isZero()
            ? null
            : trip.receivedWeight
                .minus(trip.declaredWeight)
                .mul(100)
                .div(trip.declaredWeight)
                .toDecimalPlaces(2)
                .toString(),
      }));
    } else if (type === "audit") {
      rows = await this.prisma.auditLog.findMany({
        where: {
          organizationId: user.organizationId,
          ...createdAtRange(query),
          ...(!user.accessAllObjects ? { userId: user.id } : {}),
        },
        orderBy: { createdAt: "asc" },
      });
    } else {
      const where: Prisma.BatchMovementWhereInput = {
        organizationId: user.organizationId,
        batch: batchWhere,
      };
      if (!user.accessAllObjects)
        where.warehouseId = { in: user.warehouseScopeIds ?? [] };
      if (query.warehouseId) {
        allowed(user, query.warehouseId);
        where.warehouseId = query.warehouseId;
      }
      const range = createdAtRange(query).createdAt;
      const dateTo = range?.lte;
      const dateFrom = range?.gte;
      const history = await this.prisma.batchMovement.findMany({
        where: { ...where, ...(dateTo ? { createdAt: { lte: dateTo } } : {}) },
        include: {
          batch: true,
          operation: { select: { number: true, kind: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      if (["inventory", "turnover", "reconciliation"].includes(type)) {
        const balances = new Map<
          string,
          {
            batchId: string;
            batchNumber: string;
            warehouseId: string;
            opening: Prisma.Decimal;
            incoming: Prisma.Decimal;
            outgoing: Prisma.Decimal;
            closing: Prisma.Decimal;
            reserved: Prisma.Decimal;
            unit: string;
          }
        >();
        for (const m of history) {
          const key = `${m.batchId}:${m.warehouseId}`;
          const b = balances.get(key) ?? {
            batchId: m.batchId,
            batchNumber: m.batch.number,
            warehouseId: m.warehouseId,
            opening: new Prisma.Decimal(0),
            incoming: new Prisma.Decimal(0),
            outgoing: new Prisma.Decimal(0),
            closing: new Prisma.Decimal(0),
            reserved: new Prisma.Decimal(0),
            unit: "т",
          };
          b.closing = b.closing.plus(m.quantity);
          b.reserved = b.reserved.plus(m.reservedDelta);
          if (dateFrom && m.createdAt < dateFrom)
            b.opening = b.opening.plus(m.quantity);
          else if (m.quantity.gt(0)) b.incoming = b.incoming.plus(m.quantity);
          else b.outgoing = b.outgoing.minus(m.quantity);
          balances.set(key, b);
        }
        rows = [...balances.values()];
      } else {
        const kindPrefixes: Record<string, string[]> = {
          washing: ["WASHING"],
          production: ["PRODUCTION"],
          losses: ["WRITE_OFF", "CORRECTION", "INVENTORY", "REVERSAL"],
          transfers: ["TRANSFER"],
          shipments: ["SHIPMENT", "RETURN"],
        };
        rows = history.filter(
          (m) =>
            (!dateFrom || m.createdAt >= dateFrom) &&
            (!kindPrefixes[type] ||
              kindPrefixes[type].some((prefix) => m.kind.startsWith(prefix))),
        );
        if (type === "losses") {
          const ops = await this.operations(
            { ...query, page: 1, pageSize: 100 },
            user,
          );
          // Loss mass is stored separately from material stock movements.
          const allOps: unknown[] = [];
          for (let page = 1; (page - 1) * 100 < ops.total; page++) {
            const current =
              page === 1
                ? ops
                : await this.operations(
                    { ...query, page, pageSize: 100 },
                    user,
                  );
            allOps.push(
              ...current.data
                .filter(
                  (o) =>
                    o.status === "CONFIRMED" &&
                    (o.wasteQuantity.gt(0) ||
                      o.lossQuantity.gt(0) ||
                      o.defectQuantity.gt(0)),
                )
                .map((o) => ({
                  operationId: o.id,
                  number: o.number,
                  wasteQuantity: o.wasteQuantity,
                  lossQuantity: o.lossQuantity,
                  defectQuantity: o.defectQuantity,
                  createdAt: o.createdAt,
                })),
            );
          }
          rows = [...rows, ...allOps];
        }
      }
    }
    const totals: Record<string, string | number> = { records: rows.length };
    for (const key of [
      "initialQuantity",
      "declaredWeight",
      "receivedWeight",
      "opening",
      "incoming",
      "outgoing",
      "closing",
      "reserved",
      "wasteQuantity",
      "lossQuantity",
      "defectQuantity",
    ]) {
      const amounts = rows
        .map((row) => (row as Record<string, unknown>)[key])
        .filter((value) => value != null);
      if (amounts.length)
        totals[key] = amounts
          .reduce<Prisma.Decimal>(
            (sum, value) => sum.plus(String(value)),
            new Prisma.Decimal(0),
          )
          .toFixed(3);
    }
    return {
      totals,
      type,
      generatedAt: new Date().toISOString(),
      userId: user.id,
      filters: query,
      unit: "т",
      rows,
    };
  }
  async archive(entity: string, id: string, dto: ReasonDto, user: CurrentUser) {
    this.require(user, "references.manage");
    if (!user.accessAllObjects)
      throw new ForbiddenException("Архивирование доступно администратору");
    this.reason(dto.reason);
    const models: Record<string, string> = {
      warehouses: "warehouse",
      vehicles: "vehicle",
      drivers: "driver",
      "extraction-sites": "extractionSite",
      plants: "plant",
      counterparties: "counterparty",
    };
    const model = models[entity];
    if (!model)
      throw new BadRequestException("Справочник не поддерживает архивирование");
    return this.command(
      user,
      `reference.archive:${entity}:${id}`,
      dto,
      async (tx) => {
        const delegate = (tx as any)[model];
        const record = await delegate.findFirst({
          where: { id, organizationId: user.organizationId },
        });
        if (!record) throw new NotFoundException("Запись недоступна");
        if (
          entity === "warehouses" &&
          (await tx.batchStock.count({
            where: { warehouseId: id, quantity: { gt: 0 } },
          }))
        )
          throw new ConflictException("На складе есть материал");
        const filters: Record<string, Prisma.WaybillWhereInput> = {
          warehouses: { destinationWarehouseId: id },
          vehicles: { vehicleId: id },
          drivers: { driverId: id },
          "extraction-sites": { extractionSiteId: id },
          counterparties: { counterpartyId: id },
        };
        if (
          filters[entity] &&
          (await tx.waybill.count({
            where: {
              organizationId: user.organizationId,
              ...filters[entity],
              status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED"] },
            },
          }))
        )
          throw new ConflictException("Есть незавершённые перевозки");
        const updated = await delegate.update({
          where: { id },
          data:
            entity === "counterparties"
              ? { status: "ARCHIVED" }
              : {
                  archivedAt: new Date(),
                  ...(entity === "vehicles" ? { status: "ARCHIVED" } : {}),
                },
        });
        await this.audit(
          tx,
          user,
          "reference.archive",
          entity,
          id,
          record,
          updated,
          dto.reason,
        );
        return updated;
      },
    );
  }
  async assignAccess(id: string, dto: AccessDto, user: CurrentUser) {
    this.require(user, "users.manage");
    if (!user.accessAllObjects)
      throw new ForbiddenException("Назначения доступны администратору");
    this.reason(dto.reason);
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!target) throw new NotFoundException("Пользователь не найден");
      for (const wid of dto.warehouseScopeIds)
        await this.warehouse(tx, wid, user);
      for (const sid of dto.extractionScopeIds)
        if (
          !(await tx.extractionSite.findFirst({
            where: { id: sid, organizationId: user.organizationId },
          }))
        )
          throw new BadRequestException("Участок недоступен");
      if (
        dto.counterpartyScopeId &&
        !(await tx.counterparty.findFirst({
          where: {
            id: dto.counterpartyScopeId,
            organizationId: user.organizationId,
          },
        }))
      )
        throw new BadRequestException("Контрагент недоступен");
      const updated = await tx.user.update({
        where: { id },
        data: {
          accessAllObjects: dto.accessAllObjects,
          counterpartyScopeId: dto.counterpartyScopeId ?? null,
          warehouseScopeIds: dto.warehouseScopeIds,
          extractionScopeIds: dto.extractionScopeIds,
        },
        select: {
          id: true,
          accessAllObjects: true,
          counterpartyScopeId: true,
          warehouseScopeIds: true,
          extractionScopeIds: true,
        },
      });
      await this.audit(
        tx,
        user,
        "user.access",
        "User",
        id,
        {
          accessAllObjects: target.accessAllObjects,
          counterpartyScopeId: target.counterpartyScopeId,
          warehouseScopeIds: target.warehouseScopeIds,
          extractionScopeIds: target.extractionScopeIds,
        },
        updated,
        dto.reason,
      );
      return updated;
    });
  }
}
