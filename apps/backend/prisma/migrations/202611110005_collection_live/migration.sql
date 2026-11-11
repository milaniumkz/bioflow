-- CreateTable
CREATE TABLE "CollectionLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CollectionLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "CollectionMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionTrip" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "bagCount" INTEGER NOT NULL,
    "weightKg" DECIMAL(18,3) NOT NULL,
    "qrTokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loadedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,

    CONSTRAINT "CollectionTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionDriverSession" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "driverPlate" TEXT NOT NULL,
    "driverPhone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),
    "lastAlertedSignalAt" TIMESTAMP(3),

    CONSTRAINT "CollectionDriverSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionDriverPoint" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionDriverPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionDriverEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionDriverEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionBatch" (
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "totalKg" DECIMAL(18,3) NOT NULL,
    "remainingKg" DECIMAL(18,3) NOT NULL,
    "bagCount" INTEGER,
    "bagWeights" JSONB,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionShipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "bagCount" INTEGER NOT NULL,
    "weightKg" DECIMAL(18,3) NOT NULL,
    "averageBagKg" DECIMAL(18,3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_TRANSIT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "CollectionShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantityKg" DECIMAL(18,3) NOT NULL,
    "details" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionCommand" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionLocation_organizationId_code_key" ON "CollectionLocation"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionMembership_userId_locationId_key" ON "CollectionMembership"("userId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTrip_number_key" ON "CollectionTrip"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTrip_qrTokenHash_key" ON "CollectionTrip"("qrTokenHash");

-- CreateIndex
CREATE INDEX "CollectionTrip_organizationId_warehouseId_status_idx" ON "CollectionTrip"("organizationId", "warehouseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionDriverSession_tripId_key" ON "CollectionDriverSession"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionDriverSession_tokenHash_key" ON "CollectionDriverSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CollectionDriverPoint_sessionId_recordedAt_idx" ON "CollectionDriverPoint"("sessionId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionDriverPoint_sessionId_sequence_key" ON "CollectionDriverPoint"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionDriverEvent_sessionId_requestId_key" ON "CollectionDriverEvent"("sessionId", "requestId");

-- CreateIndex
CREATE INDEX "CollectionBatch_organizationId_locationId_state_createdAt_idx" ON "CollectionBatch"("organizationId", "locationId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionBatch_organizationId_sourceType_sourceId_state_key" ON "CollectionBatch"("organizationId", "sourceType", "sourceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionShipment_number_key" ON "CollectionShipment"("number");

-- CreateIndex
CREATE INDEX "CollectionShipment_organizationId_toLocationId_status_idx" ON "CollectionShipment"("organizationId", "toLocationId", "status");

-- CreateIndex
CREATE INDEX "CollectionAction_organizationId_locationId_createdAt_idx" ON "CollectionAction"("organizationId", "locationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionCommand_organizationId_key_key" ON "CollectionCommand"("organizationId", "key");

-- AddForeignKey
ALTER TABLE "CollectionMembership" ADD CONSTRAINT "CollectionMembership_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "CollectionLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionDriverSession" ADD CONSTRAINT "CollectionDriverSession_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "CollectionTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionDriverPoint" ADD CONSTRAINT "CollectionDriverPoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CollectionDriverSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionDriverEvent" ADD CONSTRAINT "CollectionDriverEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CollectionDriverSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionBatch" ADD CONSTRAINT "CollectionBatch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "CollectionLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
