import { documentLabel } from "../common/document-search";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "../common/current-user.decorator";
import { scopedBatch } from "../ledger/ledger-policy";
import { nextDocumentNumber } from "../common/document-numbers";
import { workflowNotice } from "./workflow-notifications";
export class DeliveryOptionsDto {
  @IsOptional() @IsString() @MaxLength(100) driverId?: string;
  @IsOptional() @IsString() @MaxLength(100) vehicleId?: string;
  @IsOptional() @IsBoolean() trackingEnabled?: boolean;
  @IsString() @MaxLength(500) destination!: string;
  @IsString() @MaxLength(1000) route!: string;
}
export class CustomerDeliveryDto extends DeliveryOptionsDto {
  @IsString() @MaxLength(100) sourceId!: string;
  @IsIn(["PLANNED", "IN_TRANSIT", "ARRIVED", "DELIVERED"]) status!: string;
  @IsInt() @Min(0) version!: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export function validDeliveryTransition(
  previous: string | undefined,
  next: string,
) {
  return previous === undefined
    ? next === "PLANNED"
    : previous === "PLANNED"
      ? ["PLANNED", "IN_TRANSIT"].includes(next)
      : previous === "IN_TRANSIT"
        ? ["IN_TRANSIT", "ARRIVED", "DELIVERED"].includes(next)
        : previous === "ARRIVED"
          ? next === "DELIVERED"
          : false;
}
export async function saveCustomerDelivery(
  tx: Prisma.TransactionClient,
  d: CustomerDeliveryDto,
  u: CurrentUser,
  saleWarehouseId?: string,
) {
  if (!d.destination.trim() || !d.route.trim())
    throw new BadRequestException("Укажите маршрут и адрес покупателя");
  const source = await tx.bigBag.findFirst({
    where: { id: d.sourceId, soldAt: { not: null }, batch: scopedBatch(u) },
    include: { batch: { include: { stocks: true } } },
  });
  const operation = source
    ? null
    : await tx.batchOperation.findFirst({
        where: {
          id: d.sourceId,
          organizationId: u.organizationId,
          kind: "SHIPMENT",
          status: "CONFIRMED",
          inputs: {
            some: { batch: scopedBatch(u) },
            every: { batch: scopedBatch(u) },
          },
        },
        include: { inputs: true },
      });
  if (!source && !operation)
    throw new NotFoundException("Отпуск покупателю не найден");
  if (
    !u.permissions.includes("processing.sell") &&
    !(
      source?.stage === "WASHED" &&
      u.permissions.includes("processing.sell.washed")
    )
  )
    throw new ForbiddenException("Нет прав на доставку этой продукции");
  const old = await tx.customerDelivery.findUnique({
    where: {
      organizationId_sourceId: {
        organizationId: u.organizationId,
        sourceId: d.sourceId,
      },
    },
  });
  if ((old?.version ?? 0) !== d.version)
    throw new ConflictException("Доставка изменена. Обновите список");
  if (!validDeliveryTransition(old?.status, d.status))
    throw new ConflictException(
      "Подтвердите план, отправку и вручение по порядку",
    );
  const trackingEnabled = d.trackingEnabled ?? old?.trackingEnabled ?? false;
  const vehicleId =
    d.vehicleId === undefined ? (old?.vehicleId ?? null) : d.vehicleId || null;
  const driverId = d.driverId || null;
  // Departure freezes the historical assignment; later archiving must not block handover.
  const assignmentLocked =
    !!old && (old.status !== "PLANNED" || !!old.loadedAt);
  if (
    assignmentLocked &&
    old &&
    (old.driverId !== driverId ||
      old.vehicleId !== vehicleId ||
      old.trackingEnabled !== trackingEnabled)
  )
    throw new ConflictException(
      "После выезда нельзя менять машину, водителя и отслеживание",
    );
  const driver = driverId
    ? await tx.driver.findFirst({
        where: {
          id: driverId,
          organizationId: u.organizationId,
          ...(!assignmentLocked ? { archivedAt: null } : {}),
        },
        include: {
          user: { include: { userRoles: { include: { role: true } } } },
        },
      })
    : null;
  if (driverId && !driver && !assignmentLocked)
    throw new BadRequestException("Водитель не найден или архивирован");
  if (
    vehicleId &&
    !assignmentLocked &&
    !(await tx.vehicle.findFirst({
      where: {
        id: vehicleId,
        organizationId: u.organizationId,
        archivedAt: null,
        status: "ACTIVE",
      },
    }))
  )
    throw new BadRequestException("Машина не найдена или недоступна");
  if (
    trackingEnabled &&
    !assignmentLocked &&
    (!driver?.user ||
      driver.user.isBlocked ||
      !driver.user.userRoles.some((r) => r.role.code === "DRIVER") ||
      !vehicleId)
  )
    throw new BadRequestException(
      "Для отслеживания выберите машину и водителя с активным аккаунтом водителя",
    );
  // Ordinary deliveries can be confirmed without a driver account or GPS.
  const warehouseId =
    old?.warehouseId ??
    saleWarehouseId ??
    operation?.fromWarehouseId ??
    source?.batch.stocks.find(
      (s) => u.accessAllObjects || u.warehouseScopeIds?.includes(s.warehouseId),
    )?.warehouseId ??
    null;
  const data = {
    driverId,
    vehicleId,
    trackingEnabled,
    destination: d.destination.trim(),
    route: d.route.trim(),
    status: d.status,
  };
  const now = new Date();
  let delivery;
  if (old) {
    const result = await tx.customerDelivery.updateMany({
      where: { id: old.id, version: d.version },
      data: {
        ...data,
        ...(d.status === "IN_TRANSIT" && !old.departedAt
          ? { departedAt: now, loadedAt: old.loadedAt ?? now }
          : {}),
        ...(["ARRIVED", "DELIVERED"].includes(d.status) && !old.arrivedAt
          ? { arrivedAt: now }
          : {}),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1)
      throw new ConflictException("Доставка уже изменена другим сотрудником");
    delivery = await tx.customerDelivery.findUniqueOrThrow({
      where: { id: old.id },
    });
  } else
    delivery = await tx.customerDelivery.create({
      data: {
        ...data,
        number: await nextDocumentNumber(tx, u.organizationId, "DEL"),
        organizationId: u.organizationId,
        sourceId: d.sourceId,
        warehouseId,
        batchId: source?.batchId ?? operation?.inputs[0]?.batchId,
        quantity:
          source?.quantity ??
          operation!.inputs.reduce(
            (s, i) => s.plus(i.quantity),
            new Prisma.Decimal(0),
          ),
        bagCount: source ? 1 : operation!.inputs.length,
        createdById: u.id,
      },
    });
  await tx.customerDeliveryEvent.create({
    data: {
      ...data,
      deliveryId: delivery.id,
      notes: d.notes,
      createdById: u.id,
    },
  });
  if (["ARRIVED", "DELIVERED"].includes(d.status)) {
    for (const stop of await tx.routeStop.findMany({
      where: { customerDeliveryId: delivery.id, endedAt: null },
    }))
      await tx.routeStop.update({
        where: { id: stop.id },
        data: { endedAt: stop.lastObservedAt },
      });
  }
  await workflowNotice(tx, {
    id: `delivery:${delivery.id}:${delivery.version}`,
    organizationId: u.organizationId,
    warehouseIds: warehouseId ? [warehouseId] : [],
    driverUserId: trackingEnabled ? driver?.userId : null,
    type: "CUSTOMER_DELIVERY",
    title:
      d.status === "PLANNED"
        ? "Назначена доставка продукции"
        : d.status === "IN_TRANSIT"
          ? "Продукция отправлена покупателю"
          : d.status === "ARRIVED"
            ? "Машина прибыла к покупателю"
            : "Продукция вручена покупателю",
    body: `${documentLabel(delivery.number ?? "Доставка")}: ${d.destination}. Маршрут: ${d.route}. ${driver?.fullName ?? "Без водителя"}.`,
  });
  await tx.auditLog.create({
    data: {
      organizationId: u.organizationId,
      userId: u.id,
      action: "delivery.save",
      entity: "CustomerDelivery",
      entityId: delivery.id,
      newValue: { status: d.status, trackingEnabled, vehicleId, driverId },
    },
  });
  return delivery;
}
@Injectable()
export class CustomerDeliveryService {
  constructor(private readonly prisma: PrismaService) {}
  async list(q: import("../common/page.dto").PageDto, u: CurrentUser) {
    if (
      !u.permissions.some((p) =>
        ["processing.sell", "processing.sell.washed"].includes(p),
      )
    )
      throw new ForbiddenException("Нет доступа к доставкам");
    const where: Prisma.CustomerDeliveryWhereInput = {
      organizationId: u.organizationId,
      ...(u.accessAllObjects
        ? {}
        : { warehouseId: { in: u.warehouseScopeIds ?? [] } }),
    };
    if (!u.permissions.includes("processing.sell"))
      where.sourceId = {
        in: (
          await this.prisma.bigBag.findMany({
            where: {
              stage: "WASHED",
              soldAt: { not: null },
              batch: scopedBatch(u),
            },
            select: { id: true },
          })
        ).map((b) => b.id),
      };
    if (q.search)
      where.AND = [
        {
          OR: [
            { number: { contains: q.search, mode: "insensitive" } },
            { destination: { contains: q.search, mode: "insensitive" } },
          ],
        },
      ];
    const [data, total] = await this.prisma.$transaction([
      this.prisma.customerDelivery.findMany({
        where,
        include: { events: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
        take: q.pageSize,
        skip: (q.page - 1) * q.pageSize,
      }),
      this.prisma.customerDelivery.count({ where }),
    ]);
    const [people, drivers, vehicles] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          organizationId: u.organizationId,
          id: { in: data.flatMap((d) => d.events.map((e) => e.createdById)) },
        },
        select: { id: true, fullName: true },
      }),
      this.prisma.driver.findMany({
        where: {
          organizationId: u.organizationId,
          id: {
            in: data
              .flatMap((d) => [d.driverId, ...d.events.map((e) => e.driverId)])
              .filter((id): id is string => !!id),
          },
        },
        select: { id: true, fullName: true, phone: true },
      }),
      this.prisma.vehicle.findMany({
        where: {
          organizationId: u.organizationId,
          id: {
            in: data
              .flatMap((d) => [
                d.vehicleId,
                ...d.events.map((e) => e.vehicleId),
              ])
              .filter((id): id is string => !!id),
          },
        },
        select: { id: true, plateNumber: true },
      }),
    ]);
    return {
      data: data.map((d) => ({
        ...d,
        driverName:
          drivers.find((x) => x.id === d.driverId)?.fullName ??
          "Водитель не назначен",
        vehiclePlate:
          vehicles.find((x) => x.id === d.vehicleId)?.plateNumber ??
          "Машина не назначена",
        events: d.events.map((e) => ({
          ...e,
          createdByName:
            people.find((x) => x.id === e.createdById)?.fullName ?? "Сотрудник",
          driverName: drivers.find((x) => x.id === e.driverId)?.fullName ?? "—",
          vehiclePlate:
            vehicles.find((x) => x.id === e.vehicleId)?.plateNumber ?? "—",
        })),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  async save(d: CustomerDeliveryDto, u: CurrentUser) {
    try {
      return await this.prisma.$transaction(
        (tx) => saveCustomerDelivery(tx, d, u),
        { isolationLevel: "Serializable", timeout: 15000 },
      );
    } catch (error: any) {
      if (["P2002", "P2034"].includes(error?.code))
        throw new ConflictException(
          "Доставка уже изменена. Обновите список и повторите",
        );
      throw error;
    }
  }
}
