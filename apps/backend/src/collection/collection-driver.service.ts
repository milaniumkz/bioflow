import { readDriverRoute } from "./collection-route";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "crypto";
import {
  CollectionService,
  assertCollectionDatabase,
} from "./collection.service";
import { ClaimDriverDto, DriverPointsDto } from "./collection-driver.dto";
import { CollectionDriverEventDto } from "./collection.dto";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
@Injectable()
export class CollectionDriverService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private logger = new Logger(CollectionDriverService.name);
  constructor(private readonly collection: CollectionService) {}
  onModuleInit() {
    if (process.env.COLLECTION_ENABLED !== "true") return;
    assertCollectionDatabase();
    this.timer = setInterval(
      () =>
        void this.alerts().catch(() =>
          this.logger.warn("Signal alert check failed; will retry"),
        ),
      30000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async claim(dto: ClaimDriverDto) {
    assertCollectionDatabase();
    return this.collection.db.$transaction(async (tx) => {
      const trip = await tx.collectionTrip.findUnique({
        where: { qrTokenHash: hash(dto.token) },
      });
      if (!trip || ["ACCEPTED", "CANCELLED"].includes(trip.status))
        throw new BadRequestException("QR не найден или перевозка завершена");
      await tx.$queryRaw`SELECT id FROM "CollectionTrip" WHERE id = ${trip.id} FOR UPDATE`;
      let session = await tx.collectionDriverSession.findUnique({
        where: { tripId: trip.id },
      });
      const newSession = !session;
      if (session) {
        if (
          session.tokenHash !== hash(dto.clientToken) ||
          session.stoppedAt ||
          session.expiresAt <= new Date()
        )
          throw new ConflictException("QR уже использован водителем");
      } else {
        session = await tx.collectionDriverSession.create({
          data: {
            tripId: trip.id,
            tokenHash: hash(dto.clientToken),
            driverPlate: dto.plateNumber.trim().toUpperCase(),
            driverPhone: dto.phone,
            expiresAt: new Date(Date.now() + 24 * 3600_000),
          },
        });
      }
      const warehouse = trip.warehouseId
        ? await tx.collectionLocation.findUniqueOrThrow({
            where: { id: trip.warehouseId },
          })
        : null;
      if (newSession) {
        const tripLink = {
          section: trip.kind === "GP" ? "gp" : "inbound",
          entityId: trip.id,
          locationId: trip.warehouseId ?? trip.fromLocationId ?? undefined,
        };
        const already = await tx.collectionAction.findFirst({
          where: {
            kind: "DRIVER_CLAIM",
            details: { path: ["sessionId"], equals: session.id },
          },
        });
        if (!already) {
          await tx.collectionAction.create({
            data: {
              organizationId: trip.organizationId,
              locationId: trip.warehouseId ?? trip.fromLocationId!,
              kind: "DRIVER_CLAIM",
              quantityKg: trip.weightKg,
              createdById: trip.createdById,
              details: { sessionId: session.id, tripId: trip.id },
            },
          });
          await this.collection.notify(
            tx,
            trip.organizationId,
            [
              trip.createdById,
              ...(await this.collection.managers(
                tx,
                trip.warehouseId ?? trip.fromLocationId!,
              )),
            ],
            "Водитель отсканировал QR",
            `${trip.number}: ${session.driverPlate}, ${session.driverPhone}. ${trip.bagCount} мешков/бигбегов, ${trip.weightKg} кг.`,
            "COLLECTION_DRIVER_CLAIM",
            tripLink,
          );
        }
      }
      return {
        token: dto.clientToken,
        expiresAt: session.expiresAt,
        waybillNumber: trip.number,
        warehouse:
          warehouse?.name ?? `${trip.recipientName}, ${trip.recipientAddress}`,
        plateNumber: session.driverPlate,
        status: trip.status,
      };
    });
  }
  private async session(header?: string, closed = false) {
    assertCollectionDatabase();
    const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || token.length > 256) throw new UnauthorizedException();
    const session = await this.collection.db.collectionDriverSession.findUnique(
      { where: { tokenHash: hash(token) }, include: { trip: true } },
    );
    if (
      !session ||
      session.expiresAt.getTime() + 7 * 24 * 3600_000 <= Date.now() ||
      (!closed && session.stoppedAt)
    )
      throw new UnauthorizedException("Сессия рейса завершена");
    return session;
  }
  async route(header: string, cursor?: string) {
    const session = await this.session(header, true);
    return readDriverRoute(this.collection.db, session.id, cursor);
  }
  async points(header: string, dto: DriverPointsDto) {
    const session = await this.session(header, true);
    return this.collection.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CollectionDriverSession" WHERE id = ${session.id} FOR UPDATE`;
      const current = await tx.collectionDriverSession.findUniqueOrThrow({
        where: { id: session.id },
        include: { trip: true },
      });
      const end = Math.min(
        current.expiresAt.getTime(),
        current.trip.arrivedAt?.getTime() ?? Infinity,
        current.stoppedAt?.getTime() ?? Infinity,
      );
      if (
        dto.points.some(
          (point) =>
            new Date(point.recordedAt).getTime() <
              current.createdAt.getTime() - 60_000 ||
            new Date(point.recordedAt).getTime() >
              Math.min(Date.now() + 60_000, end),
        )
      )
        throw new BadRequestException("Время координаты вне рейса");
      await tx.collectionDriverPoint.createMany({
        data: dto.points.map((point) => ({
          ...point,
          sessionId: session.id,
          recordedAt: new Date(point.recordedAt),
        })),
        skipDuplicates: true,
      });
      if (
        dto.points.some(
          (point) =>
            new Date(point.recordedAt).getTime() > Date.now() - 10 * 60_000,
        )
      )
        await tx.collectionDriverSession.update({
          where: { id: session.id },
          data: { lastAlertedSignalAt: null },
        });
      return { accepted: dto.points.length };
    });
  }
  async event(header: string, dto: CollectionDriverEventDto) {
    const session = await this.session(header, true);
    return this.collection.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CollectionTrip" WHERE id = ${session.tripId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "CollectionDriverSession" WHERE id = ${session.id} FOR UPDATE`;
      const previous = await tx.collectionDriverEvent.findUnique({
        where: {
          sessionId_requestId: {
            sessionId: session.id,
            requestId: dto.requestId,
          },
        },
      });
      if (previous) {
        if (
          previous.type !== dto.type ||
          previous.recordedAt.getTime() !== new Date(dto.recordedAt).getTime()
        )
          throw new ConflictException("Ключ события уже использован");
        return { accepted: true, status: dto.type };
      }
      const current = await tx.collectionDriverSession.findUniqueOrThrow({
        where: { id: session.id },
        include: { trip: true },
      });
      if (current.stoppedAt) throw new UnauthorizedException();
      const date = new Date(dto.recordedAt);
      if (
        date.getTime() < current.createdAt.getTime() - 60_000 ||
        date.getTime() >
          Math.min(Date.now() + 60_000, current.expiresAt.getTime())
      )
        throw new BadRequestException("Время события вне рейса");
      const expected = {
        LOADED: "CREATED",
        DEPARTED: "LOADED",
        ARRIVED: "IN_TRANSIT",
      }[dto.type];
      if (current.trip.status !== expected)
        throw new ConflictException("Сначала отметьте предыдущий этап рейса");
      const previousAt =
        current.trip.departedAt ?? current.trip.loadedAt ?? current.createdAt;
      if (date.getTime() < previousAt.getTime() - 1000)
        throw new BadRequestException("События рейса должны идти по порядку");
      await tx.collectionDriverEvent.create({
        data: {
          sessionId: session.id,
          requestId: dto.requestId,
          type: dto.type,
          recordedAt: date,
        },
      });
      await tx.collectionTrip.update({
        where: { id: session.tripId },
        data:
          dto.type === "LOADED"
            ? { status: "LOADED", loadedAt: date }
            : dto.type === "DEPARTED"
              ? { status: "IN_TRANSIT", departedAt: date }
              : { status: "ARRIVED", arrivedAt: date },
      });
      if (dto.type === "ARRIVED") {
        const trip = current.trip;
        await tx.collectionDriverSession.update({
          where: { id: session.id },
          data: { stoppedAt: new Date() },
        });
        if (trip.kind === "RAW" && trip.warehouseId) {
          await tx.collectionBatch.create({
            data: {
              organizationId: trip.organizationId,
              locationId: trip.warehouseId,
              state: "RAW",
              status: "PENDING",
              totalKg: trip.weightKg,
              remainingKg: 0,
              bagCount: trip.bagCount,
              sourceType: "TRIP",
              sourceId: trip.id,
              createdById: trip.createdById,
            },
          });
          await this.collection.notify(
            tx,
            trip.organizationId,
            [
              trip.createdById,
              ...(await this.collection.managers(tx, trip.warehouseId)),
            ],
            "Водитель прибыл — подтвердите приход",
            `${trip.number}: машина ${current.driverPlate}, ${trip.bagCount} мешков, общий вес ${trip.weightKg} кг. Подтвердите приход.`,
            "COLLECTION_RAW_ARRIVED",
            {
              section: "inbound",
              entityId: trip.id,
              locationId: trip.warehouseId,
            },
          );
        } else if (trip.kind === "GP") {
          await tx.collectionBag.updateMany({
            where: { tripId: trip.id },
            data: { status: "DELIVERED" },
          });
          await this.collection.notify(
            tx,
            trip.organizationId,
            [
              trip.createdById,
              ...(await this.collection.managers(tx, trip.fromLocationId!)),
            ],
            "Готовая продукция доставлена",
            `${trip.number}: машина ${current.driverPlate}, ${trip.bagCount} бигбегов, ${trip.weightKg} кг. Водитель отметил прибытие к ${trip.recipientName}.`,
            "COLLECTION_GP_ARRIVED",
            {
              section: "gp",
              entityId: trip.id,
              locationId: trip.fromLocationId ?? undefined,
            },
          );
        }
      }
      if (dto.type !== "ARRIVED") {
        const trip = current.trip;
        await this.collection.notify(
          tx,
          trip.organizationId,
          [
            trip.createdById,
            ...(await this.collection.managers(
              tx,
              trip.warehouseId ?? trip.fromLocationId!,
            )),
          ],
          dto.type === "LOADED" ? "Машина загрузилась" : "Машина выехала",
          `${trip.number}: ${current.driverPlate}, ${trip.bagCount} мешков/бигбегов, ${trip.weightKg} кг.`,
          dto.type === "LOADED" ? "COLLECTION_LOADED" : "COLLECTION_DEPARTED",
          {
            section: trip.kind === "GP" ? "gp" : "inbound",
            entityId: trip.id,
            locationId: trip.warehouseId ?? trip.fromLocationId ?? undefined,
          },
        );
      }
      return { accepted: true, status: dto.type };
    });
  }
  async stop(header: string) {
    const session = await this.session(header, true);
    return this.collection.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CollectionDriverSession" WHERE id = ${session.id} FOR UPDATE`;
      const current = await tx.collectionDriverSession.findUniqueOrThrow({
        where: { id: session.id },
        include: { trip: true },
      });
      if (!current.stoppedAt) {
        await tx.collectionDriverSession.update({
          where: { id: session.id },
          data: { stoppedAt: new Date() },
        });
        const trip = current.trip;
        if (!["ARRIVED", "ACCEPTED"].includes(trip.status))
          await this.collection.notify(
            tx,
            trip.organizationId,
            [
              trip.createdById,
              ...(await this.collection.managers(
                tx,
                trip.warehouseId ?? trip.fromLocationId!,
              )),
            ],
            "Отслеживание водителя остановлено",
            `${trip.number}: ${current.driverPlate}, ${current.driverPhone}. Водитель остановил передачу координат до завершения рейса.`,
            "COLLECTION_TRACKING_STOPPED",
            {
              section: trip.kind === "GP" ? "gp" : "inbound",
              entityId: trip.id,
              locationId: trip.warehouseId ?? trip.fromLocationId ?? undefined,
            },
          );
      }
      return { stopped: true };
    });
  }
  async alerts() {
    if (this.running) return;
    this.running = true;
    try {
      assertCollectionDatabase();
      const cutoff = new Date(Date.now() - 10 * 60_000);
      const candidates = await this.collection.db.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM "CollectionDriverSession" s JOIN "CollectionTrip" t ON t.id = s."tripId"
        LEFT JOIN LATERAL (SELECT MAX("recordedAt") AS latest FROM "CollectionDriverPoint" p WHERE p."sessionId" = s.id) p ON true
        WHERE s."stoppedAt" IS NULL AND s."expiresAt" > NOW() AND s."lastAlertedSignalAt" IS NULL
        AND t.status IN ('CREATED','LOADED','IN_TRANSIT') AND COALESCE(p.latest,s."createdAt") <= ${cutoff}
        ORDER BY s."createdAt" LIMIT 100`;
      for (const candidate of candidates)
        await this.collection.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "CollectionDriverSession" WHERE id = ${candidate.id} FOR UPDATE`;
          const session = await tx.collectionDriverSession.findUniqueOrThrow({
            where: { id: candidate.id },
            include: {
              trip: true,
              points: { orderBy: { recordedAt: "desc" }, take: 1 },
            },
          });
          const last = session.points[0]?.recordedAt ?? session.createdAt;
          if (
            session.stoppedAt ||
            session.expiresAt <= new Date() ||
            session.lastAlertedSignalAt ||
            last > cutoff ||
            ["ARRIVED", "ACCEPTED", "CANCELLED"].includes(session.trip.status)
          )
            return;
          await this.collection.notify(
            tx,
            session.trip.organizationId,
            [session.trip.createdById],
            "Нет координат водителя 10 минут",
            `${session.trip.number}: проверьте связь с водителем. Возможна потеря GPS, интернета или остановка приложения.`,
            "DRIVER_SIGNAL_LOST",
          );
          await tx.collectionDriverSession.update({
            where: { id: session.id },
            data: { lastAlertedSignalAt: last },
          });
        });
    } finally {
      this.running = false;
    }
  }
}
