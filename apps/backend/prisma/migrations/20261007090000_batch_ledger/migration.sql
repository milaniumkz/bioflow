-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WaybillStatus" ADD VALUE 'UNLOADED';
ALTER TYPE "WaybillStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "WaybillStatus" ADD VALUE 'REVIEW';
ALTER TYPE "WaybillStatus" ADD VALUE 'PARTIALLY_ACCEPTED';

-- DropForeignKey
ALTER TABLE "Waybill" DROP CONSTRAINT "Waybill_driverId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accessAllObjects" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "counterpartyScopeId" TEXT,
ADD COLUMN     "extractionScopeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "warehouseScopeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "capacity" DECIMAL(14,3),
ADD COLUMN     "model" TEXT,
ADD COLUMN     "tareWeight" DECIMAL(14,3);

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "allowedMaterialTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "capacity" DECIMAL(14,3),
ADD COLUMN     "warehouseType" TEXT NOT NULL DEFAULT 'RAW';

-- AlterTable
ALTER TABLE "Waybill" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "documentDate" TIMESTAMP(3),
ADD COLUMN     "grossWeight" DECIMAL(14,3),
ADD COLUMN     "measurementMethod" TEXT,
ADD COLUMN     "receiptWarehouseId" TEXT,
ADD COLUMN     "receivedWeight" DECIMAL(14,3),
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "tareWeight" DECIMAL(14,3),
ALTER COLUMN "driverId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "deviceId" TEXT;

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MaterialBatch" (
    "originCounterpartyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "originExtractionSiteIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "qrTokenHash" TEXT NOT NULL,
    "state" "MaterialState" NOT NULL DEFAULT 'DIRTY',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "counterpartyId" TEXT,
    "extractionSiteId" TEXT,
    "materialTypeId" TEXT,
    "productTypeId" TEXT,
    "initialQuantity" DECIMAL(14,3) NOT NULL,
    "availableSourceQuantity" DECIMAL(14,3) NOT NULL,
    "measurementMethod" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "MaterialBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchStock" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchOperation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'DRAFT',
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "outputBatchId" TEXT,
    "outputQuantity" DECIMAL(14,3),
    "wasteQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "lossQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "defectQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "details" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "cancelledById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchOperationInput" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "BatchOperationInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "reservedDelta" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "operationId" TEXT,
    "waybillId" TEXT,
    "reversesId" TEXT,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceValue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ReferenceValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialBatch_number_key" ON "MaterialBatch"("number");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialBatch_qrTokenHash_key" ON "MaterialBatch"("qrTokenHash");

-- CreateIndex
CREATE INDEX "MaterialBatch_organizationId_counterpartyId_state_status_idx" ON "MaterialBatch"("organizationId", "counterpartyId", "state", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BatchStock_batchId_warehouseId_key" ON "BatchStock"("batchId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchOperation_number_key" ON "BatchOperation"("number");

-- CreateIndex
CREATE UNIQUE INDEX "BatchOperation_outputBatchId_key" ON "BatchOperation"("outputBatchId");

-- CreateIndex
CREATE INDEX "BatchOperation_organizationId_kind_status_createdAt_idx" ON "BatchOperation"("organizationId", "kind", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BatchOperation_organizationId_idempotencyKey_key" ON "BatchOperation"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BatchOperationInput_operationId_batchId_key" ON "BatchOperationInput"("operationId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchMovement_reversesId_key" ON "BatchMovement"("reversesId");

-- CreateIndex
CREATE INDEX "BatchMovement_organizationId_batchId_warehouseId_createdAt_idx" ON "BatchMovement"("organizationId", "batchId", "warehouseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommandReceipt_organizationId_key_key" ON "CommandReceipt"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceValue_organizationId_category_code_key" ON "ReferenceValue"("organizationId", "category", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PushDelivery_notificationId_deviceId_key" ON "PushDelivery"("notificationId", "deviceId");

-- AddForeignKey
ALTER TABLE "Waybill" ADD CONSTRAINT "Waybill_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MaterialBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waybill" ADD CONSTRAINT "Waybill_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchStock" ADD CONSTRAINT "BatchStock_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MaterialBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchOperation" ADD CONSTRAINT "BatchOperation_outputBatchId_fkey" FOREIGN KEY ("outputBatchId") REFERENCES "MaterialBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchOperationInput" ADD CONSTRAINT "BatchOperationInput_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "BatchOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchOperationInput" ADD CONSTRAINT "BatchOperationInput_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MaterialBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchMovement" ADD CONSTRAINT "BatchMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MaterialBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchMovement" ADD CONSTRAINT "BatchMovement_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "BatchOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariants apply to every writer, including parallel API requests.
ALTER TABLE "BatchStock" ADD CONSTRAINT "BatchStock_balance_check" CHECK ("quantity" >= 0 AND "reserved" >= 0 AND "quantity" >= "reserved");
ALTER TABLE "MaterialBatch" ADD CONSTRAINT "MaterialBatch_source_check" CHECK ("initialQuantity" > 0 AND "availableSourceQuantity" >= 0 AND "availableSourceQuantity" <= "initialQuantity");
CREATE FUNCTION bioflow_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BIOFLOW audit and movement records are append-only'; END; $$;
CREATE TRIGGER "BatchMovement_append_only" BEFORE UPDATE OR DELETE ON "BatchMovement" FOR EACH ROW EXECUTE FUNCTION bioflow_append_only();
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION bioflow_append_only();
