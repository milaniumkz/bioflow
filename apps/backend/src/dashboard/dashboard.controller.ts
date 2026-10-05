import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser as CurrentUserDecorator, CurrentUser } from "../common/current-user.decorator";
import { createdAtRange, DateRangeQuery } from "../common/date-range";
import { Permissions } from "../common/permissions.decorator";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("dashboard")
@ApiBearerAuth()
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Permissions("dashboard.read")
  @Get()
  async overview(@Query() query: DateRangeQuery, @CurrentUserDecorator() user: CurrentUser) {
    const range = createdAtRange(query);
    const [waybills, activeWaybills, balances, recentMovements, discrepancies] = await this.prisma.$transaction([
      this.prisma.waybill.count({ where: { organizationId: user.organizationId, ...range } }),
      this.prisma.waybill.count({ where: { organizationId: user.organizationId, status: { in: ["CREATED", "LOADED", "IN_TRANSIT", "ARRIVED"] } } }),
      this.prisma.inventoryItem.findMany({ where: { warehouse: { organizationId: user.organizationId } }, include: { warehouse: true, materialType: true } }),
      this.prisma.inventoryMovement.findMany({ where: { organizationId: user.organizationId, ...range }, take: 10, orderBy: { createdAt: "desc" }, include: { warehouse: true } }),
      this.prisma.acceptance.count({ where: { reason: { not: null }, waybill: { organizationId: user.organizationId }, ...range } })
    ]);
    return { waybills, activeWaybills, balances, recentMovements, discrepancies };
  }
}
