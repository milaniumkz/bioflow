import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CurrentUser } from "../common/current-user.decorator";
import { positiveWeight } from "../common/domain-policies";
import { orderBy, PageDto } from "../common/page.dto";
import { assertItemTypeReferences, assertWarehouseInOrganization } from "../common/scope-checks";
import { PrismaService } from "../prisma/prisma.service";
import { CancelTransferDto, CreateTransferDto } from "./transfers.dto";

@Injectable()
export class TransfersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PageDto, user: CurrentUser) {
    const where: any = { organizationId: user.organizationId };
    if (query.status) where.status = query.status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.warehouseTransfer.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { fromWarehouse: true, toWarehouse: true, items: { include: { materialType: true, productType: true } } },
        orderBy: orderBy(query, ["createdAt", "status"])
      }),
      this.prisma.warehouseTransfer.count({ where })
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  create(dto: CreateTransferDto, user: CurrentUser) {
    if (dto.fromWarehouseId === dto.toWarehouseId) throw new BadRequestException("Warehouses must be different");
    if (dto.items.length === 0) throw new BadRequestException("Transfer must contain items");
    return this.prisma.$transaction(async (tx) => {
      await assertWarehouseInOrganization(tx, dto.fromWarehouseId, user.organizationId);
      await assertWarehouseInOrganization(tx, dto.toWarehouseId, user.organizationId);
      for (const item of dto.items) {
        await assertItemTypeReferences(tx, item);
      }
      return tx.warehouseTransfer.create({
        data: {
          organizationId: user.organizationId,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          status: "DRAFT",
          items: {
            create: dto.items.map((item) => ({
              materialTypeId: item.materialTypeId,
              productTypeId: item.productTypeId,
              state: item.state,
              quantity: positiveWeight(item.quantity, "Transfer quantity")
            }))
          }
        },
        include: { fromWarehouse: true, toWarehouse: true, items: { include: { materialType: true, productType: true } } }
      });
    });
  }

  confirm(id: string, user: CurrentUser) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.warehouseTransfer.findFirst({
        where: { id, organizationId: user.organizationId },
        include: { items: true }
      });
      if (!transfer) throw new NotFoundException("Transfer not found");
      if (transfer.status !== "DRAFT") throw new BadRequestException("Transfer is already closed");
      await assertWarehouseInOrganization(tx, transfer.fromWarehouseId, user.organizationId);
      await assertWarehouseInOrganization(tx, transfer.toWarehouseId, user.organizationId);

      for (const item of transfer.items) {
        const sku = skuKey(transfer.fromWarehouseId, item.materialTypeId, item.productTypeId, item.state);
        const source = await tx.inventoryItem.findUnique({ where: { skuKey: sku } });
        if (!source || source.quantity.lt(item.quantity)) throw new BadRequestException("Not enough stock for transfer");

        await tx.inventoryItem.update({ where: { id: source.id }, data: { quantity: { decrement: item.quantity } } });
        await tx.inventoryItem.upsert({
          where: { skuKey: skuKey(transfer.toWarehouseId, item.materialTypeId, item.productTypeId, item.state) },
          update: { quantity: { increment: item.quantity } },
          create: {
            skuKey: skuKey(transfer.toWarehouseId, item.materialTypeId, item.productTypeId, item.state),
            warehouseId: transfer.toWarehouseId,
            materialTypeId: item.materialTypeId,
            productTypeId: item.productTypeId,
            state: item.state,
            quantity: item.quantity
          }
        });
        await tx.inventoryMovement.createMany({
          data: [
            {
              organizationId: user.organizationId,
              warehouseId: transfer.fromWarehouseId,
              type: "TRANSFER_OUT",
              state: item.state,
              quantity: new Prisma.Decimal(item.quantity).neg(),
              materialTypeId: item.materialTypeId,
              productTypeId: item.productTypeId,
              createdById: user.id,
              reason: `Transfer ${transfer.id}`
            },
            {
              organizationId: user.organizationId,
              warehouseId: transfer.toWarehouseId,
              type: "TRANSFER_IN",
              state: item.state,
              quantity: item.quantity,
              materialTypeId: item.materialTypeId,
              productTypeId: item.productTypeId,
              createdById: user.id,
              reason: `Transfer ${transfer.id}`
            }
          ]
        });
      }

      const updated = await tx.warehouseTransfer.update({ where: { id }, data: { status: "CONFIRMED" }, include: { fromWarehouse: true, toWarehouse: true, items: { include: { materialType: true, productType: true } } } });
      await tx.auditLog.create({
        data: { organizationId: user.organizationId, userId: user.id, action: "transfer.confirm", entity: "WarehouseTransfer", entityId: id, newValue: updated as any }
      });
      await tx.notification.create({
        data: { organizationId: user.organizationId, type: "TRANSFER_CONFIRMED", title: "Перемещение подтверждено", body: `Перемещение ${transfer.id} проведено` }
      });
      return updated;
    });
  }

  cancel(id: string, dto: CancelTransferDto, user: CurrentUser) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.warehouseTransfer.findFirst({ where: { id, organizationId: user.organizationId }, include: { items: true } });
      if (!transfer) throw new NotFoundException("Transfer not found");
      if (transfer.status !== "DRAFT") throw new BadRequestException("Only draft transfers can be cancelled");
      const updated = await tx.warehouseTransfer.update({ where: { id }, data: { status: "CANCELLED" }, include: { fromWarehouse: true, toWarehouse: true, items: { include: { materialType: true, productType: true } } } });
      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: "transfer.cancel",
          entity: "WarehouseTransfer",
          entityId: id,
          oldValue: transfer as any,
          newValue: updated as any,
          reason: dto.reason
        }
      });
      await tx.notification.create({
        data: { organizationId: user.organizationId, type: "TRANSFER_CANCELLED", title: "Перемещение отменено", body: `Перемещение ${transfer.id}: ${dto.reason}` }
      });
      return updated;
    });
  }
}

function skuKey(warehouseId: string, materialTypeId: string | null, productTypeId: string | null, state: string) {
  return `${warehouseId}:${materialTypeId ?? productTypeId}:${state}`;
}
