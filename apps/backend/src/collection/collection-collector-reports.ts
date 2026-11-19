import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  IsInt,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";
import { Prisma } from "@prisma/client";
import {
  CurrentUser as User,
  CurrentUser,
} from "../common/current-user.decorator";
import { CollectionService } from "./collection.service";
export class CollectorReportQuery {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsIn(["delivery", "dispatch", "acceptance"]) basis:
    "delivery" | "dispatch" | "acceptance" = "delivery";
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export function collectorReportPeriod(
  query: Pick<CollectorReportQuery, "from" | "to">,
) {
  function date(value: string) {
    const utc = new Date(value + "T00:00:00.000Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(utc.getTime()) ||
      utc.toISOString().slice(0, 10) !== value
    )
      throw new BadRequestException("Укажите существующую календарную дату");
    return new Date(utc.getTime() - 5 * 60 * 60 * 1000);
  }
  const start = query.from ? date(query.from) : undefined,
    end = query.to
      ? new Date(date(query.to).getTime() + 24 * 60 * 60 * 1000)
      : undefined;
  if (query.from && query.to && query.from > query.to)
    throw new BadRequestException("Дата «с» не должна быть позже даты «по»");
  return { start, end };
}
const massKeys = [
  "dispatchedKg",
  "deliveredKg",
  "laboratoryKg",
  "acceptedGrossKg",
  "deductionKg",
  "acceptedKg",
  "pendingLabKg",
  "pendingTransitKg",
] as const;
const countKeys = [
  "shipmentCount",
  "deliveredCount",
  "acceptedCount",
  "laboratoryCount",
  "legacyCount",
  "cancelledCount",
] as const;
type Totals = Record<(typeof massKeys)[number], string> &
  Record<(typeof countKeys)[number], number>;
const empty = () =>
  Object.fromEntries([
    ...massKeys.map((k) => [k, "0"]),
    ...countKeys.map((k) => [k, 0]),
  ]) as Totals;
const normalize = (row: Totals): Totals => ({
  ...row,
  ...Object.fromEntries(
    massKeys.map((k) => [k, new Prisma.Decimal(row[k] ?? 0).toString()]),
  ),
});
const totalsSql = Prisma.sql`
 COUNT(*) FILTER (WHERE t.status <> 'CANCELLED')::int AS "shipmentCount",
 COUNT(*) FILTER (WHERE t.status <> 'CANCELLED' AND (t."arrivedAt" IS NOT NULL OR t.status IN ('ARRIVED','ACCEPTED')))::int AS "deliveredCount",
 COUNT(*) FILTER (WHERE t.status = 'ACCEPTED')::int AS "acceptedCount",
 COUNT(*) FILTER (WHERE t.status = 'ACCEPTED' AND t.laboratory IS NOT NULL)::int AS "laboratoryCount",
 COUNT(*) FILTER (WHERE t.status = 'ACCEPTED' AND t.laboratory IS NULL)::int AS "legacyCount",
 COUNT(*) FILTER (WHERE t.status = 'CANCELLED')::int AS "cancelledCount",
 COALESCE(SUM(t."weightKg") FILTER (WHERE t.status <> 'CANCELLED'),0)::text AS "dispatchedKg",
 COALESCE(SUM(t."weightKg") FILTER (WHERE t.status <> 'CANCELLED' AND (t."arrivedAt" IS NOT NULL OR t.status IN ('ARRIVED','ACCEPTED'))),0)::text AS "deliveredKg",
 COALESCE(SUM(t."weightKg") FILTER (WHERE t.status = 'ACCEPTED' AND t.laboratory IS NOT NULL),0)::text AS "laboratoryKg",
 COALESCE(SUM(t."weightKg") FILTER (WHERE t.status = 'ACCEPTED'),0)::text AS "acceptedGrossKg",
 COALESCE(SUM(t."weightKg" - COALESCE(t."acceptedWeightKg",t."weightKg")) FILTER (WHERE t.status = 'ACCEPTED'),0)::text AS "deductionKg",
 COALESCE(SUM(COALESCE(t."acceptedWeightKg",t."weightKg")) FILTER (WHERE t.status = 'ACCEPTED'),0)::text AS "acceptedKg",
 COALESCE(SUM(t."weightKg") FILTER (WHERE t.status = 'ARRIVED'),0)::text AS "pendingLabKg",
 COALESCE(SUM(t."weightKg") FILTER (WHERE t.status IN ('CREATED','LOADED','IN_TRANSIT')),0)::text AS "pendingTransitKg"`;
@Injectable()
export class CollectorReportsService {
  constructor(private readonly collection: CollectionService) {}
  private scope(
    actor: CurrentUser,
    q: CollectorReportQuery,
    collectorId?: string,
  ) {
    this.collection.require(actor);
    const { start, end } = collectorReportPeriod(q);
    const date =
      q.basis === "dispatch"
        ? Prisma.sql`t."createdAt"`
        : q.basis === "acceptance"
          ? Prisma.sql`t."confirmedAt"`
          : Prisma.sql`COALESCE(t."arrivedAt",t."confirmedAt")`;
    const where = Prisma.sql`t."organizationId"=${actor.organizationId} AND t.kind='RAW' ${collectorId ? Prisma.sql`AND t."createdById"=${collectorId}` : Prisma.empty} ${start ? Prisma.sql`AND ${date} >= (${start}::timestamptz AT TIME ZONE 'UTC')` : Prisma.empty} ${end ? Prisma.sql`AND ${date} < (${end}::timestamptz AT TIME ZONE 'UTC')` : Prisma.empty}`;
    return { where, date };
  }
  private period(q: CollectorReportQuery) {
    return {
      from: q.from ?? null,
      to: q.to ?? null,
      basis: q.basis,
      timeZone: "Asia/Almaty",
      utcOffset: "+05:00",
    };
  }
  async list(q: CollectorReportQuery, actor: CurrentUser) {
    const { where } = this.scope(actor, q);
    const authors = await this.collection.db.collectionTrip.findMany({
      where: { organizationId: actor.organizationId, kind: "RAW" },
      select: { createdById: true },
      distinct: ["createdById"],
    });
    const [users, summaries] = await Promise.all([
      this.collection.db.user.findMany({
        where: {
          organizationId: actor.organizationId,
          OR: [
            { userRoles: { some: { role: { code: "COLLECTOR" } } } },
            { id: { in: authors.map((t) => t.createdById) } },
          ],
        },
        select: { id: true, fullName: true, phone: true, isBlocked: true },
        orderBy: [{ fullName: "asc" }, { id: "asc" }],
      }),
      this.collection.db.$queryRaw<(Totals & { collectorId: string })[]>(
        Prisma.sql`SELECT t."createdById" AS "collectorId",${totalsSql} FROM "CollectionTrip" t WHERE ${where} GROUP BY t."createdById"`,
      ),
    ]);
    const byId = new Map(summaries.map((s) => [s.collectorId, normalize(s)]));
    return {
      period: this.period(q),
      collectors: users.map((user) => ({
        ...user,
        summary: byId.get(user.id) ?? empty(),
      })),
    };
  }
  async detail(id: string, q: CollectorReportQuery, actor: CurrentUser) {
    const { where, date } = this.scope(actor, q, id);
    const collector = await this.collection.db.user.findFirst({
      where: { id, organizationId: actor.organizationId },
      select: {
        id: true,
        fullName: true,
        phone: true,
        isBlocked: true,
        userRoles: { select: { role: { select: { code: true } } } },
      },
    });
    if (
      !collector ||
      (!collector.userRoles.some((r) => r.role.code === "COLLECTOR") &&
        !(await this.collection.db.collectionTrip.findFirst({
          where: {
            organizationId: actor.organizationId,
            createdById: id,
            kind: "RAW",
          },
          select: { id: true },
        })))
    )
      throw new NotFoundException("Сборщик не найден");
    const [summary, days, rows, count] = await this.collection.db.$transaction(
      [
        this.collection.db.$queryRaw<Totals[]>(
          Prisma.sql`SELECT ${totalsSql} FROM "CollectionTrip" t WHERE ${where}`,
        ),
        this.collection.db.$queryRaw<(Totals & { day: string })[]>(
          Prisma.sql`SELECT ((${date}) + INTERVAL '5 hours')::date::text AS day,${totalsSql} FROM "CollectionTrip" t WHERE ${where} GROUP BY day ORDER BY day DESC`,
        ),
        this.collection.db.$queryRaw<Record<string, unknown>[]>(
          Prisma.sql`SELECT t.id,t.number,t.status,t."warehouseId",l.name AS "warehouseName",t."bagCount",t."weightKg"::text AS "weightKg",t."acceptedWeightKg"::text AS "acceptedWeightKg",t.laboratory,t."createdAt",t."arrivedAt",t."confirmedAt" FROM "CollectionTrip" t LEFT JOIN "CollectionLocation" l ON l.id=t."warehouseId" AND l."organizationId"=t."organizationId" WHERE ${where} ORDER BY ${date} DESC,t.id DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
        ),
        this.collection.db.$queryRaw<{ total: number }[]>(
          Prisma.sql`SELECT COUNT(*)::int AS total FROM "CollectionTrip" t WHERE ${where}`,
        ),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const { userRoles: _, ...profile } = collector;
    return {
      period: this.period(q),
      collector: profile,
      summary: normalize(summary[0] ?? empty()),
      days: days
        .map((d) => ({ ...normalize(d), day: d.day ?? "pending" }))
        .sort((a, b) =>
          a.day === "pending"
            ? 1
            : b.day === "pending"
              ? -1
              : b.day.localeCompare(a.day),
        ),
      shipments: rows.map((row) => ({
        ...row,
        weightKg: new Prisma.Decimal(String(row.weightKg)).toString(),
        acceptedWeightKg:
          row.acceptedWeightKg === null
            ? null
            : new Prisma.Decimal(String(row.acceptedWeightKg)).toString(),
      })),
      total: count[0].total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
@Controller("collection/collectors")
export class CollectorReportsController {
  constructor(private readonly service: CollectorReportsService) {}
  @Get() list(
    @Query() query: CollectorReportQuery,
    @User() actor: CurrentUser,
  ) {
    return this.service.list(query, actor);
  }
  @Get(":id") detail(
    @Param("id") id: string,
    @Query() query: CollectorReportQuery,
    @User() actor: CurrentUser,
  ) {
    return this.service.detail(id, query, actor);
  }
}
