BEGIN;
-- DropForeignKey
ALTER TABLE "RoutePoint" DROP CONSTRAINT "RoutePoint_waybillId_fkey";

-- DropForeignKey
ALTER TABLE "RouteStop" DROP CONSTRAINT "RouteStop_waybillId_fkey";

-- AlterTable
ALTER TABLE "RoutePoint" ADD COLUMN     "customerDeliveryId" TEXT,
ALTER COLUMN "waybillId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RouteStop" ADD COLUMN     "customerDeliveryId" TEXT,
ALTER COLUMN "waybillId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CustomerDelivery" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "bagCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "departedAt" TIMESTAMP(3),
ADD COLUMN     "loadedAt" TIMESTAMP(3),
ADD COLUMN     "number" TEXT,
ADD COLUMN     "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN     "trackingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vehicleId" TEXT,
ADD COLUMN     "warehouseId" TEXT;

-- AlterTable
ALTER TABLE "CustomerDeliveryEvent" ADD COLUMN     "trackingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vehicleId" TEXT;

-- CreateIndex
CREATE INDEX "RoutePoint_customerDeliveryId_recordedAt_idx" ON "RoutePoint"("customerDeliveryId", "recordedAt");

-- CreateIndex
CREATE INDEX "RouteStop_customerDeliveryId_endedAt_idx" ON "RouteStop"("customerDeliveryId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDelivery_organizationId_number_key" ON "CustomerDelivery"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "RoutePoint" ADD CONSTRAINT "RoutePoint_customerDeliveryId_fkey" FOREIGN KEY ("customerDeliveryId") REFERENCES "CustomerDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePoint" ADD CONSTRAINT "RoutePoint_waybillId_fkey" FOREIGN KEY ("waybillId") REFERENCES "Waybill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_customerDeliveryId_fkey" FOREIGN KEY ("customerDeliveryId") REFERENCES "CustomerDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_waybillId_fkey" FOREIGN KEY ("waybillId") REFERENCES "Waybill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" (id,code,name) VALUES ('workflow-perm-processing.sell.washed','processing.sell.washed','processing.sell.washed') ON CONFLICT (code) DO NOTHING;
INSERT INTO "Permission" (id,code,name) VALUES ('workflow-perm-processing.dispatch','processing.dispatch','processing.dispatch') ON CONFLICT (code) DO NOTHING;
INSERT INTO "Role" (id,code,name) VALUES ('workflow-role-OPERATIONS_MANAGER','OPERATIONS_MANAGER','Приёмка и производство') ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name;
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r.id,p.id FROM "Role" r,"Permission" p WHERE r.code='OPERATIONS_MANAGER' AND p.code IN ('processing.overview','processing.pack','processing.sell','processing.dispatch','laboratory.manage','processing.receive','processing.wash','processing.dry','processing.finished','processing.read','tracking.read','inventory.manage','references.read','inventory.read','operations.manage','reports.read','notifications.read') ON CONFLICT DO NOTHING;
INSERT INTO "Role" (id,code,name) VALUES ('workflow-role-WASH_OPERATOR','WASH_OPERATOR','Оператор мойки') ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name;
DELETE FROM "RolePermission" WHERE "roleId" IN (SELECT id FROM "Role" WHERE code='WASH_OPERATOR');
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r.id,p.id FROM "Role" r,"Permission" p WHERE r.code='WASH_OPERATOR' AND p.code IN ('processing.sell.washed','processing.dispatch','processing.wash','processing.read','tracking.read','references.read','notifications.read') ON CONFLICT DO NOTHING;
INSERT INTO "Role" (id,code,name) VALUES ('workflow-role-OWNER','OWNER','Владелец') ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name;
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r.id,p.id FROM "Role" r,"Permission" p WHERE r.code='OWNER' AND p.code IN ('processing.overview','processing.pack','processing.sell','processing.sell.washed','processing.dispatch','laboratory.manage','processing.receive','processing.wash','processing.dry','processing.finished','processing.read','collection.manage','tracking.read','tracking.write','batches.manage','loading.manage','inventory.manage','references.read','dashboard.read','references.manage','waybills.manage','waybills.accept','inventory.read','operations.manage','reports.read','notifications.read','audit.read','users.manage') ON CONFLICT DO NOTHING;

-- Each GPS record belongs to exactly one kind of trip. Existing waybill history is preserved.
ALTER TABLE "RoutePoint" ADD CONSTRAINT "RoutePoint_one_trip" CHECK (("waybillId" IS NULL) <> ("customerDeliveryId" IS NULL));
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_one_trip" CHECK (("waybillId" IS NULL) <> ("customerDeliveryId" IS NULL));
-- Consolidate only the explicitly combined physical jobs, keeping users, scopes and audit history.
INSERT INTO "UserRole" ("userId","roleId") SELECT DISTINCT ur."userId",new.id FROM "UserRole" ur JOIN "Role" old ON old.id=ur."roleId" CROSS JOIN "Role" new WHERE old.code IN ('WASH_RECEIVER','LAB_TECHNICIAN','DRYING_OPERATOR','FINISHED_RECEIVER','SALES_STOREKEEPER') AND new.code='OPERATIONS_MANAGER' ON CONFLICT DO NOTHING;
DELETE FROM "UserRole" WHERE "roleId" IN (SELECT id FROM "Role" WHERE code IN ('WASH_RECEIVER','LAB_TECHNICIAN','DRYING_OPERATOR','FINISHED_RECEIVER','SALES_STOREKEEPER'));

-- Fill display and source metadata for existing delivery records; no shipment is reposted.
UPDATE "CustomerDelivery" d SET "batchId"=b."batchId", quantity=b.quantity, "bagCount"=1, "warehouseId"=(SELECT m."warehouseId" FROM "BatchMovement" m WHERE m."organizationId"=d."organizationId" AND m."batchId"=b."batchId" AND m.kind='SALE' ORDER BY m."createdAt" DESC LIMIT 1) FROM "BigBag" b WHERE d."sourceId"=b.id;
UPDATE "CustomerDelivery" d SET "warehouseId"=o."fromWarehouseId", quantity=(SELECT COALESCE(SUM(i.quantity),0) FROM "BatchOperationInput" i WHERE i."operationId"=o.id), "bagCount"=(SELECT COUNT(*) FROM "BatchOperationInput" i WHERE i."operationId"=o.id), "batchId"=(SELECT i."batchId" FROM "BatchOperationInput" i WHERE i."operationId"=o.id ORDER BY i.id LIMIT 1) FROM "BatchOperation" o WHERE d."sourceId"=o.id AND o."organizationId"=d."organizationId";
WITH numbered AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt",id) n FROM "CustomerDelivery") UPDATE "CustomerDelivery" d SET number='DEL-'||LPAD(n.n::text,GREATEST(6,LENGTH(n.n::text)),'0') FROM numbered n WHERE n.id=d.id;
INSERT INTO "SystemSetting" (id,"organizationId",key,value) SELECT 'workflow-del-seq:'||"organizationId", "organizationId",'sequence.DEL',to_jsonb(COUNT(*)::int) FROM "CustomerDelivery" GROUP BY "organizationId" ON CONFLICT ("organizationId",key) DO UPDATE SET value=to_jsonb(GREATEST(("SystemSetting".value#>>'{}')::int,(EXCLUDED.value#>>'{}')::int));
COMMIT;
