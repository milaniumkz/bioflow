import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { Prisma, Waybill } from "@prisma/client";
import { CurrentUser } from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { PrismaService } from "../prisma/prisma.service";
import { RoutePointsDto } from "./collection.dto";
import {
  distanceMetres,
  IDLE_THRESHOLD_MS,
  MAX_SAMPLE_GAP_MS,
  STOP_RADIUS_METRES,
} from "./tracking-policy";
const active = ["IN_TRANSIT"] as const;
type Tx = Prisma.TransactionClient;
@Injectable()
export class TrackingService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private checking = false;
  private readonly logger = new Logger(TrackingService.name);
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.checkStaleLocations().catch(() =>
        this.logger.warn("GPS freshness check will retry"),
      );
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  constructor(private readonly prisma: PrismaService) {}
  private where(user: CurrentUser, driver: boolean): Prisma.WaybillWhereInput {
    if (driver)
      return {
        organizationId: user.organizationId,
        driver: { userId: user.id, archivedAt: null },
      };
    return {
      organizationId: user.organizationId,
      ...(user.accessAllObjects
        ? {}
        : {
            createdById: user.id,
            extractionSiteId: { in: user.extractionScopeIds ?? [] },
            ...(user.counterpartyScopeId
              ? { counterpartyId: user.counterpartyScopeId }
              : {}),
          }),
    };
  }
  async trips(user: CurrentUser, query: PageDto, driver: boolean) {
    const where = this.where(user, driver);
    if (query.search)
      where.number = { contains: query.search, mode: "insensitive" };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.waybill.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: Math.min(query.pageSize, 100),
        skip: (query.page - 1) * Math.min(query.pageSize, 100),
        include: {
          vehicle: true,
          driver: { select: { fullName: true, phone: true } },
          destinationWarehouse: { select: { name: true } },
          routePoints: { orderBy: { recordedAt: "desc" }, take: 1 },
          routeStops: { where: { endedAt: null }, take: 1 },
        },
      }),
      this.prisma.waybill.count({ where }),
    ]);
    return {
      data,
      total,
      page: query.page,
      pageSize: Math.min(query.pageSize, 100),
    };
  }
  async driverScan(token: string, user: CurrentUser) {
    const trip = await this.prisma.waybill.findFirst({
      where: {
        ...this.where(user, true),
        qrTokenHash: createHash("sha256").update(token).digest("hex"),
      },
      select: { id: true, number: true, status: true },
    });
    if (!trip)
      throw new NotFoundException("Этот QR не относится к вашему рейсу");
    return trip;
  }
  async driverState(id: string, user: CurrentUser) {
    const trip = await this.prisma.waybill.findFirst({
      where: { id, ...this.where(user, true) },
      select: {
        id: true,
        status: true,
        loadedAt: true,
        departedAt: true,
        arrivedAt: true,
        acceptedAt: true,
      },
    });
    if (!trip) throw new NotFoundException("Вам не назначен этот рейс");
    return trip;
  }
  async route(id: string, query: PageDto, user: CurrentUser) {
    const trip = await this.prisma.waybill.findFirst({
      where: { id, ...this.where(user, false) },
    });
    if (!trip) throw new NotFoundException("Рейс недоступен");
    const pageSize = Math.min(query.pageSize, 100);
    const [data, total, stops] = await this.prisma.$transaction([
      this.prisma.routePoint.findMany({
        where: { waybillId: id },
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
        take: pageSize,
        skip: (query.page - 1) * pageSize,
      }),
      this.prisma.routePoint.count({ where: { waybillId: id } }),
      this.prisma.routeStop.findMany({
        where: { waybillId: id },
        orderBy: { startedAt: "desc" },
        take: 200,
      }),
    ]);
    const allPoints = await this.prisma.routePoint.findMany({
      where: { waybillId: id },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      select: { recordedAt: true, latitude: true, longitude: true },
    });
    let observedSeconds = 0,
      signalGapSeconds = 0,
      distance = 0;
    for (let i = 1; i < allPoints.length; i++) {
      const gap =
        (allPoints[i].recordedAt.getTime() -
          allPoints[i - 1].recordedAt.getTime()) /
        1000;
      if (gap * 1000 <= MAX_SAMPLE_GAP_MS) {
        observedSeconds += gap;
        distance += distanceMetres(allPoints[i - 1], allPoints[i]);
      } else signalGapSeconds += gap;
    }
    const allStops = await this.prisma.routeStop.findMany({
      where: { waybillId: id },
    });
    const stoppedSeconds = allStops.reduce(
      (s, x) => s + (x.lastObservedAt.getTime() - x.startedAt.getTime()) / 1000,
      0,
    );
    return {
      trip,
      data,
      total,
      stops,
      metrics: {
        observedSeconds,
        stoppedSeconds,
        movingSeconds: Math.max(0, observedSeconds - stoppedSeconds),
        signalGapSeconds,
        distanceKm: Number((distance / 1000).toFixed(3)),
        loadedAt: trip.loadedAt,
        departedAt: trip.departedAt,
        arrivedAt: trip.arrivedAt,
      },
      page: query.page,
      pageSize,
      stopRadiusMetres: STOP_RADIUS_METRES,
      idleThresholdMinutes: 10,
    };
  }
  private async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: "Serializable",
          timeout: 15000,
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          ["P2034", "P2002"].includes(e.code) &&
          attempt < 4
        )
          continue;
        throw e;
      }
    }
  }
  async positions(id: string, dto: RoutePointsDto, user: CurrentUser) {
    const now = Date.now();
    for (const p of dto.points) {
      const time = Date.parse(p.recordedAt);
      if (
        !Number.isFinite(time) ||
        time > now + 30_000 ||
        time < now - 7 * 86400_000
      )
        throw new BadRequestException(
          "Время точки должно быть не старше 7 дней и не в будущем",
        );
    }
    return this.transaction(async (tx) => {
      const trip = await tx.waybill.findFirst({
        where: { id, ...this.where(user, true) },
      });
      if (!trip) throw new NotFoundException("Вам не назначен этот рейс");
      const activeTrip = active.includes(
        trip.status as (typeof active)[number],
      );
      const closedAt = trip.arrivedAt ?? trip.acceptedAt;
      if (
        !activeTrip &&
        (!closedAt ||
          dto.points.some((p) => Date.parse(p.recordedAt) > closedAt.getTime()))
      )
        throw new ConflictException(
          "Рейс завершён или ещё не отправлен; новые точки не принимаются",
        );
      let latest = await tx.routePoint.findFirst({
        where: { waybillId: id },
        orderBy: { recordedAt: "desc" },
      });
      let inserted = 0;
      for (const p of [...dto.points].sort(
        (a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt),
      )) {
        const at = new Date(p.recordedAt);
        if (at < trip.createdAt)
          throw new BadRequestException("Точка записана до создания рейса");
        const existing = await tx.routePoint.findUnique({
          where: { id: p.id },
        });
        if (existing) {
          if (
            existing.waybillId !== id ||
            existing.userId !== user.id ||
            existing.recordedAt.getTime() !== at.getTime() ||
            existing.latitude !== p.latitude ||
            existing.longitude !== p.longitude ||
            existing.accuracy !== p.accuracy
          )
            throw new ConflictException(
              "Идентификатор точки уже использован для других данных",
            );
          continue;
        }
        const point = await tx.routePoint.create({
          data: { ...p, recordedAt: at, waybillId: id, userId: user.id },
        });
        inserted++;
        // Preserve late history, but never rewind or falsely prolong the live stop.
        if (latest && at <= latest.recordedAt) continue;
        let stop = await tx.routeStop.findFirst({
          where: { waybillId: id, endedAt: null },
          orderBy: { startedAt: "desc" },
        });
        if (
          stop &&
          (at.getTime() - stop.lastObservedAt.getTime() > MAX_SAMPLE_GAP_MS ||
            distanceMetres(stop, p) > STOP_RADIUS_METRES)
        ) {
          await tx.routeStop.update({
            where: { id: stop.id },
            data: { endedAt: stop.lastObservedAt },
          });
          stop = null;
        }
        if (!stop)
          stop = await tx.routeStop.create({
            data: {
              waybillId: id,
              latitude: p.latitude,
              longitude: p.longitude,
              startedAt: at,
              lastObservedAt: at,
            },
          });
        else
          stop = await tx.routeStop.update({
            where: { id: stop.id },
            data: { lastObservedAt: at },
          });
        if (
          activeTrip &&
          !stop.notifiedAt &&
          at.getTime() - stop.startedAt.getTime() > IDLE_THRESHOLD_MS &&
          now - at.getTime() <= MAX_SAMPLE_GAP_MS
        ) {
          await this.idleNotification(tx, trip, stop.id, stop.startedAt, at, p);
          await tx.routeStop.update({
            where: { id: stop.id },
            data: { notifiedAt: new Date() },
          });
        }
        latest = point;
      }
      return { accepted: dto.points.length, inserted };
    });
  }
  private async idleNotification(
    tx: Tx,
    trip: Waybill,
    stopId: string,
    startedAt: Date,
    lastAt: Date,
    point: { latitude: number; longitude: number },
  ) {
    const recipients = await tx.user.findMany({
      where: {
        organizationId: trip.organizationId,
        isBlocked: false,
        OR: [
          { id: trip.createdById },
          { userRoles: { some: { role: { code: "OWNER" } } } },
        ],
      },
    });
    for (const collector of recipients) {
      const driver = trip.driverId
        ? await tx.driver.findUnique({ where: { id: trip.driverId } })
        : null;
      const notification = await tx.notification.upsert({
        where: { id: `driver-idle:${stopId}:${collector.id}` },
        update: {},
        create: {
          id: `driver-idle:${stopId}:${collector.id}`,
          organizationId: trip.organizationId,
          userId: collector.id,
          type: "DRIVER_IDLE",
          title: "Простой водителя более 10 минут",
          body: `${trip.number}: ${driver?.fullName ?? "Водитель"}, ${Math.floor((lastAt.getTime() - startedAt.getTime()) / 60000)} мин. Телефон: ${driver?.phone ?? "не указан"}. Последняя точка: ${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}. Свяжитесь с водителем.`,
        },
      });
      const devices = await tx.device.findMany({
        where: { userId: collector.id, pushToken: { not: null } },
      });
      for (const device of devices)
        await tx.pushDelivery.upsert({
          where: {
            notificationId_deviceId: {
              notificationId: notification.id,
              deviceId: device.id,
            },
          },
          update: {},
          create: { notificationId: notification.id, deviceId: device.id },
        });
    }
  }
  async checkStaleLocations(now = new Date()) {
    if (this.checking) return;
    this.checking = true;
    try {
      let cursor: string | undefined;
      for (;;) {
        const trips = await this.prisma.waybill.findMany({
          where: {
            status: "IN_TRANSIT",
            departedAt: { lte: new Date(now.getTime() - IDLE_THRESHOLD_MS) },
            driverId: { not: null },
          },
          orderBy: { id: "asc" },
          take: 100,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: {
            driver: true,
            routePoints: { orderBy: { recordedAt: "desc" }, take: 1 },
          },
        });
        if (!trips.length) break;
        for (const trip of trips) {
          const latest = trip.routePoints[0];
          if (
            latest &&
            now.getTime() - latest.recordedAt.getTime() < IDLE_THRESHOLD_MS
          )
            continue;
          await this.prisma.$transaction(async (tx) => {
            const current = await tx.waybill.findFirst({
              where: { id: trip.id, status: "IN_TRANSIT" },
            });
            if (!current) return;
            const recipients = await tx.user.findMany({
              where: {
                organizationId: trip.organizationId,
                isBlocked: false,
                OR: [
                  { id: trip.createdById },
                  { userRoles: { some: { role: { code: "OWNER" } } } },
                ],
              },
              select: { id: true },
            });
            for (const recipient of recipients) {
              const id = `driver-gpslost:${trip.id}:${latest?.id ?? "no-point"}:${recipient.id}`;
              const body = `${trip.number}: геолокация ${trip.driver?.fullName ?? "водителя"} не обновляется 10 минут. ${latest ? `Последняя точка: ${latest.latitude.toFixed(6)}, ${latest.longitude.toFixed(6)}; ${latest.recordedAt.toISOString()}.` : "Координаты ещё не получены."} Телефон: ${trip.driver?.phone ?? "не указан"}. Свяжитесь с водителем.`;
              const notice = await tx.notification.upsert({
                where: { id },
                update: {},
                create: {
                  id,
                  organizationId: trip.organizationId,
                  userId: recipient.id,
                  type: "DRIVER_GPS_STALE",
                  title: "Геолокация водителя не обновляется",
                  body,
                },
              });
              const devices = await tx.device.findMany({
                where: { userId: recipient.id, pushToken: { not: null } },
              });
              for (const device of devices)
                await tx.pushDelivery.upsert({
                  where: {
                    notificationId_deviceId: {
                      notificationId: notice.id,
                      deviceId: device.id,
                    },
                  },
                  update: {},
                  create: { notificationId: notice.id, deviceId: device.id },
                });
            }
          });
        }
        cursor = trips[trips.length - 1].id;
        if (trips.length < 100) break;
      }
    } finally {
      this.checking = false;
    }
  }
  async status(
    id: string,
    status: "LOADED" | "IN_TRANSIT" | "ARRIVED",
    user: CurrentUser,
  ) {
    return this.transaction(async (tx) => {
      const trip = await tx.waybill.findFirst({
        where: { id, ...this.where(user, true) },
      });
      if (!trip) throw new NotFoundException("Вам не назначен этот рейс");
      if (trip.status === status) return { ok: true, status };
      if (
        !(
          status === "LOADED" &&
          trip.status === "CREATED" &&
          trip.bagCount !== null
        ) &&
        !(status === "IN_TRANSIT" && trip.status === "LOADED") &&
        !(status === "ARRIVED" && trip.status === "IN_TRANSIT")
      )
        throw new ConflictException("Этот переход статуса рейса недоступен");
      await tx.waybill.update({
        where: { id },
        data: {
          status,
          ...(status === "LOADED"
            ? { loadedAt: new Date() }
            : status === "IN_TRANSIT"
              ? { departedAt: new Date() }
              : { arrivedAt: new Date() }),
          version: { increment: 1 },
        },
      });
      if (status === "ARRIVED") {
        const stops = await tx.routeStop.findMany({
          where: { waybillId: id, endedAt: null },
        });
        for (const stop of stops)
          await tx.routeStop.update({
            where: { id: stop.id },
            data: { endedAt: stop.lastObservedAt },
          });
      }
      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: "driver.status",
          entity: "Waybill",
          entityId: id,
          newValue: { status },
        },
      });
      return { ok: true, status };
    });
  }
}
