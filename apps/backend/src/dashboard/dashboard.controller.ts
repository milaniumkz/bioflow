import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser as CurrentUserDecorator,
  CurrentUser,
} from "../common/current-user.decorator";
import { createdAtRange, DateRangeQuery } from "../common/date-range";
import { Permissions } from "../common/permissions.decorator";
import { scopedBatch } from "../ledger/ledger-policy";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("dashboard")
@ApiBearerAuth()
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Permissions("dashboard.read")
  @Get()
  async overview(
    @Query() query: DateRangeQuery,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    const range = createdAtRange(query);
    const scope = user.accessAllObjects
      ? {}
      : {
          ...(user.counterpartyScopeId
            ? { counterpartyId: user.counterpartyScopeId }
            : {}),
          AND: [
            {
              OR: [
                {
                  destinationWarehouseId: { in: user.warehouseScopeIds ?? [] },
                },
                { extractionSiteId: { in: user.extractionScopeIds ?? [] } },
              ],
            },
          ],
        };
    const tripWhere = {
      organizationId: user.organizationId,
      batchId: { not: null },
      ...scope,
      ...range,
    };
    const [waybills, activeWaybills, stocks, recentMovements, discrepancies] =
      await this.prisma.$transaction([
        this.prisma.waybill.count({ where: tripWhere }),
        this.prisma.waybill.count({
          where: {
            ...tripWhere,
            status: { notIn: ["CANCELLED", "COMPLETED", "REJECTED"] },
          },
        }),
        this.prisma.batchStock.findMany({
          where: {
            batch: scopedBatch(user),
            ...(user.accessAllObjects
              ? {}
              : { warehouseId: { in: user.warehouseScopeIds ?? [] } }),
          },
          include: { batch: true },
        }),
        this.prisma.batchMovement.findMany({
          where: {
            organizationId: user.organizationId,
            batch: scopedBatch(user),
            ...(user.accessAllObjects
              ? {}
              : { warehouseId: { in: user.warehouseScopeIds ?? [] } }),
            ...range,
          },
          take: 10,
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.waybill.count({
          where: { ...tripWhere, discrepancyReason: { not: null } },
        }),
      ]);
    const warehouses = await this.prisma.warehouse.findMany({
      where: {
        organizationId: user.organizationId,
        id: { in: [...new Set(stocks.map((s) => s.warehouseId))] },
      },
    });
    const balances = stocks.map((stock) => ({
      ...stock,
      state: stock.batch.state,
      warehouse: warehouses.find((w) => w.id === stock.warehouseId),
    }));
    return {
      waybills,
      activeWaybills,
      balances,
      recentMovements,
      discrepancies,
    };
  }
}
