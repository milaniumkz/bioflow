import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { bootstrapCollection } from "../prisma/bootstrap-collection";
import { CollectionService } from "../src/collection/collection.service";
import { CollectionTestCleanupService } from "../src/collection/collection-test-cleanup";

test("Test cleanup is previewed, refuses unrelated operations, preserves opening inventory and removes only the test chain", async () => {
  if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_spec"))
    throw Error("Requires isolated spec database");
  const db = new PrismaClient();
  try {
    const organizationId = "maintenance-spec-" + randomUUID();
    process.env.COLLECTION_ORGANIZATION_ID = organizationId;
    await bootstrapCollection(db);
    const owner = await db.user.create({
      data: { organizationId, fullName: "Spec owner", passwordHash: "unused" },
    });
    const actor = {
      id: owner.id,
      organizationId,
      roles: ["OWNER"],
      permissions: [],
    };
    const service = new CollectionTestCleanupService(new CollectionService(db));
    const warehouse = await db.collectionLocation.findFirstOrThrow({
      where: { organizationId, code: "HELIOS" },
    });
    const factory = await db.collectionLocation.create({
      data: {
        organizationId,
        code: randomUUID(),
        kind: "FACTORY",
        name: "Тестовый завод",
      },
    });
    const trip = await db.collectionTrip.create({
      data: {
        organizationId,
        number: randomUUID(),
        createdById: "collection-test-collector",
        warehouseId: warehouse.id,
        weightKg: 20000,
        bagCount: 50,
        qrTokenHash: randomUUID(),
      },
    });
    const opening = await db.collectionBatch.create({
      data: {
        organizationId,
        locationId: warehouse.id,
        state: "RAW",
        totalKg: 1000,
        remainingKg: 800,
        sourceType: "OPENING",
        sourceId: randomUUID(),
        createdById: "SYSTEM_OPENING",
      },
    });
    await db.collectionBatch.create({
      data: {
        organizationId,
        locationId: warehouse.id,
        state: "RAW",
        totalKg: 20000,
        remainingKg: 20000,
        sourceType: "TRIP",
        sourceId: trip.id,
        createdById: "collection-test-collector",
      },
    });
    await db.collectionAction.create({
      data: {
        organizationId,
        locationId: warehouse.id,
        kind: "WASH",
        quantityKg: 200,
        createdById: "collection-test-warehouse",
        details: { consumed: [{ batchId: opening.id, weightKg: "200" }] },
      },
    });
    const unrelated = await db.collectionAction.create({
      data: {
        organizationId,
        locationId: warehouse.id,
        kind: "WASH",
        quantityKg: 1,
        createdById: owner.id,
        details: {},
      },
    });
    await assert.rejects(
      service.cleanup({ rootTripId: trip.id, dryRun: true }, actor),
      /вне тестовой цепочки/,
    );
    assert.equal(await db.collectionTrip.count({ where: { id: trip.id } }), 1);
    await db.collectionAction.delete({ where: { id: unrelated.id } });
    const preview = await service.cleanup(
      { rootTripId: trip.id, dryRun: true },
      actor,
    );
    assert.ok("plan" in preview);
    assert.equal(
      await db.collectionLocation.count({ where: { id: factory.id } }),
      1,
    );
    await assert.rejects(
      service.cleanup(
        {
          rootTripId: trip.id,
          dryRun: false,
          expectedPlanHash: "0".repeat(64),
        },
        actor,
      ),
      /План изменился/,
    );
    await service.cleanup(
      {
        rootTripId: trip.id,
        dryRun: false,
        expectedPlanHash: preview.planHash,
      },
      actor,
    );
    assert.equal(
      (
        await db.collectionBatch.findUniqueOrThrow({
          where: { id: opening.id },
        })
      ).remainingKg.toString(),
      "1000",
    );
    assert.equal(
      await db.collectionLocation.count({ where: { id: factory.id } }),
      0,
    );
    assert.equal(
      await db.collectionTrip.count({ where: { organizationId } }),
      0,
    );
    assert.equal(
      await db.auditLog.count({
        where: { organizationId, action: "collection.test.cleanup" },
      }),
      1,
    );
  } finally {
    await db.$disconnect();
  }
});
