ALTER TABLE "PushDelivery" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "PushDelivery_status_createdAt_idx" ON "PushDelivery"("status", "createdAt");
