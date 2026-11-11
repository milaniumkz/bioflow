const test = require("node:test"),
  assert = require("node:assert/strict");
const { createRequire } = require("node:module"),
  { randomUUID } = require("node:crypto");
const backendRequire = createRequire(
  process.cwd() + "/apps/backend/package.json",
);
const {
  repair,
  isSeedRestriction,
} = require("./repair-seeded-warehouse-materials.cjs");
test("correction matches only the exact original warehouse restriction", () => {
  assert.equal(
    isSeedRestriction(
      { name: "Учебная мойка", allowedMaterialTypeIds: ["seed"] },
      "seed",
    ),
    true,
  );
  for (const w of [
    { name: "Другой склад", allowedMaterialTypeIds: ["seed"] },
    { name: "Учебная мойка", allowedMaterialTypeIds: ["other"] },
    { name: "Учебная мойка", allowedMaterialTypeIds: ["seed", "other"] },
    { name: "Учебная мойка", allowedMaterialTypeIds: [] },
  ])
    assert.equal(isSeedRestriction(w, "seed"), false);
});
test("warehouse correction requires an explicit purpose and owner", async () => {
  await assert.rejects(repair({}, {}), /Explicit owner/);
});
test(
  "PostgreSQL correction preserves custom rules and owner and can be repeated",
  { skip: process.env.WORK_ACCOUNTS_INTEGRATION !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL);
    assert(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname.endsWith("_spec"),
    );
    const { PrismaClient } = backendRequire("@prisma/client"),
      p = new PrismaClient();
    const rollback = Error("rollback test fixture");
    try {
      await assert.rejects(
        p.$transaction(
          async (tx) => {
            assert.equal(
              await tx.organization.count({
                where: { id: "collection-role-training-v1" },
              }),
              0,
              "Use an isolated local test database without training fixtures",
            );
            const org = await tx.organization.create({
              data: {
                id: "collection-role-training-v1",
                name: "Warehouse correction test",
              },
            });
            const role = await tx.role.findUniqueOrThrow({
              where: { code: "OWNER" },
            });
            const phone = "+799" + Date.now().toString().slice(-8);
            const owner = await tx.user.create({
              data: {
                organizationId: org.id,
                email: randomUUID() + "@example.test",
                phone,
                fullName: "Тест",
                passwordHash: "unchanged-test-hash",
                userRoles: { create: { roleId: role.id } },
              },
            });
            const material = await tx.materialType.upsert({
              where: { name: "Учебное сырьё Collection" },
              update: {},
              create: { name: "Учебное сырьё Collection" },
            });
            const other = await tx.materialType.create({
              data: { name: "Custom " + randomUUID() },
            });
            const rows = [];
            for (const [name, ids] of [
              ["Учебная мойка", [material.id]],
              ["Учебный завод", [material.id, other.id]],
              ["Свой склад", [material.id]],
              ["Учебный склад готовой продукции", [other.id]],
            ])
              rows.push(
                await tx.warehouse.create({
                  data: {
                    organizationId: org.id,
                    name,
                    allowedMaterialTypeIds: ids,
                  },
                }),
              );
            const adapter = { $transaction: (fn) => fn(tx) },
              r = { purpose: "repair-seed-materials-v1", oldLogin: phone };
            assert.deepEqual(await repair(adapter, r), {
              correctedSeedWarehouseDefaults: 1,
              customWarehouseRulesPreserved: true,
              businessRecordsChanged: false,
            });
            assert.deepEqual(
              (await tx.warehouse.findUnique({ where: { id: rows[0].id } }))
                .allowedMaterialTypeIds,
              [],
            );
            for (const row of rows.slice(1))
              assert.deepEqual(
                await tx.warehouse.findUnique({ where: { id: row.id } }),
                row,
              );
            assert.deepEqual(
              await tx.user.findUnique({ where: { id: owner.id } }),
              owner,
            );
            assert.equal(
              (await repair(adapter, r)).correctedSeedWarehouseDefaults,
              0,
            );
            assert.equal(
              await tx.auditLog.count({
                where: {
                  organizationId: org.id,
                  action: "warehouse.correct-seed-materials",
                },
              }),
              1,
            );
            throw rollback;
          },
          { timeout: 30000 },
        ),
        (e) => e === rollback,
      );
    } finally {
      await p.$disconnect();
    }
  },
);
