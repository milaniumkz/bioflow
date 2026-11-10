import { ConflictException } from "@nestjs/common";
import { CustomerDelivery, Prisma, Waybill } from "@prisma/client";
import { CurrentUser } from "../common/current-user.decorator";
import { workflowNotice } from "../processing/workflow-notifications";
export type TrackedTrip = Pick<
  Waybill,
  | "id"
  | "organizationId"
  | "createdById"
  | "number"
  | "driverId"
  | "status"
  | "loadedAt"
  | "departedAt"
  | "arrivedAt"
  | "acceptedAt"
  | "createdAt"
  | "version"
  | "bagCount"
  | "destinationWarehouseId"
> & { deliveryId?: string };
export function deliveryWhere(
  u: CurrentUser,
  driver: boolean,
): Prisma.CustomerDeliveryWhereInput {
  return {
    organizationId: u.organizationId,
    trackingEnabled: true,
    ...(driver
      ? { driverId: { in: [] } }
      : u.accessAllObjects
        ? {}
        : { warehouseId: { in: u.warehouseScopeIds ?? [] } }),
  };
}
export async function assignedDeliveryWhere(
  tx: Pick<Prisma.TransactionClient, "driver">,
  u: CurrentUser,
  driver: boolean,
) {
  const where = deliveryWhere(u, driver);
  if (driver)
    where.driverId = {
      in: (
        await tx.driver.findMany({
          where: {
            organizationId: u.organizationId,
            userId: u.id,
            archivedAt: null,
          },
          select: { id: true },
        })
      ).map((d) => d.id),
    };
  return where;
}
export async function deliveryTrip(
  tx: Prisma.TransactionClient,
  d: CustomerDelivery,
): Promise<TrackedTrip & Record<string, any>> {
  const [driver, vehicle, routePoints, routeStops] = await Promise.all([
    tx.driver.findFirst({
      where: { id: d.driverId ?? "", organizationId: d.organizationId },
      select: { fullName: true, phone: true },
    }),
    tx.vehicle.findFirst({
      where: { id: d.vehicleId ?? "", organizationId: d.organizationId },
      select: { plateNumber: true },
    }),
    tx.routePoint.findMany({
      where: { customerDeliveryId: d.id },
      orderBy: { recordedAt: "desc" },
      take: 1,
    }),
    tx.routeStop.findMany({
      where: { customerDeliveryId: d.id, endedAt: null },
      take: 1,
    }),
  ]);
  return {
    ...d,
    deliveryId: d.id,
    tripKind: "CUSTOMER_DELIVERY",
    number:
      d.number?.replace(/^DEL-0*(\d+)$/, "Доставка №$1") ??
      "Доставка покупателю",
    status: ["ARRIVED", "DELIVERED"].includes(d.status)
      ? "ARRIVED"
      : d.status === "IN_TRANSIT"
        ? "IN_TRANSIT"
        : d.loadedAt
          ? "LOADED"
          : "CREATED",
    acceptedAt: null,
    declaredWeight: d.quantity,
    destinationWarehouseId: d.warehouseId ?? "",
    destinationWarehouse: { name: d.destination },
    driver,
    vehicle: vehicle ?? { plateNumber: "Машина не назначена" },
    routePoints,
    routeStops,
  } as TrackedTrip & Record<string, any>;
}
export function tripLink(trip: TrackedTrip) {
  return trip.deliveryId
    ? { customerDeliveryId: trip.id }
    : { waybillId: trip.id };
}
export async function deliveryDriverStatus(
  tx: Prisma.TransactionClient,
  trip: TrackedTrip,
  next: "LOADED" | "IN_TRANSIT" | "ARRIVED",
  u: CurrentUser,
) {
  const d = await tx.customerDelivery.findUniqueOrThrow({
    where: { id: trip.id },
  });
  if (trip.status === next) return { ok: true, status: next };
  if (
    !(trip.status === "CREATED" && next === "LOADED") &&
    !(trip.status === "LOADED" && next === "IN_TRANSIT") &&
    !(trip.status === "IN_TRANSIT" && next === "ARRIVED")
  )
    throw new ConflictException("Этот переход статуса доставки недоступен");
  const now = new Date(),
    status = next === "LOADED" ? "PLANNED" : next;
  const updated = await tx.customerDelivery.updateMany({
    where: { id: d.id, version: d.version, trackingEnabled: true },
    data: {
      status,
      ...(next === "LOADED"
        ? { loadedAt: now }
        : next === "IN_TRANSIT"
          ? { departedAt: now }
          : { arrivedAt: now }),
      version: { increment: 1 },
    },
  });
  if (!updated.count)
    throw new ConflictException("Доставка изменена другим сотрудником");
  if (next === "ARRIVED") {
    const stops = await tx.routeStop.findMany({
      where: { customerDeliveryId: d.id, endedAt: null },
    });
    for (const stop of stops)
      await tx.routeStop.update({
        where: { id: stop.id },
        data: { endedAt: stop.lastObservedAt },
      });
  }
  await tx.customerDeliveryEvent.create({
    data: {
      deliveryId: d.id,
      status,
      driverId: d.driverId,
      vehicleId: d.vehicleId,
      trackingEnabled: true,
      destination: d.destination,
      route: d.route,
      notes:
        next === "LOADED"
          ? "Водитель подтвердил загрузку"
          : next === "IN_TRANSIT"
            ? "Водитель выехал"
            : "Водитель прибыл; ожидается подтверждение вручения",
      createdById: u.id,
    },
  });
  await tx.auditLog.create({
    data: {
      organizationId: u.organizationId,
      userId: u.id,
      action: "driver.delivery-status",
      entity: "CustomerDelivery",
      entityId: d.id,
      newValue: { status: next },
    },
  });
  await workflowNotice(tx, {
    id: `delivery-driver:${d.id}:${d.version + 1}`,
    organizationId: u.organizationId,
    warehouseIds: d.warehouseId ? [d.warehouseId] : [],
    type: "CUSTOMER_DELIVERY",
    title:
      next === "LOADED"
        ? "Продукция загружена в машину"
        : next === "IN_TRANSIT"
          ? "Машина с продукцией выехала"
          : "Машина прибыла к покупателю",
    body: `${trip.number}: ${d.destination}. ${d.route}.`,
  });
  return { ok: true, status: next };
}
