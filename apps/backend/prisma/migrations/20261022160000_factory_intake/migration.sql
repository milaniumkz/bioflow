-- Add explicit plant intake so in-process material has a location and actor.
ALTER TABLE "BigBag" ADD COLUMN "factoryStartedAt" TIMESTAMP(3), ADD COLUMN "factoryStartedById" TEXT, ADD COLUMN "factoryWarehouseId" TEXT;
CREATE INDEX "ProcessRun_organizationId_rootBatchId_createdAt_idx" ON "ProcessRun"("organizationId", "rootBatchId", "createdAt");
CREATE INDEX "BigBag_packedById_packingDate_packingShift_idx" ON "BigBag"("packedById", "packingDate", "packingShift");
