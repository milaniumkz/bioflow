import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CurrentUser } from "../common/current-user.decorator";
import { positiveWeight } from "../common/domain-policies";
import { orderBy, PageDto } from "../common/page.dto";
import { assertItemTypeReferences, assertWarehouseInOrganization } from "../common/scope-checks";
import { PrismaService } from "../prisma/prisma.service";
import { CreateWriteOffDto } from "./write-offs.dto";

@Injectable()
export class WriteOffsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PageDto, user: CurrentUser) {
    const where: any = { organizationId: user.organizationId };
    if (query.search) where.reason = { contains: query.search, mode: "insensitive" };
    if (query.status) where.status = query.status;
    if (query.state) where.state = query.state;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.writeOff.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: orderBy(query, ["createdAt", "quantity", "state", "status"]),
        include: { warehouse: true, materialType: true, productType: true }
      }),
      this.prisma.writeOff.count({ where })
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  create(dto: CreateWriteOffDto, user: CurrentUser) {
    if (!dto.materialTypeId && !dto.productTypeId) throw new BadRequestException("Material or product type is required");
    if (dto.state !== "FINISHED" && !dto.materialTypeId) throw new BadRequestException("Material type is required for raw states");
    if (dto.state === "FINISHED" && !dto.productTypeId) throw new BadRequestException("Product type is required for finished goods");
    const quantity = positiveWeight(dto.quantity, "Write-off quantity");
    const key = skuKey(dto.warehouseId, dto.materialTypeId, dto.productTypeId, dto.state);

    return this.prisma.$transaction(async (tx) => {
      await assertWarehouseInOrganization(tx, dto.warehouseId, user.organizationId);
      await assertItemTypeReferences(tx, dto);
      const item = await tx.inventoryItem.findUnique({ where: { skuKey: key } });
      if (!item || item.quantity.lt(quantity)) throw new BadRequestException("Not enough stock for write-off");

      const writeOff = await tx.writeOff.create({
        data: {
          organizationId: user.organizationId,
          warehouseId: dto.warehouseId,
          materialTypeId: dto.materialTypeId,
          productTypeId: dto.productTypeId,
          state: dto.state,
          quantity,
          reason: dto.reason,
          createdById: user.id
        }
      });
      await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: quantity } } });
      await tx.inventoryMovement.create({
        data: {
          organizationId: user.organizationId,
          warehouseId: dto.warehouseId,
          type: "WRITE_OFF",
          state: dto.state,
          quantity: new Prisma.Decimal(quantity).neg(),
          materialTypeId: dto.materialTypeId,
          productTypeId: dto.productTypeId,
          createdById: user.id,
          reason: dto.reason
        }
      });
      await tx.auditLog.create({
        data: { organizationId: user.organizationId, userId: user.id, action: "write-off.create", entity: "WriteOff", entityId: writeOff.id, newValue: writeOff as any, reason: dto.reason }
      });
      await tx.notification.create({
        data: { organizationId: user.organizationId, type: "WRITE_OFF_CREATED", title: "Материал списан", body: `${dto.state}: ${quantity.toString()}. Причина: ${dto.reason}` }
      });
      return writeOff;
    });
  }
}

function skuKey(warehouseId: string, materialTypeId: string | undefined, productTypeId: string | undefined, state: string) {
  return `${warehouseId}:${materialTypeId ?? productTypeId}:${state}`;
}
