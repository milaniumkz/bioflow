-- Preserve all historical deliveries and bags; new laboratory snapshots are optional on old records.
ALTER TABLE "CollectionShipment" ADD COLUMN "acceptedWeightKg" DECIMAL(18,3), ADD COLUMN "laboratory" JSONB;
ALTER TABLE "CollectionBag" ADD COLUMN "laboratory" JSONB;
