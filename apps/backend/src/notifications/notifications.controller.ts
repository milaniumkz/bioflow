import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser as CurrentUserDecorator, CurrentUser } from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Permissions("notifications.read")
  @Get()
  async list(@Query() query: PageDto, @CurrentUserDecorator() user: CurrentUser) {
    const where = { organizationId: user.organizationId, OR: [{ userId: user.id }, { userId: null }] };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" }
      }),
      this.prisma.notification.count({ where })
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  @Permissions("notifications.read")
  @Post(":id/read")
  read(@Param("id") id: string, @CurrentUserDecorator() user: CurrentUser) {
    return this.prisma.notification.updateMany({
      where: { id, organizationId: user.organizationId, OR: [{ userId: user.id }, { userId: null }] },
      data: { readAt: new Date() }
    });
  }
}
