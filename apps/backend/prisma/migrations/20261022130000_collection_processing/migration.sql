-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Waybill" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "bagCount" INTEGER,
ADD COLUMN     "departedAt" TIMESTAMP(3),
ADD COLUMN     "receivedBagCount" INTEGER;

-- AlterTable
ALTER TABLE "MaterialBatch" ADD COLUMN     "actualBagCount" INTEGER,
ADD COLUMN     "actualCollectedQuantity" DECIMAL(14,3);

-- CreateTable
CREATE TABLE "RoutePoint" (
    "id" TEXT NOT NULL,
    "waybillId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "RoutePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteStop" (
    "id" TEXT NOT NULL,
    "waybillId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaboratoryAnalysis" (
    "sedimentPercent" DECIMAL(5,2) NOT NULL,
    "baseQuantity" DECIMAL(14,3) NOT NULL,
    "actualQuantity" DECIMAL(14,3) NOT NULL,
    "actualBagCount" INTEGER NOT NULL,
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "moisturePercent" DECIMAL(5,2) NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaboratoryAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessRun" (
    "rootBatchId" TEXT NOT NULL,
    "preparedBatchId" TEXT,
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "inputQuantity" DECIMAL(14,3) NOT NULL,
    "outputQuantity" DECIMAL(14,3) NOT NULL,
    "coefficientPercent" DECIMAL(8,3) NOT NULL,
    "coefficientBasis" TEXT NOT NULL,
    "normMinPercent" DECIMAL(8,3) NOT NULL,
    "normMaxPercent" DECIMAL(8,3) NOT NULL,
    "deviation" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessInput" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "ProcessInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BigBag" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "stage" TEXT NOT NULL,
    "packedAt" TIMESTAMP(3),
    "packedById" TEXT,
    "packingShift" TEXT,
    "packingDate" TEXT,
    "soldAt" TIMESTAMP(3),
    "soldById" TEXT,
    "saleRecipient" TEXT,
    "saleDocument" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "receivedWarehouseId" TEXT,

    CONSTRAINT "BigBag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutePoint_waybillId_recordedAt_idx" ON "RoutePoint"("waybillId", "recordedAt");

-- CreateIndex
CREATE INDEX "RouteStop_waybillId_endedAt_idx" ON "RouteStop"("waybillId", "endedAt");

-- CreateIndex
CREATE INDEX "LaboratoryAnalysis_batchId_measuredAt_idx" ON "LaboratoryAnalysis"("batchId", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessRun_preparedBatchId_key" ON "ProcessRun"("preparedBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessRun_number_key" ON "ProcessRun"("number");

-- CreateIndex
CREATE INDEX "ProcessRun_organizationId_kind_createdAt_idx" ON "ProcessRun"("organizationId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessInput_processId_batchId_key" ON "ProcessInput"("processId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "BigBag_batchId_key" ON "BigBag"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "BigBag_processId_ordinal_key" ON "BigBag"("processId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePoint" ADD CONSTRAINT "RoutePoint_waybillId_fkey" FOREIGN KEY ("waybillId") REFERENCES "Waybill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_waybillId_fkey" FOREIGN KEY ("waybillId") REFERENCES "Waybill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaboratoryAnalysis" ADD CONSTRAINT "LaboratoryAnalysis_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MaterialBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessInput" ADD CONSTRAINT "ProcessInput_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ProcessRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessInput" ADD CONSTRAINT "ProcessInput_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MaterialBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BigBag" ADD CONSTRAINT "BigBag_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MaterialBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BigBag" ADD CONSTRAINT "BigBag_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ProcessRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Add roles without replacing existing role assignments or permissions.
INSERT INTO "Permission" ("id", "code", "name") VALUES ('collection-perm-collection.manage', 'collection.manage', 'collection.manage') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Permission" ("id", "code", "name") VALUES ('collection-perm-tracking.read', 'tracking.read', 'tracking.read') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Permission" ("id", "code", "name") VALUES ('collection-perm-tracking.write', 'tracking.write', 'tracking.write') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Permission" ("id", "code", "name") VALUES ('collection-perm-laboratory.manage', 'laboratory.manage', 'laboratory.manage') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Permission" ("id", "code", "name") VALUES ('collection-perm-processing.receive', 'processing.receive', 'processing.receive') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Permission" ("id", "code", "name") VALUES ('collection-perm-processing.wash', 'processing.wash', 'processing.wash') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Permission" ("id", "code", "name") VALUES ('collection-perm-processing.dry', 'processing.dry', 'processing.dry') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Permission" ("id", "code", "name") VALUES ('collection-perm-processing.finished', 'processing.finished', 'processing.finished') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Permission" ("id", "code", "name") VALUES ('collection-perm-processing.pack', 'processing.pack', 'processing.pack') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Permission" ("id", "code", "name") VALUES ('collection-perm-processing.sell', 'processing.sell', 'processing.sell') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Permission" ("id", "code", "name") VALUES ('collection-perm-processing.read', 'processing.read', 'processing.read') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Role" ("id", "code", "name") VALUES ('collection-role-COLLECTOR', 'COLLECTOR', 'Сборщик') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='COLLECTOR' AND p.code='collection.manage' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='COLLECTOR' AND p.code='tracking.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='COLLECTOR' AND p.code='references.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='COLLECTOR' AND p.code='notifications.read' ON CONFLICT DO NOTHING;
INSERT INTO "Role" ("id", "code", "name") VALUES ('collection-role-DRIVER', 'DRIVER', 'Водитель') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='DRIVER' AND p.code='tracking.write' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='DRIVER' AND p.code='notifications.read' ON CONFLICT DO NOTHING;
INSERT INTO "Role" ("id", "code", "name") VALUES ('collection-role-LAB_TECHNICIAN', 'LAB_TECHNICIAN', 'Лаборант') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='LAB_TECHNICIAN' AND p.code='laboratory.manage' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='LAB_TECHNICIAN' AND p.code='processing.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='LAB_TECHNICIAN' AND p.code='references.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='LAB_TECHNICIAN' AND p.code='notifications.read' ON CONFLICT DO NOTHING;
INSERT INTO "Role" ("id", "code", "name") VALUES ('collection-role-WASH_RECEIVER', 'WASH_RECEIVER', 'Приёмщик мойки') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='WASH_RECEIVER' AND p.code='processing.receive' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='WASH_RECEIVER' AND p.code='processing.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='WASH_RECEIVER' AND p.code='references.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='WASH_RECEIVER' AND p.code='notifications.read' ON CONFLICT DO NOTHING;
INSERT INTO "Role" ("id", "code", "name") VALUES ('collection-role-DRYING_OPERATOR', 'DRYING_OPERATOR', 'Оператор завода') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='DRYING_OPERATOR' AND p.code='processing.dry' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='DRYING_OPERATOR' AND p.code='processing.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='DRYING_OPERATOR' AND p.code='references.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='DRYING_OPERATOR' AND p.code='notifications.read' ON CONFLICT DO NOTHING;
INSERT INTO "Role" ("id", "code", "name") VALUES ('collection-role-FINISHED_RECEIVER', 'FINISHED_RECEIVER', 'Кладовщик готовой продукции') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='FINISHED_RECEIVER' AND p.code='processing.finished' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='FINISHED_RECEIVER' AND p.code='processing.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='FINISHED_RECEIVER' AND p.code='references.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='FINISHED_RECEIVER' AND p.code='notifications.read' ON CONFLICT DO NOTHING;
INSERT INTO "Role" ("id", "code", "name") VALUES ('collection-role-PACKER', 'PACKER', 'Упаковщик') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='PACKER' AND p.code='processing.pack' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='PACKER' AND p.code='processing.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='PACKER' AND p.code='references.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='PACKER' AND p.code='notifications.read' ON CONFLICT DO NOTHING;
INSERT INTO "Role" ("id", "code", "name") VALUES ('collection-role-SALES_STOREKEEPER', 'SALES_STOREKEEPER', 'Кладовщик отпуска и продаж') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name";
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='SALES_STOREKEEPER' AND p.code='processing.sell' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='SALES_STOREKEEPER' AND p.code='processing.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='SALES_STOREKEEPER' AND p.code='references.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='SALES_STOREKEEPER' AND p.code='notifications.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='OWNER' AND p.code='collection.manage' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='OWNER' AND p.code='tracking.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='OWNER' AND p.code='tracking.write' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='OWNER' AND p.code='laboratory.manage' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='OWNER' AND p.code='processing.receive' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='OWNER' AND p.code='processing.wash' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='OWNER' AND p.code='processing.dry' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='OWNER' AND p.code='processing.finished' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='OWNER' AND p.code='processing.pack' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='OWNER' AND p.code='processing.sell' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='OWNER' AND p.code='processing.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='WASH_OPERATOR' AND p.code='processing.read' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.code='WASH_OPERATOR' AND p.code='processing.wash' ON CONFLICT DO NOTHING;

-- Validate the telemetry and packaging invariants in PostgreSQL as well as DTOs.
ALTER TABLE "Waybill" ADD CONSTRAINT "Waybill_bag_count_positive" CHECK (("bagCount" IS NULL OR "bagCount" > 0) AND ("receivedBagCount" IS NULL OR "receivedBagCount" > 0));
ALTER TABLE "RoutePoint" ADD CONSTRAINT "RoutePoint_valid_coordinates" CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND accuracy BETWEEN 0 AND 50);
ALTER TABLE "LaboratoryAnalysis" ADD CONSTRAINT "LaboratoryAnalysis_valid_moisture" CHECK ("moisturePercent" BETWEEN 0 AND 100);
ALTER TABLE "BigBag" ADD CONSTRAINT "BigBag_positive_quantity" CHECK (quantity > 0);
ALTER TABLE "ProcessRun" ADD CONSTRAINT "ProcessRun_mass_balance" CHECK ("inputQuantity" > 0 AND "outputQuantity" > 0 AND "outputQuantity" <= "inputQuantity");

INSERT INTO "Permission" ("id","code","name") VALUES ('collection-perm-processing.overview','processing.overview','processing.overview') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r.id,p.id FROM "Role" r,"Permission" p WHERE r.code='OWNER' AND p.code='processing.overview' ON CONFLICT DO NOTHING;
ALTER TABLE "LaboratoryAnalysis" ADD CONSTRAINT "LaboratoryAnalysis_valid_sediment" CHECK ("sedimentPercent" >= 0 AND "sedimentPercent" < 100 AND "baseQuantity" > 0 AND "actualQuantity" > 0 AND "actualBagCount" > 0);

INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r.id,p.id FROM "Role" r,"Permission" p WHERE r.code='COLLECTOR' AND p.code='processing.read' ON CONFLICT DO NOTHING;
