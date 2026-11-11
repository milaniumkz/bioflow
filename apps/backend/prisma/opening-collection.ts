import { Prisma, PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { assertCollectionDatabase } from "./collection-database";
export type OpeningInput = {
  effectiveDate: string;
  balances: {
    warehouseCode: string;
    state: "RAW" | "WASHED";
    tonnes: string;
  }[];
};
export async function applyOpeningBalances(
  db: PrismaClient,
  input?: OpeningInput,
) {
  assertCollectionDatabase();
  const source: OpeningInput =
    input ??
    JSON.parse(
      readFileSync(
        process.env.COLLECTION_OPENING_FILE ??
          "/run/collection-secrets/opening-balances.json",
        "utf8",
      ),
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(source.effectiveDate) ||
    !Array.isArray(source.balances)
  )
    throw new Error("Invalid opening balance input");
  const organizationId =
    process.env.COLLECTION_ORGANIZATION_ID ?? "collection-live";
  for (const row of source.balances) {
    if (
      !/^[A-Z0-9_]{1,64}$/.test(row.warehouseCode) ||
      !["RAW", "WASHED"].includes(row.state) ||
      !/^\d{1,10}(\.\d{1,6})?$/.test(row.tonnes)
    )
      throw new Error("Invalid opening balance row");
    const weightKg = new Prisma.Decimal(row.tonnes).mul(1000);
    if (weightKg.isZero()) continue;
    await db.$transaction(async (tx) => {
      const location = await tx.collectionLocation.findUniqueOrThrow({
        where: {
          organizationId_code: { organizationId, code: row.warehouseCode },
        },
      });
      await tx.$queryRaw`SELECT id FROM "CollectionLocation" WHERE id = ${location.id} FOR UPDATE`;
      const sourceId = `opening:${source.effectiveDate}:${row.warehouseCode}:${row.state}`;
      const existing = await tx.collectionBatch.findUnique({
        where: {
          organizationId_sourceType_sourceId_state: {
            organizationId,
            sourceType: "OPENING",
            sourceId,
            state: row.state,
          },
        },
      });
      if (existing) {
        if (!existing.totalKg.equals(weightKg))
          throw new Error(
            "Opening balance already exists with a different amount; use a reviewed inventory correction",
          );
        return; // Never reset remainingKg after later movements.
      }
      const batch = await tx.collectionBatch.create({
        data: {
          organizationId,
          locationId: location.id,
          state: row.state,
          totalKg: weightKg,
          remainingKg: weightKg,
          sourceType: "OPENING",
          sourceId,
          createdById: "SYSTEM_OPENING",
        },
      });
      await tx.collectionAction.create({
        data: {
          organizationId,
          locationId: location.id,
          kind: "OPENING",
          quantityKg: weightKg,
          createdById: "SYSTEM_OPENING",
          details: {
            batchId: batch.id,
            state: row.state,
            source: "User-supplied opening inventory",
            effectiveDate: source.effectiveDate,
          },
        },
      });
    });
  }
}
if (require.main === module) {
  const db = new PrismaClient();
  applyOpeningBalances(db)
    .then(() =>
      console.log(
        "Private opening inventory applied idempotently; no user accounts created",
      ),
    )
    .finally(() => db.$disconnect());
}
