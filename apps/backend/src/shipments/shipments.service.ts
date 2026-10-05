import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CurrentUser } from "../common/current-user.decorator";
import { positiveWeight } from "../common/domain-policies";
import { orderBy, PageDto } from "../common/page.dto";
import { assertProductTypeExists, assertWarehouseInOrganization } from "../common/scope-checks";
import { PrismaService } from "../prisma/prisma.service";
import { CreateShipmentDto } from "./shipments.dto";

@Injectable()
export class ShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PageDto, user: CurrentUser) {
    const where: any = { organizationId: user.organizationId };
    if (query.search) where.recipient = { contains: query.search, mode: "insensitive" };
    if (query.status) where.status = query.status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.shipment.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: orderBy(query, ["createdAt", "quantity", "recipient", "status"]),
        include: { warehouse: true, productType: true }
      }),
      this.prisma.shipment.count({ where })
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  create(dto: CreateShipmentDto, user: CurrentUser) {
    const quantity = positiveWeight(dto.quantity, "Shipment quantity");
    const key = `${dto.warehouseId}:${dto.productTypeId}:FINISHED`;

    return this.prisma.$transaction(async (tx) => {
      await assertWarehouseInOrganization(tx, dto.warehouseId, user.organizationId);
      await assertProductTypeExists(tx, dto.productTypeId);
      const item = await tx.inventoryItem.findUnique({ where: { skuKey: key } });
      if (!item || item.quantity.lt(quantity)) throw new BadRequestException("Not enough finished goods for shipment");

      const shipment = await tx.shipment.create({
        data: {
          organizationId: user.organizationId,
          warehouseId: dto.warehouseId,
          productTypeId: dto.productTypeId,
          quantity,
          recipient: dto.recipient,
          documentNumber: dto.documentNumber,
          createdById: user.id
        }
      });
      await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: quantity } } });
      await tx.inventoryMovement.create({
        data: {
          organizationId: user.organizationId,
          warehouseId: dto.warehouseId,
          type: "SHIPMENT",
          state: "FINISHED",
          quantity: new Prisma.Decimal(quantity).neg(),
          productTypeId: dto.productTypeId,
          createdById: user.id,
          reason: dto.documentNumber ? `Shipment ${dto.documentNumber}` : `Shipment ${shipment.id}`
        }
      });
      await tx.auditLog.create({
        data: { organizationId: user.organizationId, userId: user.id, action: "shipment.create", entity: "Shipment", entityId: shipment.id, newValue: shipment as any }
      });
      await tx.notification.create({
        data: { organizationId: user.organizationId, type: "SHIPMENT_CREATED", title: "Готовая продукция отгружена", body: `${dto.recipient}: ${quantity.toString()}` }
      });
      return shipment;
    });
  }
}
