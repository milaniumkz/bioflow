import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { createSign } from "crypto";
import { readFileSync } from "fs";
import { PrismaService } from "../prisma/prisma.service";

type Credentials = {
  project_id: string;
  client_email: string;
  private_key: string;
};
@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private access?: { token: string; until: number };
  private readonly logger = new Logger(DeliveryService.name);
  constructor(private readonly prisma: PrismaService) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.reminders();
      if (process.env.FCM_SERVICE_ACCOUNT_FILE) await this.deliver();
    } catch {
      this.logger.warn(
        "Notification worker failed; pending deliveries will retry",
      );
    } finally {
      this.running = false;
    }
  }
  private async reminders() {
    const hours = Number(process.env.TRANSPORT_OVERDUE_HOURS ?? 24);
    if (!Number.isFinite(hours) || hours <= 0) return;
    const overdue = await this.prisma.waybill.findMany({
      where: {
        batchId: { not: null },
        status: "IN_TRANSIT",
        updatedAt: { lt: new Date(Date.now() - hours * 3600_000) },
      },
      take: 100,
    });
    for (const trip of overdue) {
      const users = await this.prisma.user.findMany({
        where: {
          organizationId: trip.organizationId,
          isBlocked: false,
          OR: [
            { accessAllObjects: true },
            {
              warehouseScopeIds: { has: trip.destinationWarehouseId },
              OR: [
                { counterpartyScopeId: null },
                { counterpartyScopeId: trip.counterpartyId },
              ],
            },
            {
              userRoles: {
                some: { role: { code: { in: ["OWNER", "ADMIN"] } } },
              },
            },
          ],
        },
        select: { id: true },
      });
      for (const user of users) {
        const id = `overdue:${trip.id}:${user.id}:${new Date().toISOString().slice(0, 10)}`;
        await this.prisma.$transaction(async (tx) => {
          const notification = await tx.notification.upsert({
            where: { id },
            update: {},
            create: {
              id,
              organizationId: trip.organizationId,
              userId: user.id,
              type: "TRANSPORT_OVERDUE",
              title: "Задержка перевозки",
              body: `${trip.number}: в пути более ${hours} ч`,
            },
          });
          const devices = await tx.device.findMany({
            where: { userId: user.id, pushToken: { not: null } },
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
        });
      }
    }
  }
  private async token(c: Credentials) {
    if (this.access && this.access.until > Date.now() + 60_000)
      return this.access.token;
    const encode = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const claim = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: c.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const signature = createSign("RSA-SHA256")
      .update(claim)
      .sign(c.private_key, "base64url");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${claim}.${signature}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("FCM authorization unavailable");
    const result = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.access = {
      token: result.access_token,
      until: Date.now() + result.expires_in * 1000,
    };
    return result.access_token;
  }
  private async deliver() {
    const credentials = JSON.parse(
      readFileSync(process.env.FCM_SERVICE_ACCOUNT_FILE!, "utf8"),
    ) as Credentials;
    if (
      !credentials.project_id ||
      !credentials.client_email ||
      !credentials.private_key
    )
      throw new Error("Invalid FCM credentials");
    await this.prisma.pushDelivery.updateMany({
      where: {
        status: "PROCESSING",
        updatedAt: { lt: new Date(Date.now() - 5 * 60_000) },
      },
      data: { status: "PENDING" },
    });
    const pending = await this.prisma.pushDelivery.findMany({
      where: { status: "PENDING", attempts: { lt: 10 } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const delivery of pending) {
      const claimed = await this.prisma.pushDelivery.updateMany({
        where: { id: delivery.id, status: "PENDING" },
        data: { status: "PROCESSING", attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      const [device, notice] = await Promise.all([
        this.prisma.device.findUnique({ where: { id: delivery.deviceId } }),
        this.prisma.notification.findUnique({
          where: { id: delivery.notificationId },
        }),
      ]);
      if (!device?.pushToken || !notice || notice.userId !== device.userId) {
        await this.prisma.pushDelivery.update({
          where: { id: delivery.id },
          data: { status: "FAILED", lastError: "Recipient unavailable" },
        });
        continue;
      }
      try {
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.project_id)}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${await this.token(credentials)}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token: device.pushToken,
                notification: { title: notice.title, body: notice.body },
                data: { notificationId: notice.id, type: notice.type },
              },
            }),
            signal: AbortSignal.timeout(15_000),
          },
        );
        await this.prisma.pushDelivery.update({
          where: { id: delivery.id },
          data: response.ok
            ? { status: "SENT", deliveredAt: new Date(), lastError: null }
            : {
                status: [400, 404].includes(response.status)
                  ? "FAILED"
                  : "PENDING",
                lastError: `FCM HTTP ${response.status}`,
              },
        });
      } catch {
        await this.prisma.pushDelivery.update({
          where: { id: delivery.id },
          data: { status: "PENDING", lastError: "Delivery unavailable" },
        });
      }
    }
  }
}
