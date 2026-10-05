import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser as CurrentUserDecorator, CurrentUser } from "../common/current-user.decorator";
import { orderBy, PageDto } from "../common/page.dto";
import { Permissions } from "../common/permissions.decorator";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("audit")
@ApiBearerAuth()
@Controller("audit")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Permissions("audit.read")
  @Get()
  async list(@Query() query: PageDto, @CurrentUserDecorator() user: CurrentUser) {
    const where: any = { organizationId: user.organizationId };
    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: "insensitive" } },
        { entity: { contains: query.search, mode: "insensitive" } },
        { entityId: { contains: query.search, mode: "insensitive" } }
      ];
    }
    if (query.status) where.action = { contains: query.status, mode: "insensitive" };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: orderBy(query, ["createdAt", "action", "entity"])
      }),
      this.prisma.auditLog.count({ where })
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }
}
