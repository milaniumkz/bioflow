import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Query,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";
import { Prisma } from "@prisma/client";
import {
  CurrentUser as User,
  CurrentUser,
} from "../common/current-user.decorator";
import { CollectionService } from "./collection.service";
import {
  CollectorReportQuery,
  collectorReportPeriod,
} from "./collection-collector-reports";
export class OwnerDashboardQuery extends CollectorReportQuery {
  @IsOptional() @IsString() @Length(1, 128) collectorId?: string;
  @IsOptional() @IsString() @Length(1, 128) warehouseId?: string;
  @IsOptional() @IsString() @Length(1, 128) factoryId?: string;
  @IsOptional() @IsString() @Length(1, 40) driverPhone?: string;
  @IsOptional() @IsString() @Length(1, 30) driverPlate?: string;
  @IsOptional()
  @IsIn(["RAW", "FACTORY", "GP", "PRODUCTION", "WASH", "OTHER"])
  kind?: string;
  @IsOptional()
  @IsIn([
    "CREATED",
    "LOADED",
    "IN_TRANSIT",
    "ARRIVED",
    "ACCEPTED",
    "CANCELLED",
    "RETURNED_TO_WASH",
    "COMPLETED",
  ])
  status?: string;
  @IsIn(["all", "checked", "pending", "rework"]) laboratory = "all";
  @IsOptional() @IsString() @Length(1, 100) search?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,10}(\.\d{1,3})?$/) minKg?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,10}(\.\d{1,3})?$/) maxKg?: string;
}
type Row = Record<string, any>;
const zero = () => ({
  eventCount: 0,
  cancelledCount: 0,
  rawCount: 0,
  rawDeliveredCount: 0,
  rawAcceptedCount: 0,
  rawLegacyCount: 0,
  rawSentKg: "0",
  rawDeliveredKg: "0",
  rawLaboratoryKg: "0",
  rawDeductionKg: "0",
  rawAcceptedKg: "0",
  rawPendingLabKg: "0",
  rawInTransitKg: "0",
  factorySentKg: "0",
  factoryAcceptedKg: "0",
  factoryDeductionKg: "0",
  factoryReturnedKg: "0",
  gpSentKg: "0",
  gpDeliveredKg: "0",
  driverTrips: 0,
  driverDelivered: 0,
  driverActive: 0,
  washedKg: "0",
  finishedKg: "0",
  rejectedKg: "0",
  redryKg: "0",
});
export function ownerDashboardTotals(events: Row[]) {
  const totals: Row = zero();
  const add = (key: string, value: any) => {
    totals[key] = new Prisma.Decimal(totals[key]).plus(value ?? 0).toString();
  };
  for (const e of events) {
    if (e.status === "CANCELLED") {
      totals.cancelledCount++;
      continue;
    }
    totals.eventCount++;
    if (e.driverPhone && ["RAW", "GP"].includes(e.kind)) {
      totals.driverTrips++;
      if (e.deliveredAt) totals.driverDelivered++;
      else totals.driverActive++;
    }
    if (e.kind === "RAW") {
      totals.rawCount++;
      add("rawSentKg", e.weightKg);
      if (e.deliveredAt || e.status === "ACCEPTED") {
        totals.rawDeliveredCount++;
        add("rawDeliveredKg", e.weightKg);
      }
      if (e.status === "ACCEPTED") {
        totals.rawAcceptedCount++;
        add("rawAcceptedKg", e.acceptedWeightKg ?? e.weightKg);
        add(
          "rawDeductionKg",
          new Prisma.Decimal(e.weightKg).minus(
            e.acceptedWeightKg ?? e.weightKg,
          ),
        );
        if (e.laboratory) add("rawLaboratoryKg", e.weightKg);
        else totals.rawLegacyCount++;
      } else if (e.status === "ARRIVED") add("rawPendingLabKg", e.weightKg);
      else add("rawInTransitKg", e.weightKg);
    } else if (e.kind === "FACTORY") {
      add("factorySentKg", e.weightKg);
      if (e.status === "RETURNED_TO_WASH") add("factoryReturnedKg", e.weightKg);
      else if (e.status === "ACCEPTED") {
        add("factoryAcceptedKg", e.acceptedWeightKg ?? e.weightKg);
        add(
          "factoryDeductionKg",
          new Prisma.Decimal(e.weightKg).minus(
            e.acceptedWeightKg ?? e.weightKg,
          ),
        );
      }
    } else if (e.kind === "GP") {
      add("gpSentKg", e.weightKg);
      if (e.status === "ARRIVED") add("gpDeliveredKg", e.weightKg);
    } else if (e.kind === "WASH") add("washedKg", e.weightKg);
    else if (e.kind === "PRODUCTION") {
      add("finishedKg", e.output.FINISHED);
      add("rejectedKg", e.output.REJECT);
      add("redryKg", e.output.REDRY);
    }
  }
  return totals;
}
@Injectable()
export class OwnerDashboardService {
  constructor(private readonly collection: CollectionService) {}
  async report(q: OwnerDashboardQuery, actor: CurrentUser) {
    this.collection.require(actor);
    const { start, end } = collectorReportPeriod(q);
    if (q.minKg && q.maxKg && new Prisma.Decimal(q.minKg).gt(q.maxKg))
      throw new BadRequestException(
        "Минимальный вес не должен превышать максимальный",
      );
    const org = actor.organizationId;
    const [trips, shipments, actions, outputs, locations, users, stocks] =
      await this.collection.db.$transaction(
        [
          this.collection.db.collectionTrip.findMany({
            where: { organizationId: org },
            select: {
              id: true,
              kind: true,
              number: true,
              status: true,
              createdById: true,
              warehouseId: true,
              fromLocationId: true,
              recipientName: true,
              bagCount: true,
              weightKg: true,
              acceptedWeightKg: true,
              laboratory: true,
              createdAt: true,
              arrivedAt: true,
              confirmedAt: true,
              driver: {
                select: {
                  driverPhone: true,
                  driverPlate: true,
                  stoppedAt: true,
                },
              },
            },
          }),
          this.collection.db.collectionShipment.findMany({
            where: { organizationId: org },
            select: {
              id: true,
              number: true,
              status: true,
              createdById: true,
              fromLocationId: true,
              toLocationId: true,
              bagCount: true,
              weightKg: true,
              acceptedWeightKg: true,
              laboratory: true,
              createdAt: true,
              confirmedAt: true,
            },
          }),
          this.collection.db.$queryRaw<Row[]>(
            Prisma.sql`SELECT id,kind,"locationId","createdById","createdAt","quantityKg"::text AS "quantityKg",details->>'tripId' AS "tripId",details->>'shipmentId' AS "shipmentId",details->>'reversesActionId' AS "reversesActionId",details->>'reason' AS reason,COALESCE(jsonb_array_length(details->'redryConsumedBagIds'),0)>0 AS "repeatDrying",COALESCE(jsonb_array_length(details->'bags'),0)>0 AS "hasLaboratory" FROM "CollectionAction" WHERE "organizationId"=${org}`,
          ),
          this.collection.db.collectionBatch.findMany({
            where: {
              organizationId: org,
              sourceType: { in: ["PRODUCTION", "WASH"] },
            },
            select: {
              id: true,
              sourceId: true,
              sourceType: true,
              state: true,
              status: true,
              totalKg: true,
            },
          }),
          this.collection.db.collectionLocation.findMany({
            where: { organizationId: org },
            select: { id: true, name: true, kind: true, active: true },
            orderBy: { name: "asc" },
          }),
          this.collection.db.user.findMany({
            where: { organizationId: org },
            select: {
              id: true,
              fullName: true,
              phone: true,
              isBlocked: true,
              userRoles: { select: { role: { select: { code: true } } } },
            },
            orderBy: { fullName: "asc" },
          }),
          this.collection.db.collectionBatch.groupBy({
            by: ["locationId", "state"],
            orderBy: [{ locationId: "asc" }, { state: "asc" }],
            where: { organizationId: org, status: "ACTIVE" },
            _sum: { remainingKg: true },
          }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    const bySite = new Map(locations.map((l) => [l.id, l])),
      byUser = new Map(users.map((u) => [u.id, u]));
    const byTrip = new Map(trips.map((t) => [t.id, t]));
    const byAction = new Map<string, typeof outputs>();
    for (const output of outputs) {
      const current = byAction.get(output.sourceId) ?? [];
      current.push(output);
      byAction.set(output.sourceId, current);
    }
    const reversed = new Set(
      actions.filter((a) => a.reversesActionId).map((a) => a.reversesActionId),
    );
    const events: Row[] = [];
    for (const t of trips)
      events.push({
        id: t.id,
        kind: t.kind,
        number: t.number,
        status: t.status,
        collectorId: t.kind === "RAW" ? t.createdById : null,
        warehouseId: t.warehouseId,
        factoryId: t.fromLocationId,
        driverPhone: t.driver?.driverPhone ?? null,
        driverPlate: t.driver?.driverPlate ?? null,
        driverStoppedAt: t.driver?.stoppedAt ?? null,
        createdAt: t.createdAt,
        deliveredAt: t.arrivedAt ?? (t.kind === "RAW" ? t.confirmedAt : null),
        acceptedAt: t.kind === "RAW" ? t.confirmedAt : t.arrivedAt,
        weightKg: t.weightKg.toString(),
        acceptedWeightKg: t.acceptedWeightKg?.toString() ?? null,
        laboratory: t.laboratory,
        bagCount: t.bagCount,
        recipientName: t.recipientName,
        actorId: t.createdById,
      });
    for (const s of shipments)
      events.push({
        id: s.id,
        kind: "FACTORY",
        number: s.number,
        status: s.status,
        collectorId: null,
        warehouseId: s.fromLocationId,
        factoryId: s.toLocationId,
        driverPhone: null,
        driverPlate: null,
        createdAt: s.createdAt,
        deliveredAt: s.confirmedAt,
        acceptedAt: s.confirmedAt,
        weightKg: s.weightKg.toString(),
        acceptedWeightKg: s.acceptedWeightKg?.toString() ?? null,
        laboratory: s.laboratory,
        bagCount: s.bagCount,
        actorId: s.createdById,
      });
    const duplicated = new Set([
      "RAW_RECEIPT",
      "FACTORY_SHIPMENT",
      "FACTORY_RECEIPT",
      "FACTORY_REWORK",
      "GP_SHIPMENT",
    ]);
    for (const a of actions) {
      if (duplicated.has(a.kind)) continue;
      const site = bySite.get(a.locationId),
        trip = a.tripId ? byTrip.get(a.tripId) : null;
      const produced = byAction.get(a.id) ?? [];
      const kind =
        a.kind === "PRODUCTION"
          ? "PRODUCTION"
          : a.kind === "WASH"
            ? "WASH"
            : "OTHER";
      const output: Row = { FINISHED: "0", REJECT: "0", REDRY: "0" };
      for (const b of produced)
        if (b.status === "ACTIVE" && b.state in output)
          output[b.state] = new Prisma.Decimal(output[b.state])
            .plus(b.totalKg)
            .toString();
      events.push({
        id: a.id,
        kind,
        actionKind: a.kind,
        number: a.id.slice(-8),
        status: reversed.has(a.id) ? "CANCELLED" : "COMPLETED",
        collectorId: trip?.kind === "RAW" ? trip.createdById : null,
        warehouseId:
          site?.kind === "WAREHOUSE" ? site.id : (trip?.warehouseId ?? null),
        factoryId:
          site?.kind === "FACTORY" ? site.id : (trip?.fromLocationId ?? null),
        driverPhone: trip?.driver?.driverPhone ?? null,
        driverPlate: trip?.driver?.driverPlate ?? null,
        createdAt: a.createdAt,
        deliveredAt: a.createdAt,
        acceptedAt: a.createdAt,
        weightKg: new Prisma.Decimal(a.quantityKg).toString(),
        acceptedWeightKg: null,
        laboratory: null,
        bagCount: null,
        actorId: a.createdById,
        reason: a.reason,
        repeatDrying: a.repeatDrying,
        hasLaboratory: a.hasLaboratory,
        output,
      });
    }
    const search = q.search?.toLocaleLowerCase("ru").trim();
    const filtered = events.filter((e) => {
      const eventAt =
        q.basis === "dispatch"
          ? e.createdAt
          : q.basis === "acceptance"
            ? e.acceptedAt
            : e.deliveredAt;
      if (
        (start || end) &&
        (!eventAt || (start && eventAt < start) || (end && eventAt >= end))
      )
        return false;
      if (
        (q.collectorId && e.collectorId !== q.collectorId) ||
        (q.warehouseId && e.warehouseId !== q.warehouseId) ||
        (q.factoryId && e.factoryId !== q.factoryId) ||
        (q.driverPhone && e.driverPhone !== q.driverPhone) ||
        (q.driverPlate &&
          String(e.driverPlate ?? "")
            .replace(/[\s-]/g, "")
            .toUpperCase() !==
            q.driverPlate.replace(/[\s-]/g, "").toUpperCase()) ||
        (q.kind && e.kind !== q.kind) ||
        (q.status && e.status !== q.status)
      )
        return false;
      const checked =
        !!e.laboratory || (e.kind === "PRODUCTION" && e.hasLaboratory);
      if (
        (q.laboratory === "checked" && !checked) ||
        (q.laboratory === "pending" &&
          !(
            (e.status === "ARRIVED" && e.kind === "RAW") ||
            (e.status === "IN_TRANSIT" && e.kind === "FACTORY")
          )) ||
        (q.laboratory === "rework" &&
          e.status !== "RETURNED_TO_WASH" &&
          !(
            e.kind === "PRODUCTION" &&
            new Prisma.Decimal(e.output.REDRY ?? 0).gt(0)
          ))
      )
        return false;
      const amount = new Prisma.Decimal(e.weightKg).abs();
      if ((q.minKg && amount.lt(q.minKg)) || (q.maxKg && amount.gt(q.maxKg)))
        return false;
      if (
        search &&
        ![
          e.number,
          e.driverPhone,
          e.driverPlate,
          e.recipientName,
          byUser.get(e.collectorId)?.fullName,
          byUser.get(e.actorId)?.fullName,
          bySite.get(e.warehouseId)?.name,
          bySite.get(e.factoryId)?.name,
        ].some((value) =>
          String(value ?? "")
            .toLocaleLowerCase("ru")
            .includes(search),
        )
      )
        return false;
      e.reportDate = eventAt ?? null;
      return true;
    });
    filtered.sort(
      (a, b) =>
        (b.reportDate ?? b.createdAt).getTime() -
          (a.reportDate ?? a.createdAt).getTime() || a.id.localeCompare(b.id),
    );
    const authored = new Set(
      trips.filter((t) => t.kind === "RAW").map((t) => t.createdById),
    );
    const collectors = users
      .filter(
        (u) =>
          authored.has(u.id) ||
          u.userRoles.some((r) => r.role.code === "COLLECTOR"),
      )
      .map((u) => ({
        id: u.id,
        name: u.fullName,
        phone: u.phone,
        active: !u.isBlocked,
      }));
    const driversMap = new Map<
      string,
      { id: string; name: string; phone: string; plates: string[] }
    >();
    for (const t of trips)
      if (t.driver) {
        const phone = t.driver.driverPhone,
          entry = driversMap.get(phone) ?? {
            id: phone,
            name: phone,
            phone,
            plates: [],
          };
        if (!entry.plates.includes(t.driver.driverPlate))
          entry.plates.push(t.driver.driverPlate);
        driversMap.set(phone, entry);
      }
    const drivers = [...driversMap.values()].sort((a, b) =>
      a.phone.localeCompare(b.phone),
    );
    const options = {
      collectors,
      warehouses: locations.filter((l) => l.kind === "WAREHOUSE"),
      factories: locations.filter((l) => l.kind === "FACTORY"),
      drivers,
    };
    function breakdown(items: Row[], key: string) {
      return items.map((item) => ({
        ...item,
        summary: ownerDashboardTotals(
          filtered.filter((e) => e[key] === item.id),
        ),
      }));
    }
    const groups = new Map<string, Row[]>();
    for (const e of filtered) {
      const key = e.reportDate
        ? new Date(e.reportDate.getTime() + 5 * 3600000)
            .toISOString()
            .slice(0, 10)
        : "pending";
      const rows = groups.get(key) ?? [];
      rows.push(e);
      groups.set(key, rows);
    }
    const page = filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const qaBatches = await this.collection.db.collectionBatch.findMany({
      where: {
        organizationId: org,
        sourceType: "PRODUCTION",
        sourceId: {
          in: page.filter((e) => e.kind === "PRODUCTION").map((e) => e.id),
        },
      },
      select: {
        sourceId: true,
        state: true,
        bags: {
          select: {
            id: true,
            index: true,
            weightKg: true,
            status: true,
            laboratory: true,
          },
        },
      },
    });
    const currentStocks =
      q.collectorId || q.driverPhone || q.driverPlate
        ? []
        : stocks
            .filter(
              (s) =>
                (!q.warehouseId && !q.factoryId) ||
                s.locationId === q.warehouseId ||
                s.locationId === q.factoryId,
            )
            .map((s) => ({
              locationId: s.locationId,
              name: bySite.get(s.locationId)?.name,
              state: s.state,
              weightKg: s._sum?.remainingKg?.toString() ?? "0",
            }));
    return {
      period: {
        from: q.from ?? null,
        to: q.to ?? null,
        basis: q.basis,
        timeZone: "Asia/Almaty",
        utcOffset: "+05:00",
      },
      options,
      summary: ownerDashboardTotals(filtered),
      breakdowns: {
        collectors: breakdown(collectors, "collectorId"),
        warehouses: breakdown(options.warehouses, "warehouseId"),
        factories: breakdown(options.factories, "factoryId"),
        drivers: breakdown(drivers, "driverPhone"),
      },
      stock: currentStocks,
      stockAsOf: new Date().toISOString(),
      days: [...groups.entries()]
        .sort(([a], [b]) =>
          a === "pending" ? 1 : b === "pending" ? -1 : b.localeCompare(a),
        )
        .map(([day, rows]) => ({ day, summary: ownerDashboardTotals(rows) })),
      events: page.map((e) => ({
        ...e,
        collectorName: byUser.get(e.collectorId)?.fullName ?? null,
        actorName: byUser.get(e.actorId)?.fullName ?? null,
        warehouseName: bySite.get(e.warehouseId)?.name ?? null,
        factoryName: bySite.get(e.factoryId)?.name ?? null,
        bags: qaBatches
          .filter((b) => b.sourceId === e.id)
          .flatMap((b) =>
            b.bags.map((bag) => ({
              ...bag,
              state: b.state,
              weightKg: bag.weightKg.toString(),
            })),
          ),
      })),
      total: filtered.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
@Controller("collection/dashboard")
export class OwnerDashboardController {
  constructor(private readonly service: OwnerDashboardService) {}
  @Get() report(
    @Query() query: OwnerDashboardQuery,
    @User() actor: CurrentUser,
  ) {
    return this.service.report(query, actor);
  }
}
