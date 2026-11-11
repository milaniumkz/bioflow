// Correct only the exact restrictive defaults installed by the training provisioner.
// Explicit owner selection; no stock, batch, credential or document changes.
const { createRequire } = require("node:module");
const backendRequire = createRequire(
  process.cwd() + "/apps/backend/package.json",
);
const names = [
  "Учебная мойка",
  "Учебный завод",
  "Учебный склад готовой продукции",
];
function isSeedRestriction(warehouse, materialId) {
  return (
    names.includes(warehouse.name) &&
    warehouse.allowedMaterialTypeIds.length === 1 &&
    warehouse.allowedMaterialTypeIds[0] === materialId
  );
}
async function repair(prisma, request) {
  if (
    request?.purpose !== "repair-seed-materials-v1" ||
    !/^\+\d{10,15}$/.test(request.oldLogin || "")
  )
    throw Error("Explicit owner request required");
  return prisma.$transaction(
    async (tx) => {
      const owner = await tx.user.findUnique({
        where: { phone: request.oldLogin },
        include: { userRoles: { include: { role: true } } },
      });
      if (
        !owner ||
        owner.isBlocked ||
        owner.organizationId !== "collection-role-training-v1" ||
        !owner.userRoles.some((r) => r.role.code === "OWNER")
      )
        throw Error("Seed organization owner required");
      const material = await tx.materialType.findUnique({
        where: { name: "Учебное сырьё Collection" },
      });
      if (!material) throw Error("Original seed material missing");
      const warehouses = await tx.warehouse.findMany({
        where: { organizationId: owner.organizationId, archivedAt: null },
      });
      let corrected = 0;
      for (const warehouse of warehouses.filter((w) =>
        isSeedRestriction(w, material.id),
      )) {
        await tx.warehouse.update({
          where: { id: warehouse.id },
          data: { allowedMaterialTypeIds: [] },
        });
        await tx.auditLog.create({
          data: {
            organizationId: owner.organizationId,
            userId: owner.id,
            action: "warehouse.correct-seed-materials",
            entity: "Warehouse",
            entityId: warehouse.id,
            oldValue: {
              allowedMaterialTypeIds: warehouse.allowedMaterialTypeIds,
            },
            newValue: { allowedMaterialTypeIds: [] },
            reason:
              "Remove single training-material default blocking the owner's chosen materials; preserve business records",
          },
        });
        corrected++;
      }
      const after = await tx.warehouse.findMany({
        where: { organizationId: owner.organizationId, archivedAt: null },
      });
      if (after.some((w) => isSeedRestriction(w, material.id)))
        throw Error("Seed restriction correction failed");
      return {
        correctedSeedWarehouseDefaults: corrected,
        customWarehouseRulesPreserved: true,
        businessRecordsChanged: false,
      };
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );
}
module.exports = { repair, isSeedRestriction };
if (process.env.COLLECTION_SEED_MATERIAL_REPAIR_JSON) {
  const { PrismaClient } = backendRequire("@prisma/client"),
    prisma = new PrismaClient();
  const raw = process.env.COLLECTION_SEED_MATERIAL_REPAIR_JSON;
  delete process.env.COLLECTION_SEED_MATERIAL_REPAIR_JSON;
  Promise.resolve()
    .then(() => repair(prisma, JSON.parse(raw)))
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        "Seed material correction rejected; review protected operation without logging private data",
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
