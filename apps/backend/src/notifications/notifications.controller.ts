import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser as CurrentUserDecorator,
  CurrentUser,
} from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

import { IsObject } from "class-validator";
import { parseWebSubscription, webPushReady } from "./web-push";
class BrowserPushDto {
  @IsObject() subscription!: Record<string, unknown>;
}

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Permissions("notifications.read")
  @Get("browser-push-key")
  browserPushKey() {
    return {
      available: webPushReady(),
      publicKey: webPushReady() ? process.env.WEB_PUSH_PUBLIC_KEY : null,
    };
  }
  @Permissions("notifications.read")
  @Post("browser-push")
  async browserPush(
    @Body() dto: BrowserPushDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    const pushToken = JSON.stringify(parseWebSubscription(dto.subscription));
    await this.prisma.$transaction(async (tx) => {
      // A shared browser must never keep delivering another account's notices.
      await tx.device.updateMany({
        where: { platform: "WEB_PUSH", pushToken, userId: { not: user.id } },
        data: { pushToken: null },
      });
      const existing = await tx.device.findFirst({
        where: { userId: user.id, platform: "WEB_PUSH", pushToken },
      });
      if (existing)
        await tx.device.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date() },
        });
      else
        await tx.device.create({
          data: { userId: user.id, platform: "WEB_PUSH", pushToken },
        });
    });
    return { ok: true };
  }
  @Permissions("notifications.read")
  @Get()
  async list(
    @Query() query: PageDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    const where: Prisma.NotificationWhereInput = {
      organizationId: user.organizationId,
      ...(query.status === "UNREAD"
        ? { readAt: null }
        : query.status === "READ"
          ? { readAt: { not: null } }
          : {}),
      ...(query.search
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: query.search, mode: "insensitive" } },
                  { body: { contains: query.search, mode: "insensitive" } },
                ],
              },
            ],
          }
        : {}),
      OR: user.accessAllObjects
        ? [{ userId: user.id }, { userId: null }]
        : [{ userId: user.id }],
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  @Permissions("notifications.read")
  @Post(":id/read")
  read(@Param("id") id: string, @CurrentUserDecorator() user: CurrentUser) {
    return this.prisma.notification.updateMany({
      where: {
        id,
        organizationId: user.organizationId,
        OR: user.accessAllObjects
          ? [{ userId: user.id }, { userId: null }]
          : [{ userId: user.id }],
      },
      data: { readAt: new Date() },
    });
  }
}
