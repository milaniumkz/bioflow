import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser as CurrentUserDecorator,
  CurrentUser,
} from "../common/current-user.decorator";
import { publicAuditValue } from "../common/audit-public";
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
  async list(
    @Query() query: PageDto,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    const where: any = {
      organizationId: user.organizationId,
      ...(!user.accessAllObjects ? { userId: user.id } : {}),
    };
    if (query.search) {
      where.OR = [
        { user: { fullName: { contains: query.search, mode: "insensitive" } } },
        { reason: { contains: query.search, mode: "insensitive" } },
        { action: { contains: query.search, mode: "insensitive" } },
        { entity: { contains: query.search, mode: "insensitive" } },
        { entityId: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.status)
      where.action = { contains: query.status, mode: "insensitive" };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { fullName: true } } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: orderBy(query, ["createdAt", "action", "entity"]),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const values = data
      .flatMap((row) => [row.oldValue, row.newValue])
      .filter((v) => v && typeof v === "object") as Array<Record<string, any>>;
    const ids = (key: string) =>
      [
        ...new Set(
          values.flatMap((v) =>
            Array.isArray(v[key])
              ? v[key]
              : typeof v[key] === "string"
                ? [v[key]]
                : [],
          ),
        ),
      ] as string[];
    const [warehouses, sites, parties] = await Promise.all([
      ids("warehouseScopeIds").length
        ? this.prisma.warehouse.findMany({
            where: {
              organizationId: user.organizationId,
              id: {
                in: ids("warehouseScopeIds").filter(
                  (id) =>
                    user.accessAllObjects ||
                    (user.warehouseScopeIds ?? []).includes(id),
                ),
              },
            },
            select: { id: true, name: true },
          })
        : [],
      ids("extractionScopeIds").length
        ? this.prisma.extractionSite.findMany({
            where: {
              organizationId: user.organizationId,
              id: {
                in: ids("extractionScopeIds").filter(
                  (id) =>
                    user.accessAllObjects ||
                    (user.extractionScopeIds ?? []).includes(id),
                ),
              },
            },
            select: { id: true, name: true },
          })
        : [],
      ids("counterpartyScopeId").length
        ? this.prisma.counterparty.findMany({
            where: {
              organizationId: user.organizationId,
              id: {
                in: ids("counterpartyScopeId").filter(
                  (id) =>
                    user.accessAllObjects || user.counterpartyScopeId === id,
                ),
              },
            },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const targetIds = data
      .filter((row) => row.entity === "User" && row.entityId)
      .map((row) => row.entityId!);
    const targets =
      user.accessAllObjects && targetIds.length
        ? await this.prisma.user.findMany({
            where: {
              organizationId: user.organizationId,
              id: { in: targetIds },
            },
            select: { id: true, fullName: true },
          })
        : [];
    const scopeNames = {
      warehouseScopeIds: Object.fromEntries(
        warehouses.map((w) => [w.id, w.name]),
      ),
      extractionScopeIds: Object.fromEntries(sites.map((w) => [w.id, w.name])),
      counterpartyScopeId: Object.fromEntries(
        parties.map((w) => [w.id, w.name]),
      ),
    };
    return {
      data: data.map((row) => ({
        ...row,
        entityName:
          targets.find((target) => target.id === row.entityId)?.fullName ??
          row.entityId,
        oldValue: publicAuditValue(row.oldValue),
        newValue: publicAuditValue(row.newValue),
        scopeNames,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
