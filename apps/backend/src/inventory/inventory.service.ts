import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CurrentUser } from "../common/current-user.decorator";
import { decimal } from "../common/domain-policies";
import { assertItemTypeReferences, assertWarehouseInOrganization } from "../common/scope-checks";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCorrectionDto } from "./inventory.dto";

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  correct(dto: CreateCorrectionDto, user: CurrentUser) {
    if (!dto.materialTypeId && !dto.productTypeId) throw new BadRequestException("Material or product type is required");
    if (dto.state !== "FINISHED" && !dto.materialTypeId) throw new BadRequestException("Material type is required for raw states");
    if (dto.state === "FINISHED" && !dto.productTypeId) throw new BadRequestException("Product type is required for finished goods");
    const delta = decimal(dto.quantityDelta);
    if (delta.equals(0)) throw new BadRequestException("Correction delta cannot be zero");
    const skuKey = `${dto.warehouseId}:${dto.materialTypeId ?? dto.productTypeId}:${dto.state}`;

    return this.prisma.$transaction(async (tx) => {
      await assertWarehouseInOrganization(tx, dto.warehouseId, user.organizationId);
      await assertItemTypeReferences(tx, dto);
      const existing = await tx.inventoryItem.findUnique({ where: { skuKey } });
      const current = existing?.quantity ?? new Prisma.Decimal(0);
      const next = current.plus(delta);
      if (next.lt(0)) throw new BadRequestException("Correction would make stock negative");

      const item = await tx.inventoryItem.upsert({
        where: { skuKey },
        update: { quantity: next },
        create: {
          skuKey,
          warehouseId: dto.warehouseId,
          materialTypeId: dto.materialTypeId,
          productTypeId: dto.productTypeId,
          state: dto.state,
          quantity: next
        }
      });
      const movement = await tx.inventoryMovement.create({
        data: {
          organizationId: user.organizationId,
          warehouseId: dto.warehouseId,
          type: "CORRECTION",
          state: dto.state,
          quantity: delta,
          materialTypeId: dto.materialTypeId,
          productTypeId: dto.productTypeId,
          createdById: user.id,
          reason: dto.reason
        }
      });
      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: "inventory.correction",
          entity: "InventoryItem",
          entityId: item.id,
          oldValue: { quantity: current.toString() },
          newValue: { quantity: next.toString(), movementId: movement.id },
          reason: dto.reason
        }
      });
      return { item, movement };
    });
  }
}
