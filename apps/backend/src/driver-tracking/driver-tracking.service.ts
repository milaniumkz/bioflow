import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "../common/current-user.decorator";
import { DriverPointsDto } from "./driver-tracking.dto";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const terminal = ["CANCELLED", "COMPLETED", "UNLOADED", "REJECTED"];
@Injectable()
export class DriverTrackingService {
  constructor(private readonly db: PrismaService) {}
  async claim(qr: string, token: string, plateNumber: string, phone: string) {
    const waybill = await this.db.waybill.findUnique({
      where: { qrTokenHash: hash(qr) },
      include: { vehicle: true },
    });
    if (
      !waybill ||
      terminal.includes(waybill.status) ||
      waybill.status === "DRAFT"
    )
      throw new BadRequestException("QR не найден или перевозка завершена");
    const normalizePlate = (value: string) =>
      value.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (
      waybill.vehicle &&
      normalizePlate(plateNumber) !==
        normalizePlate(waybill.vehicle.plateNumber)
    )
      throw new BadRequestException(
        "Госномер не совпадает с машиной в перевозке",
      );
    const expiresAt = new Date(Date.now() + 24 * 3600_000);
    try {
      await this.db.driverTrackingSession.create({
        data: {
          waybillId: waybill.id,
          tokenHash: hash(token),
          expiresAt,
          driverPhone: phone,
          driverPlate: plateNumber.toUpperCase().trim(),
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        const existing = await this.db.driverTrackingSession.findUnique({
          where: { waybillId: waybill.id },
        });
        if (
          existing &&
          existing.tokenHash === hash(token) &&
          !existing.stoppedAt &&
          existing.expiresAt > new Date()
        )
          return {
            token,
            expiresAt: existing.expiresAt,
            waybillNumber: waybill.number,
            plateNumber: waybill.vehicle?.plateNumber ?? plateNumber,
          };
        throw new ConflictException("Этот QR уже использован водителем");
      }
      throw e;
    }
    return {
      token,
      expiresAt,
      waybillNumber: waybill.number,
      plateNumber: waybill.vehicle?.plateNumber ?? plateNumber,
    };
  }
  private async session(header?: string, historical = false) {
    const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || token.length > 256) throw new UnauthorizedException();
    const session = await this.db.driverTrackingSession.findUnique({
      where: { tokenHash: hash(token) },
      include: { waybill: true },
    });
    if (
      !session ||
      session.stoppedAt ||
      (historical
        ? session.expiresAt.getTime() + 7 * 24 * 3600_000 <= Date.now()
        : session.expiresAt <= new Date()) ||
      (!historical && terminal.includes(session.waybill.status))
    )
      throw new UnauthorizedException(
        "Отслеживание завершено или срок рейса истёк",
      );
    return session;
  }
  async points(header: string | undefined, dto: DriverPointsDto) {
    const session = await this.session(header, true);
    const now = Date.now();
    if (
      dto.points.some(
        (p) =>
          new Date(p.recordedAt).getTime() <
            session.createdAt.getTime() - 60_000 ||
          new Date(p.recordedAt).getTime() > now + 60_000,
      )
    )
      throw new BadRequestException("Время координаты вне рейса");
    // Retries after lost responses are idempotent via (sessionId, sequence).
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "DriverTrackingSession" WHERE id = ${session.id} FOR UPDATE`;
      const current = await tx.driverTrackingSession.findUniqueOrThrow({
        where: { id: session.id },
        include: { waybill: true },
      });
      if (
        current.stoppedAt ||
        current.expiresAt.getTime() + 7 * 24 * 3600_000 <= Date.now()
      )
        throw new UnauthorizedException();
      const endedAt = Math.min(
        current.expiresAt.getTime(),
        terminal.includes(current.waybill.status)
          ? (current.waybill.completedAt ?? current.waybill.updatedAt).getTime()
          : Infinity,
      );
      if (dto.points.some((p) => new Date(p.recordedAt).getTime() > endedAt))
        throw new BadRequestException(
          "Координата записана после завершения рейса",
        );
      await tx.driverLocation.createMany({
        data: dto.points.map((p) => ({
          ...p,
          recordedAt: new Date(p.recordedAt),
          sessionId: session.id,
        })),
        skipDuplicates: true,
      });
      // Receiving genuinely recent GPS closes the outage. Old offline batches do not.
      if (
        dto.points.some(
          (p) => new Date(p.recordedAt).getTime() > Date.now() - 10 * 60_000,
        )
      )
        await tx.driverTrackingSession.update({
          where: { id: session.id },
          data: { lastAlertedSignalAt: null },
        });
    });
    return { accepted: dto.points.length };
  }
  async stop(header?: string) {
    const session = await this.session(header, true);
    await this.db.driverTrackingSession.update({
      where: { id: session.id },
      data: { stoppedAt: new Date() },
    });
    return { stopped: true };
  }
  async checkSignalGaps() {
    const cutoff = new Date(Date.now() - 10 * 60_000);
    // Filter in SQL so already alerted sessions cannot starve later sessions.
    const candidates = await this.db.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM "DriverTrackingSession" s
      JOIN "Waybill" w ON w.id = s."waybillId"
      LEFT JOIN LATERAL (SELECT MAX("recordedAt") AS latest FROM "DriverLocation" p WHERE p."sessionId" = s.id) p ON true
      WHERE s."stoppedAt" IS NULL AND s."expiresAt" > NOW()
      AND w.status NOT IN ('CANCELLED', 'COMPLETED', 'UNLOADED', 'REJECTED')
      AND COALESCE(p.latest, s."createdAt") <= ${cutoff}
      AND s."lastAlertedSignalAt" IS NULL
      ORDER BY s."createdAt" LIMIT 100`;
    for (const candidate of candidates) {
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "DriverTrackingSession" WHERE id = ${candidate.id} FOR UPDATE`;
        const session = await tx.driverTrackingSession.findUniqueOrThrow({
          where: { id: candidate.id },
          include: {
            waybill: true,
            points: { orderBy: { recordedAt: "desc" }, take: 1 },
          },
        });
        const signal = session.points[0]?.recordedAt ?? session.createdAt;
        if (
          session.stoppedAt ||
          session.expiresAt <= new Date() ||
          terminal.includes(session.waybill.status) ||
          signal > cutoff ||
          session.lastAlertedSignalAt !== null
        )
          return;
        const recipient = await tx.user.findFirst({
          where: {
            id: session.waybill.createdById,
            organizationId: session.waybill.organizationId,
            isBlocked: false,
          },
        });
        if (!recipient) return;
        const id = `driver-signal:${session.id}:${signal.getTime()}:${recipient.id}`;
        await tx.notification.upsert({
          where: { id },
          update: {},
          create: {
            id,
            organizationId: session.waybill.organizationId,
            userId: recipient.id,
            type: "DRIVER_SIGNAL_LOST",
            title: "Нет координат водителя 10 минут",
            body: `Перевозка ${session.waybill.number}: новые координаты не поступали 10 минут. Возможна потеря GPS, интернета или остановка приложения. Свяжитесь с водителем.`,
          },
        });
        const devices = await tx.device.findMany({
          where: { userId: recipient.id, pushToken: { not: null } },
        });
        for (const device of devices)
          await tx.pushDelivery.upsert({
            where: {
              notificationId_deviceId: {
                notificationId: id,
                deviceId: device.id,
              },
            },
            update: {},
            create: { notificationId: id, deviceId: device.id },
          });
        await tx.driverTrackingSession.update({
          where: { id: session.id },
          data: { lastAlertedSignalAt: signal },
        });
      });
    }
  }
  async position(waybillId: string, user: CurrentUser) {
    if (!user.roles?.some((r) => ["OWNER", "ADMIN"].includes(r)))
      throw new ForbiddenException();
    const trip = await this.db.waybill.findFirst({
      where: { id: waybillId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!trip) throw new NotFoundException();
    const session = await this.db.driverTrackingSession.findUnique({
      where: { waybillId },
      include: {
        waybill: { select: { status: true } },
        points: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
    });
    if (!session) return { status: "NOT_STARTED", point: null };
    const point = session.points[0] ?? null;
    const ended =
      session.stoppedAt ||
      session.expiresAt <= new Date() ||
      terminal.includes(session.waybill.status);
    return {
      status: ended
        ? "STOPPED"
        : !point
          ? "WAITING"
          : Date.now() - point.recordedAt.getTime() > 120_000
            ? "STALE"
            : "ACTIVE",
      point,
      driverPhone: session.driverPhone,
      driverPlate: session.driverPlate,
      expiresAt: session.expiresAt,
      stoppedAt: session.stoppedAt,
    };
  }
}
