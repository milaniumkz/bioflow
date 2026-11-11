-- DropForeignKey
ALTER TABLE "Waybill" DROP CONSTRAINT "Waybill_vehicleId_fkey";

-- AlterTable
ALTER TABLE "CollectionTrip" ADD COLUMN     "fromLocationId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'RAW',
ADD COLUMN     "recipientAddress" TEXT,
ADD COLUMN     "recipientName" TEXT,
ALTER COLUMN "warehouseId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CollectionBag" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "weightKg" DECIMAL(18,3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "tripId" TEXT,

    CONSTRAINT "CollectionBag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionBag_tripId_idx" ON "CollectionBag"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionBag_batchId_index_key" ON "CollectionBag"("batchId", "index");

-- AddForeignKey
ALTER TABLE "Waybill" ADD CONSTRAINT "Waybill_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionBag" ADD CONSTRAINT "CollectionBag_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CollectionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
