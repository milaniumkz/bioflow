import { Injectable } from "@nestjs/common";
import { IsOptional, IsString, IsISO8601 } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "../common/current-user.decorator";
import { scopedBatch } from "../ledger/ledger-policy";
import { createdAtRange } from "../common/date-range";
export class OwnerDashboardQuery {
  @IsOptional() @IsISO8601() dateFrom?: string;
  @IsOptional() @IsISO8601() dateTo?: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() driverId?: string;
}
@Injectable()
export class OwnerDashboard {
  constructor(private readonly prisma: PrismaService) {}
  async read(q: OwnerDashboardQuery, u: CurrentUser) {
    const range = createdAtRange(q).createdAt;
    const batches = await this.prisma.materialBatch.findMany({
      where: scopedBatch(u),
      include: {
        stocks: true,
        laboratoryAnalyses: true,
        waybills: {
          include: { driver: true, vehicle: true, routeStops: true },
        },
        bigBag: true,
      },
    });
    const ids = batches.map((b) => b.id);
    const [runs, warehouses, employees, operations, deliveries, drivers] =
      await Promise.all([
        this.prisma.processRun.findMany({
          where: { organizationId: u.organizationId, rootBatchId: { in: ids } },
          include: { bags: true, inputs: true },
        }),
        this.prisma.warehouse.findMany({
          where: {
            organizationId: u.organizationId,
            ...(u.accessAllObjects
              ? {}
              : { id: { in: u.warehouseScopeIds ?? [] } }),
          },
          select: { id: true, name: true },
        }),
        this.prisma.user.findMany({
          where: { organizationId: u.organizationId },
          select: { id: true, fullName: true },
        }),
        this.prisma.batchOperation.findMany({
          where: {
            organizationId: u.organizationId,
            status: "CONFIRMED",
            inputs: {
              some: { batchId: { in: ids } },
              every: { batchId: { in: ids } },
            },
          },
          include: { inputs: true },
        }),
        this.prisma.customerDelivery.findMany({
          where: { organizationId: u.organizationId },
          include: { events: { orderBy: { createdAt: "asc" } } },
        }),
        this.prisma.driver.findMany({
          where: { organizationId: u.organizationId },
          select: { id: true, fullName: true },
        }),
      ]);
    const name = (id: string | null) =>
      employees.find((e) => e.id === id)?.fullName ?? "—";
    const wh = (id: string | null) =>
      warehouses.find((w) => w.id === id)?.name ?? "—";
    const dated = (d: Date) =>
      !range ||
      ((!range.gte || d >= range.gte) && (!range.lte || d <= range.lte));
    // Driver selects source lineages; period and employee select each event, not batch creation.
    const eligible = new Set(
      batches
        .filter(
          (b) =>
            !q.driverId || b.waybills.some((t) => t.driverId === q.driverId),
        )
        .map((b) => b.id),
    );
    if (q.driverId)
      for (const d of deliveries.filter((d) => d.driverId === q.driverId)) {
        for (const r of runs)
          if (r.bags.some((b) => b.id === d.sourceId))
            eligible.add(r.rootBatchId);
        for (const o of operations)
          if (o.id === d.sourceId)
            for (const i of o.inputs) eligible.add(i.batchId);
      }
    const rootFor = (id: string) =>
      runs.find(
        (r) => r.bags.some((b) => b.batchId === id) || r.preparedBatchId === id,
      )?.rootBatchId ?? id;
    const matches = (
      id: string,
      date: Date,
      employee: string | null,
      locations: (string | null)[],
    ) =>
      eligible.has(rootFor(id)) &&
      dated(date) &&
      (!q.employeeId || employee === q.employeeId) &&
      (!q.warehouseId || locations.includes(q.warehouseId));
    type RecordRow = {
      id: string;
      batchIds: string[];
      number: string;
      date: Date;
      quantity: number;
      bags: number;
      employee: string;
      location: string;
      status: string;
      loss?: number;
      tripId?: string;
      driverId?: string | null;
      idleMinutes?: number;
      detail?: string;
      delivery?: (typeof deliveries)[number] | null;
    };
    const groups: Record<string, RecordRow[]> = Object.fromEntries(
      [
        "collection",
        "transport",
        "laboratory",
        "washing",
        "factory",
        "finished",
        "stocks",
        "sales",
        "delivery",
        "losses",
        "deviations",
        "idle",
      ].map((k) => [k, []]),
    );
    const deliveryRow = (
      row: RecordRow,
      employee: string | null,
      locations: (string | null)[],
    ) => {
      const d = deliveries.find((d) => d.sourceId === row.id) ?? null;
      if (q.driverId && d && d.driverId !== q.driverId) return;
      const date = d?.updatedAt ?? row.date,
        actor = d?.events.at(-1)?.createdById ?? employee;
      if (!row.batchIds.some((id) => matches(id, date, actor, locations)))
        return;
      const delivery = d
        ? {
            ...d,
            events: d.events.map((e) => ({
              ...e,
              createdByName: name(e.createdById),
              driverName:
                drivers.find((x) => x.id === e.driverId)?.fullName ?? "—",
            })),
          }
        : null;
      groups.delivery.push({
        ...row,
        date,
        employee: name(actor),
        delivery,
        status: d?.status ?? "Доставка не запланирована",
        detail: `${row.detail ?? ""} · ${d?.route ?? "Маршрут не указан"} · ${d?.destination ?? ""} · ${drivers.find((x) => x.id === d?.driverId)?.fullName ?? "Водитель не назначен"}`,
      });
    };
    for (const b of batches) {
      const locations = [
        ...b.stocks.map((s) => s.warehouseId),
        ...b.waybills.map((t) => t.destinationWarehouseId),
      ];
      if (
        b.counterpartyId &&
        b.extractionSiteId &&
        !["DRAFT", "CANCELLED"].includes(b.status) &&
        matches(b.id, b.measuredAt, b.createdById, locations)
      )
        groups.collection.push({
          id: b.id,
          batchIds: [b.id],
          number: b.number,
          date: b.measuredAt,
          quantity: Number(b.initialQuantity),
          bags: b.actualBagCount ?? 0,
          employee: name(b.createdById),
          location: "Место сбора",
          status: b.status,
          detail: `Осталось к отправке: ${b.availableSourceQuantity} т`,
        });
      for (const a of b.laboratoryAnalyses)
        if (matches(b.id, a.measuredAt, a.createdById, locations))
          groups.laboratory.push({
            id: a.id,
            batchIds: [b.id],
            number: b.number,
            date: a.measuredAt,
            quantity: Number(a.actualQuantity),
            bags: a.actualBagCount,
            employee: name(a.createdById),
            location: "Лаборатория",
            status: "Анализ",
            detail: `Влажность ${a.moisturePercent}%; осадок ${a.sedimentPercent}%; ${a.notes ?? ""}`,
          });
      for (const t of b.waybills) {
        const eligibleTrip =
          !["DRAFT", "CANCELLED"].includes(t.status) &&
          (!q.driverId || t.driverId === q.driverId);
        if (!eligibleTrip) continue;
        const row = {
          id: t.id,
          batchIds: [b.id],
          number: t.number,
          date: t.createdAt,
          quantity: Number(t.declaredWeight),
          bags: t.bagCount ?? 0,
          employee: name(t.createdById),
          location: wh(t.destinationWarehouseId),
          status: t.status,
          tripId: t.id,
          driverId: t.driverId,
          detail: `${t.driver?.fullName ?? "Без водителя"} · ${t.vehicle.plateNumber} · Принято ${t.receivedWeight ?? "—"} т · ${t.discrepancyReason ?? ""}`,
        };
        if (
          matches(b.id, t.createdAt, t.createdById, [
            t.destinationWarehouseId,
            t.receiptWarehouseId,
          ])
        ) {
          groups.transport.push(row);
          if (
            t.discrepancyReason ||
            (t.receivedWeight !== null &&
              !t.receivedWeight.equals(t.declaredWeight))
          )
            groups.deviations.push({ ...row, id: `trip-${t.id}` });
        }
        for (const s of t.routeStops)
          if (
            matches(b.id, s.startedAt, t.createdById, [
              t.destinationWarehouseId,
              t.receiptWarehouseId,
            ])
          )
            groups.idle.push({
              ...row,
              id: s.id,
              date: s.startedAt,
              quantity: 0,
              bags: 0,
              idleMinutes: Math.max(
                0,
                Math.round(
                  (s.lastObservedAt.getTime() - s.startedAt.getTime()) / 60000,
                ),
              ),
              detail: `${row.detail} · Подтверждено ${Math.max(0, Math.round((s.lastObservedAt.getTime() - s.startedAt.getTime()) / 60000))} мин простоя`,
            });
      }
      // Current balances for the selected batch cohort; never sum stage turnovers into inventory.
      for (const s of b.stocks)
        if (
          Number(s.quantity) > 0 &&
          matches(b.id, b.measuredAt, b.createdById, [s.warehouseId])
        )
          groups.stocks.push({
            id: s.id,
            batchIds: [b.id],
            number: b.number,
            date: s.updatedAt,
            quantity: Number(s.quantity),
            bags: b.bigBag ? 1 : 0,
            employee: name(b.createdById),
            location: wh(s.warehouseId),
            status: b.state,
            detail: `Резерв ${s.reserved} т; доступно ${Number(s.quantity) - Number(s.reserved)} т`,
          });
    }
    for (const r of runs) {
      const base = {
        id: r.id,
        batchIds: [r.rootBatchId],
        number: r.number,
        date: r.createdAt,
        quantity: Number(r.outputQuantity),
        bags: r.bags.length,
        employee: name(r.createdById),
        location: `${wh(r.fromWarehouseId)} → ${wh(r.toWarehouseId)}`,
        status: r.deviation,
        loss: Number(r.inputQuantity) - Number(r.outputQuantity),
        detail: `${r.inputQuantity} → ${r.outputQuantity} т; потеря ${r.coefficientPercent}%; норма ${r.normMinPercent}–${r.normMaxPercent}%; ${r.reason ?? ""}`,
      };
      if (
        matches(r.rootBatchId, r.createdAt, r.createdById, [
          r.fromWarehouseId,
          r.toWarehouseId,
        ])
      ) {
        // Preparation and washing pass the same material twice; count only
        // the actual washing output in the washing stage. Preparation remains
        // visible in losses, deviations and the complete batch trace.
        if (r.kind === "DRYING") groups.factory.push(base);
        if (r.kind === "WASHING") groups.washing.push(base);
        if (base.loss) groups.losses.push(base);
        if (r.deviation !== "NORMAL") groups.deviations.push(base);
      }
      for (const b of r.bags) {
        const row = {
          ...base,
          id: b.id,
          number: `${r.number} / биг-бэг ${b.ordinal}`,
          quantity: Number(b.quantity),
          bags: 1,
        };
        if (
          b.stage === "DRIED" &&
          matches(
            r.rootBatchId,
            b.receivedAt ?? r.createdAt,
            b.receivedById ?? r.createdById,
            [b.receivedWarehouseId, r.toWarehouseId],
          )
        )
          groups.finished.push({
            ...row,
            date: b.receivedAt ?? r.createdAt,
            status: b.receivedAt ? "Принят на склад" : "Ожидает приёмки",
            employee: name(b.receivedById),
          });
        if (b.soldAt) {
          const sale = {
            ...row,
            date: b.soldAt,
            employee: name(b.soldById),
            status: "Отпущено покупателю",
            detail: `${b.saleRecipient ?? ""} · Документ ${b.saleDocument ?? "—"}`,
          };
          if (
            matches(r.rootBatchId, b.soldAt, b.soldById, [
              b.receivedWarehouseId,
              r.toWarehouseId,
            ])
          )
            groups.sales.push(sale);
          deliveryRow(sale, b.soldById, [
            b.receivedWarehouseId,
            r.toWarehouseId,
          ]);
        }
      }
    }
    for (const o of operations) {
      const eventMatches = o.inputs.some((i) =>
        matches(i.batchId, o.confirmedAt ?? o.createdAt, o.createdById, [
          o.fromWarehouseId,
          o.toWarehouseId,
        ]),
      );
      const row = {
        id: o.id,
        batchIds: o.inputs.map((i) => i.batchId),
        number: o.number,
        date: o.confirmedAt ?? o.createdAt,
        quantity: Number(
          ["SHIPMENT", "RETURN"].includes(o.kind)
            ? o.inputs.reduce((s, i) => s + Number(i.quantity), 0)
            : (o.outputQuantity ??
                o.inputs.reduce((s, i) => s + Number(i.quantity), 0)),
        ),
        bags: 0,
        employee: name(o.createdById),
        location: `${wh(o.fromWarehouseId)} → ${wh(o.toWarehouseId)}`,
        status: o.kind,
        loss:
          Number(o.lossQuantity) +
          Number(o.wasteQuantity) +
          Number(o.defectQuantity),
        detail: o.reason ?? "Операция складского учёта",
      };
      if (o.kind === "SHIPMENT") {
        if (eventMatches) groups.sales.push(row);
        deliveryRow(row, o.createdById, [o.fromWarehouseId, o.toWarehouseId]);
      }
      if (eventMatches && o.kind === "RETURN")
        groups.sales.push({ ...row, quantity: -row.quantity });
      if (eventMatches && ["WASHING", "PRODUCTION"].includes(o.kind))
        groups[o.kind === "WASHING" ? "washing" : "factory"].push(row);
      if (eventMatches && row.loss) groups.losses.push(row);
    }
    return {
      groups: Object.fromEntries(
        Object.entries(groups).map(([key, records]) => [
          key,
          {
            records: records.sort(
              (a, b) => b.date.getTime() - a.date.getTime(),
            ),
            quantity: Number(
              records
                .reduce(
                  (s, r) => s + (key === "losses" ? (r.loss ?? 0) : r.quantity),
                  0,
                )
                .toFixed(3),
            ),
            batches: new Set(records.flatMap((r) => r.batchIds)).size,
            bags: records.reduce((s, r) => s + r.bags, 0),
            drivers: new Set(records.map((r) => r.driverId).filter(Boolean))
              .size,
            inTransitCount: records.filter((r) => r.status === "IN_TRANSIT")
              .length,
            idleMinutes: records.reduce((s, r) => s + (r.idleMinutes ?? 0), 0),
          },
        ]),
      ),
      filters: {
        warehouses,
        employees,
        drivers,
      },
      note: "Этапы показывают обороты и не суммируются. Остатки — текущее наличие партий выбранного периода. Доставка подтверждается отдельно: план → в пути → вручено.",
    };
  }
}
