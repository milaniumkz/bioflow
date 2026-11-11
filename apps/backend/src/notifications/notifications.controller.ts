import { readFileSync } from "fs";
import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser as CurrentUserDecorator,
  CurrentUser,
} from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Permissions("notifications.read")
  @Get("delivery-status")
  async deliveryStatus(@CurrentUserDecorator() user: CurrentUser) {
    let pushProviderConfigured = false;
    try {
      const account = JSON.parse(
        readFileSync(process.env.FCM_SERVICE_ACCOUNT_FILE ?? "", "utf8"),
      );
      pushProviderConfigured = !!(
        account.project_id &&
        account.client_email &&
        account.private_key
      );
    } catch {
      /* Missing configuration is exposed as status, without credential details. */
    }
    const registeredDevices = await this.prisma.device.count({
      where: { userId: user.id, pushToken: { not: null } },
    });
    return { pushProviderConfigured, registeredDevices };
  }

  @Permissions("notifications.read")
  @Get("unread-count")
  async unread(@CurrentUserDecorator() user: CurrentUser) {
    const unread = await this.prisma.notification.count({
      where: {
        organizationId: user.organizationId,
        readAt: null,
        OR: user.accessAllObjects
          ? [{ userId: user.id }, { userId: null }]
          : [{ userId: user.id }],
      },
    });
    return { unread };
  }

  @Permissions("notifications.read")
  @Get()
  async list(
    @Query() query: PageDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    const where = {
      organizationId: user.organizationId,
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
