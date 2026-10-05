import { BadRequestException, Injectable } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator";
import { nextDocumentNumber } from "../common/document-numbers";
import { validateProductionFormula, validateWashingFormula } from "../common/domain-policies";
import { assertProductTypeExists, assertWarehouseInOrganization } from "../common/scope-checks";
import { PrismaService } from "../prisma/prisma.service";
import { ProductionDto, WashingDto } from "./operations.dto";

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  washing(dto: WashingDto, user: CurrentUser) {
    const { inputWeight: input, outputWeight: output, wasteWeight: waste, lossWeight: loss } = validateWashingFormula(dto.inputWeight, dto.outputWeight, dto.wasteWeight, dto.lossWeight);
    return this.prisma.$transaction(async (tx) => {
      await assertWarehouseInOrganization(tx, dto.warehouseId, user.organizationId);
      const dirty = await tx.inventoryItem.findFirst({ where: { warehouseId: dto.warehouseId, state: "DIRTY" } });
      if (!dirty || dirty.quantity.lt(input)) throw new BadRequestException("Not enough dirty material");
      if (!dirty.materialTypeId) throw new BadRequestException("Dirty material type is missing");
      const number = await nextDocumentNumber(tx, user.organizationId, "WASH");
      const batch = await tx.washingBatch.create({
        data: { organizationId: user.organizationId, number, warehouseId: dto.warehouseId, inputWeight: input, outputWeight: output, wasteWeight: waste, lossWeight: loss, status: "CONFIRMED", createdById: user.id }
      });
      await tx.inventoryItem.update({ where: { id: dirty.id }, data: { quantity: { decrement: input } } });
      await tx.inventoryItem.upsert({
        where: { skuKey: `${dto.warehouseId}:${dirty.materialTypeId}:WASHED` },
        update: { quantity: { increment: output } },
        create: { skuKey: `${dto.warehouseId}:${dirty.materialTypeId}:WASHED`, warehouseId: dto.warehouseId, materialTypeId: dirty.materialTypeId, state: "WASHED", quantity: output }
      });
      await tx.inventoryMovement.createMany({
        data: [
          { organizationId: user.organizationId, warehouseId: dto.warehouseId, type: "WASH_INPUT", state: "DIRTY", quantity: input.neg(), batchId: batch.id, materialTypeId: dirty.materialTypeId, createdById: user.id },
          { organizationId: user.organizationId, warehouseId: dto.warehouseId, type: "WASH_OUTPUT", state: "WASHED", quantity: output, batchId: batch.id, materialTypeId: dirty.materialTypeId, createdById: user.id }
        ]
      });
      await tx.notification.create({
        data: { organizationId: user.organizationId, type: "WASHING_COMPLETED", title: "Мойка завершена", body: `${batch.number}: выход ${output.toString()}` }
      });
      return batch;
    });
  }

  production(dto: ProductionDto, user: CurrentUser) {
    const { inputWeight: input, outputWeight: output, wasteWeight: waste, lossWeight: loss } = validateProductionFormula(dto.inputWeight, dto.outputWeight, dto.wasteWeight, dto.lossWeight);
    return this.prisma.$transaction(async (tx) => {
      await assertWarehouseInOrganization(tx, dto.warehouseId, user.organizationId);
      await assertProductTypeExists(tx, dto.productTypeId);
      const washed = await tx.inventoryItem.findFirst({ where: { warehouseId: dto.warehouseId, state: "WASHED" } });
      if (!washed || washed.quantity.lt(input)) throw new BadRequestException("Not enough washed material");
      const number = await nextDocumentNumber(tx, user.organizationId, "PROD");
      const batch = await tx.productionBatch.create({
        data: { organizationId: user.organizationId, number, warehouseId: dto.warehouseId, productTypeId: dto.productTypeId, inputWeight: input, outputWeight: output, wasteWeight: waste, lossWeight: loss, status: "CONFIRMED", createdById: user.id }
      });
      await tx.inventoryItem.update({ where: { id: washed.id }, data: { quantity: { decrement: input } } });
      await tx.inventoryItem.upsert({
        where: { skuKey: `${dto.warehouseId}:${dto.productTypeId}:FINISHED` },
        update: { quantity: { increment: output } },
        create: { skuKey: `${dto.warehouseId}:${dto.productTypeId}:FINISHED`, warehouseId: dto.warehouseId, productTypeId: dto.productTypeId, state: "FINISHED", quantity: output }
      });
      await tx.inventoryMovement.createMany({
        data: [
          { organizationId: user.organizationId, warehouseId: dto.warehouseId, type: "PRODUCTION_INPUT", state: "WASHED", quantity: input.neg(), batchId: batch.id, materialTypeId: washed.materialTypeId, createdById: user.id },
          { organizationId: user.organizationId, warehouseId: dto.warehouseId, type: "PRODUCTION_OUTPUT", state: "FINISHED", quantity: output, batchId: batch.id, productTypeId: dto.productTypeId, createdById: user.id }
        ]
      });
      await tx.notification.create({
        data: { organizationId: user.organizationId, type: "PRODUCTION_COMPLETED", title: "Производство завершено", body: `${batch.number}: выпуск ${output.toString()}` }
      });
      return batch;
    });
  }
}
