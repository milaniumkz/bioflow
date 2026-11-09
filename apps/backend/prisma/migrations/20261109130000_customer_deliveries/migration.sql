CREATE TABLE "CustomerDelivery" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "driverId" TEXT,
  "destination" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerDelivery_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CustomerDeliveryEvent" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "driverId" TEXT,
  "destination" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerDeliveryEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerDelivery_organizationId_sourceId_key" ON "CustomerDelivery"("organizationId", "sourceId");
CREATE INDEX "CustomerDelivery_organizationId_status_idx" ON "CustomerDelivery"("organizationId", "status");
CREATE INDEX "CustomerDeliveryEvent_deliveryId_createdAt_idx" ON "CustomerDeliveryEvent"("deliveryId", "createdAt");
ALTER TABLE "CustomerDeliveryEvent" ADD CONSTRAINT "CustomerDeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "CustomerDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
