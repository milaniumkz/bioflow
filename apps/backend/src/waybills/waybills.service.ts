import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "../common/current-user.decorator";
import { orderBy, PageDto } from "../common/page.dto";
import { assertWarehouseInOrganization } from "../common/scope-checks";
import { AcceptWaybillDto, CreateWaybillDto, UpdateWaybillStatusDto } from "./waybills.dto";
import { classifyAcceptance } from "../common/domain-policies";
import { nextDocumentNumber } from "../common/document-numbers";

@Injectable()
export class WaybillsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PageDto, user: CurrentUser) {
    const where: any = { organizationId: user.organizationId };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: "insensitive" } },
        { counterparty: { name: { contains: query.search, mode: "insensitive" } } },
        { vehicle: { plateNumber: { contains: query.search, mode: "insensitive" } } }
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.waybill.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: orderBy(query, ["createdAt", "number", "status", "declaredWeight"]),
        include: { counterparty: true, vehicle: true, driver: true, destinationWarehouse: true, materialType: true }
      }),
      this.prisma.waybill.count({ where })
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  async create(dto: CreateWaybillDto, user: CurrentUser) {
    const token = randomBytes(32).toString("base64url");
    const waybill = await this.prisma.$transaction(async (tx) => {
      await this.assertCreateReferences(tx, dto, user.organizationId);
      const number = await nextDocumentNumber(tx, user.organizationId, "WB");
      const created = await tx.waybill.create({
        data: {
          organizationId: user.organizationId,
          number,
          qrTokenHash: this.hash(token),
          status: "CREATED",
          counterpartyId: dto.counterpartyId,
          extractionSiteId: dto.extractionSiteId,
          vehicleId: dto.vehicleId,
          driverId: dto.driverId,
          destinationWarehouseId: dto.destinationWarehouseId,
          materialTypeId: dto.materialTypeId,
          declaredWeight: dto.declaredWeight,
          comment: dto.comment,
          createdById: user.id,
          events: { create: { type: "CREATED", payload: {} } }
        }
      });
      await tx.auditLog.create({ data: { organizationId: user.organizationId, userId: user.id, action: "waybill.create", entity: "Waybill", entityId: created.id, newValue: created as any } });
      await tx.notification.create({
        data: { organizationId: user.organizationId, type: "WAYBILL_CREATED", title: "Создана накладная", body: `Накладная ${created.number} создана` }
      });
      return created;
    });
    return { ...waybill, qrToken: token };
  }

  getById(id: string, user: CurrentUser) {
    return this.prisma.waybill.findFirstOrThrow({
      where: { id, organizationId: user.organizationId },
      include: { counterparty: true, vehicle: true, driver: true, extractionSite: true, destinationWarehouse: true, materialType: true, files: { include: { file: true } }, events: true }
    });
  }

  getByNumber(number: string, user: CurrentUser) {
    return this.prisma.waybill.findFirstOrThrow({
      where: { number, organizationId: user.organizationId },
      include: { counterparty: true, vehicle: true, driver: true, extractionSite: true, destinationWarehouse: true, materialType: true }
    });
  }

  async updateStatus(id: string, dto: UpdateWaybillStatusDto, user: CurrentUser) {
    return this.prisma.$transaction(async (tx) => {
      const waybill = await tx.waybill.findFirst({ where: { id, organizationId: user.organizationId } });
      if (!waybill) throw new NotFoundException("Waybill not found");
      if (["ACCEPTED", "ACCEPTED_WITH_DIFFERENCE", "REJECTED", "CANCELLED"].includes(waybill.status)) {
        throw new ConflictException("Closed waybill status cannot be changed");
      }
      if (["REJECTED", "CANCELLED"].includes(dto.status) && !dto.reason) throw new BadRequestException("Reason is required");
      assertTransition(waybill.status, dto.status);
      const updated = await tx.waybill.update({
        where: { id },
        data: { status: dto.status, version: { increment: 1 }, events: { create: { type: dto.status, payload: { reason: dto.reason ?? null } } } }
      });
      await tx.auditLog.create({
        data: { organizationId: user.organizationId, userId: user.id, action: "waybill.status", entity: "Waybill", entityId: id, oldValue: { status: waybill.status }, newValue: { status: dto.status }, reason: dto.reason }
      });
      await tx.notification.create({
        data: { organizationId: user.organizationId, type: `WAYBILL_${dto.status}`, title: "Статус накладной изменён", body: `${waybill.number}: ${dto.status}` }
      });
      return updated;
    });
  }

  async resolveQr(token: string, user: CurrentUser) {
    const waybill = await this.prisma.waybill.findFirst({
      where: { organizationId: user.organizationId, qrTokenHash: this.hash(token) },
      include: { counterparty: true, vehicle: true, driver: true, extractionSite: true, destinationWarehouse: true, materialType: true }
    });
    if (!waybill) throw new NotFoundException("QR not found");
    if (["ACCEPTED", "ACCEPTED_WITH_DIFFERENCE", "REJECTED", "CANCELLED"].includes(waybill.status)) {
      throw new ConflictException("Waybill is already closed");
    }
    return waybill;
  }

  async accept(id: string, dto: AcceptWaybillDto, user: CurrentUser) {
    return this.prisma.$transaction(async (tx) => {
      const existingAcceptance = await tx.acceptance.findUnique({ where: { idempotencyKey: dto.idempotencyKey }, include: { waybill: true } });
      if (existingAcceptance) {
        if (existingAcceptance.waybill.organizationId !== user.organizationId) throw new ConflictException("Idempotency key already used");
        return existingAcceptance;
      }

      const waybill = await tx.waybill.findFirst({ where: { id, organizationId: user.organizationId } });
      if (!waybill) throw new NotFoundException("Waybill not found");
      if (["ACCEPTED", "ACCEPTED_WITH_DIFFERENCE"].includes(waybill.status)) throw new ConflictException("Waybill already accepted");
      if (waybill.status !== "ARRIVED") throw new ConflictException("Waybill must be arrived before acceptance");
      await assertWarehouseInOrganization(tx, dto.warehouseId, user.organizationId);

      const thresholdPercent = await this.acceptanceThresholdPercent(tx, user.organizationId);
      const { actual, difference, status } = classifyAcceptance(waybill.declaredWeight, dto.actualWeight, thresholdPercent);
      if (status === "ACCEPTED_WITH_DIFFERENCE" && !dto.reason) throw new BadRequestException("Difference reason is required");

      const acceptance = await tx.acceptance.create({
        data: { waybillId: id, warehouseId: dto.warehouseId, actualWeight: actual, difference, reason: dto.reason, idempotencyKey: dto.idempotencyKey }
      });
      await tx.waybill.update({
        where: { id },
        data: { status, actualWeight: actual, discrepancyReason: dto.reason, acceptedById: user.id, acceptedAt: new Date(), version: { increment: 1 } }
      });
      await tx.inventoryMovement.create({
        data: {
          organizationId: user.organizationId,
          warehouseId: dto.warehouseId,
          type: "RECEIPT",
          state: "DIRTY",
          quantity: actual,
          waybillId: id,
          materialTypeId: waybill.materialTypeId,
          createdById: user.id,
          reason: dto.reason
        }
      });
      await tx.inventoryItem.upsert({
        where: { skuKey: `${dto.warehouseId}:${waybill.materialTypeId}:DIRTY` },
        update: { quantity: { increment: actual } },
        create: { skuKey: `${dto.warehouseId}:${waybill.materialTypeId}:DIRTY`, warehouseId: dto.warehouseId, materialTypeId: waybill.materialTypeId, state: "DIRTY", quantity: actual }
      });
      await tx.auditLog.create({
        data: { organizationId: user.organizationId, userId: user.id, action: "waybill.accept", entity: "Waybill", entityId: id, newValue: acceptance as any, reason: dto.reason }
      });
      await tx.notification.create({
        data: {
          organizationId: user.organizationId,
          type: status === "ACCEPTED_WITH_DIFFERENCE" ? "WEIGHT_DIFFERENCE" : "WAYBILL_ACCEPTED",
          title: status === "ACCEPTED_WITH_DIFFERENCE" ? "Обнаружено расхождение" : "Поставка принята",
          body: `${waybill.number}: фактический вес ${actual.toString()}`
        }
      });
      return acceptance;
    });
  }

  private hash(value: string) {
    return createHash("sha256").update(`${process.env.QR_SIGNING_SECRET ?? "dev-qr"}:${value}`).digest("hex");
  }

  private async assertCreateReferences(tx: WaybillReferenceTx, dto: CreateWaybillDto, organizationId: string) {
    const [counterparty, extractionSite, vehicle, driver, warehouse, materialType] = await Promise.all([
      tx.counterparty.findFirst({ where: { id: dto.counterpartyId, organizationId } }),
      tx.extractionSite.findFirst({ where: { id: dto.extractionSiteId, organizationId } }),
      tx.vehicle.findFirst({ where: { id: dto.vehicleId, organizationId } }),
      tx.driver.findFirst({ where: { id: dto.driverId, organizationId } }),
      tx.warehouse.findFirst({ where: { id: dto.destinationWarehouseId, organizationId } }),
      tx.materialType.findUnique({ where: { id: dto.materialTypeId } })
    ]);
    if (!counterparty) throw new NotFoundException("Counterparty not found");
    if (!extractionSite) throw new NotFoundException("Extraction site not found");
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    if (!driver) throw new NotFoundException("Driver not found");
    if (!warehouse) throw new NotFoundException("Warehouse not found");
    if (!materialType) throw new NotFoundException("Material type not found");
  }

  private async acceptanceThresholdPercent(tx: { systemSetting: { findUnique(args: { where: { organizationId_key: { organizationId: string; key: string } } }): Promise<{ value: unknown } | null> } }, organizationId: string) {
    const setting = await tx.systemSetting.findUnique({ where: { organizationId_key: { organizationId, key: "acceptance.differenceThresholdPercent" } } });
    const value = typeof setting?.value === "number" ? setting.value : Number(setting?.value ?? 3);
    return Number.isFinite(value) && value >= 0 ? value : 3;
  }

}

type WaybillReferenceTx = {
  counterparty: { findFirst(args: { where: { id: string; organizationId: string } }): Promise<unknown> };
  extractionSite: { findFirst(args: { where: { id: string; organizationId: string } }): Promise<unknown> };
  vehicle: { findFirst(args: { where: { id: string; organizationId: string } }): Promise<unknown> };
  driver: { findFirst(args: { where: { id: string; organizationId: string } }): Promise<unknown> };
  warehouse: { findFirst(args: { where: { id: string; organizationId: string } }): Promise<unknown> };
  materialType: { findUnique(args: { where: { id: string } }): Promise<unknown> };
};

function assertTransition(current: string, next: string) {
  const allowed: Record<string, string[]> = {
    CREATED: ["LOADED", "CANCELLED"],
    LOADED: ["IN_TRANSIT", "CANCELLED"],
    IN_TRANSIT: ["ARRIVED", "REJECTED", "CANCELLED"],
    ARRIVED: ["REJECTED", "CANCELLED"]
  };
  if (!allowed[current]?.includes(next)) {
    throw new BadRequestException(`Invalid waybill status transition: ${current} -> ${next}`);
  }
}
