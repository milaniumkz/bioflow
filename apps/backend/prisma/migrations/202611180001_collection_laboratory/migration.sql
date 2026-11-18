-- Additive only: historical shipments retain their original weights and acceptance records.
ALTER TABLE "CollectionTrip" ADD COLUMN "acceptedWeightKg" DECIMAL(18,3), ADD COLUMN "laboratory" JSONB;
