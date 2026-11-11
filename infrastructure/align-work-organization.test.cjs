const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID, randomBytes } = require("node:crypto"),
  { createRequire } = require("node:module");
const backendRequire = createRequire(
    process.cwd() + "/apps/backend/package.json",
  ),
  { PrismaClient } = backendRequire("@prisma/client"),
  argon2 = backendRequire("argon2");
const { createAccounts } = require("./provision-work-roles.cjs"),
  {
    inspect,
    align,
    dashboardMatch,
  } = require("./inspect-work-organization.cjs");

test("organization alignment requires a specific old owner and operation", async () => {
  await assert.rejects(
    align({}, { purpose: "reset-owner-password", id: randomUUID() }, "ignored"),
    /Explicit alignment/,
  );
});

test(
  "unused six accounts align to the old owner without moving stocks, replacing credentials or changing either existing owner",
  { skip: process.env.WORK_ACCOUNTS_INTEGRATION !== "1" },
  async () => {
    const db = new URL(process.env.DATABASE_URL);
    assert(
      ["localhost", "127.0.0.1"].includes(db.hostname) &&
        db.pathname.endsWith("_spec"),
    );
    const p = new PrismaClient();
    try {
      const tag = randomUUID().slice(0, 8),
        role = await p.role.findUniqueOrThrow({ where: { code: "OWNER" } }),
        hash = await argon2.hash(randomBytes(18).toString("base64url"));
      const source = await p.organization.create({
          data: { name: "Source organization " + tag },
        }),
        target = await p.organization.create({
          data: { name: "Old owner's actual organization " + tag },
        });
      const bootstrap = await p.user.create({
        data: {
          organizationId: source.id,
          email: `org-source-${tag}@example.test`,
          fullName: "Существующий первоначальный владелец",
          passwordHash: hash,
          userRoles: { create: { roleId: role.id } },
        },
      });
      const old = await p.user.create({
        data: {
          organizationId: target.id,
          email: `org-target-${tag}@example.test`,
          phone:
            "+7997" +
            String(parseInt(tag.slice(0, 5), 16)).padStart(6, "0") +
            "0",
          fullName: "Старый владелец с нужными данными",
          passwordHash: hash,
          userRoles: { create: { roleId: role.id } },
        },
      });
      const sourceWH = await p.warehouse.create({
          data: { organizationId: source.id, name: "Исходный склад" },
        }),
        targetWH = await p.warehouse.create({
          data: { organizationId: target.id, name: "Нужный склад" },
        });
      const targetSite = await p.extractionSite.create({
        data: { organizationId: target.id, name: "Нужный участок" },
      });
      const batch = async (org, creator, wh, quantity) => {
        const b = await p.materialBatch.create({
          data: {
            organizationId: org,
            number: "ORG-" + randomUUID(),
            qrTokenHash: randomBytes(32).toString("hex"),
            state: "DIRTY",
            status: "CONFIRMED",
            initialQuantity: quantity,
            availableSourceQuantity: quantity,
            measurementMethod: "Весы",
            measuredAt: new Date(),
            createdById: creator,
          },
        });
        await p.batchStock.create({
          data: { batchId: b.id, warehouseId: wh, quantity },
        });
        return b;
      };
      const sourceBatch = await batch(source.id, bootstrap.id, sourceWH.id, 2),
        targetBatch = await batch(target.id, old.id, targetWH.id, 3);
      const req = {
        purpose: "create-six-work-accounts-v1",
        id: randomUUID(),
        seed: randomBytes(32).toString("base64url"),
        suffix: "-a" + tag,
      };
      const created = await createAccounts(p, req, bootstrap.email);
      const newOwner = created.accounts.find((a) => a.code === "OWNER");
      await p.user.update({
        where: { id: newOwner.id },
        data: {
          passwordHash: await argon2.hash("user-chosen-password-preserved"),
          mustChangePassword: false,
        },
      });
      const snapshot = async () =>
        p.user.findMany({
          where: { id: { in: created.accounts.map((a) => a.id) } },
          orderBy: { id: "asc" },
          select: {
            id: true,
            email: true,
            phone: true,
            passwordHash: true,
            mustChangePassword: true,
            accessAllObjects: true,
          },
        });
      const credentials = await snapshot(),
        sourceOwnerBefore = await p.user.findUniqueOrThrow({
          where: { id: bootstrap.id },
        }),
        oldBefore = await p.user.findUniqueOrThrow({ where: { id: old.id } });
      const stocks = () =>
          p.batchStock.findMany({
            where: { batchId: { in: [sourceBatch.id, targetBatch.id] } },
            orderBy: { id: "asc" },
          }),
        beforeStocks = await stocks();
      const check = await inspect(p, old.phone, bootstrap.email, req.suffix);
      assert.equal(check.oldAndNewSameOrganization, false);
      assert.equal(check.newAccountsHaveBusinessActivity, false);
      assert.equal(check.newDriverHasAssignments, false);
      assert.equal(
        await dashboardMatch(p, old.phone, bootstrap.email, req.suffix),
        false,
      );
      const operation = {
        purpose: "align-work-org-v1",
        id: randomUUID(),
        oldLogin: old.phone,
        suffix: req.suffix,
      };
      const moved = await align(p, operation, bootstrap.email, { drainMs: 0 });
      assert.equal(moved.alignedAccounts, 6);
      assert.equal(moved.ownerDashboardDataMatches, true);
      assert.deepEqual(await snapshot(), credentials);
      assert.deepEqual(await stocks(), beforeStocks);
      assert.deepEqual(
        await p.user.findUniqueOrThrow({ where: { id: bootstrap.id } }),
        sourceOwnerBefore,
      );
      assert.deepEqual(
        await p.user.findUniqueOrThrow({ where: { id: old.id } }),
        oldBefore,
      );
      const users = await p.user.findMany({
        where: { id: { in: created.accounts.map((a) => a.id) } },
      });
      assert(
        users.every((a) => a.organizationId === target.id && !a.isBlocked),
      );
      const packer = users.find(
        (a) => a.id === created.accounts.find((a) => a.code === "PACKER").id,
      );
      assert.deepEqual(packer.warehouseScopeIds, [targetWH.id]);
      assert(!packer.warehouseScopeIds.includes(sourceWH.id));
      const collector = users.find(
        (a) => a.id === created.accounts.find((a) => a.code === "COLLECTOR").id,
      );
      assert.deepEqual(collector.extractionScopeIds, [targetSite.id]);
      const driver = await p.driver.findUniqueOrThrow({
        where: { userId: created.accounts.find((a) => a.code === "DRIVER").id },
      });
      assert.equal(driver.organizationId, target.id);
      assert.equal(
        (await inspect(p, old.phone, bootstrap.email, req.suffix))
          .oldAndNewSameOrganization,
        true,
      );
      assert.equal(
        (await align(p, operation, bootstrap.email, { drainMs: 0 }))
          .alignedAccounts,
        0,
      );
      const anotherReq = { ...req, id: randomUUID(), suffix: "-b" + tag };
      const second = await createAccounts(p, anotherReq, bootstrap.email);
      await p.auditLog.create({
        data: {
          organizationId: source.id,
          userId: second.accounts[0].id,
          action: "create",
          entity: "warehouses",
          newValue: { name: "Existing work must be reviewed" },
        },
      });
      await assert.rejects(
        align(
          p,
          { ...operation, id: randomUUID(), suffix: anotherReq.suffix },
          bootstrap.email,
          { drainMs: 0 },
        ),
        /dependent activity/,
      );
      assert(
        (
          await p.user.findMany({
            where: { id: { in: second.accounts.map((a) => a.id) } },
          })
        ).every((a) => a.organizationId === source.id && !a.isBlocked),
      );
      assert.deepEqual(await stocks(), beforeStocks);
    } finally {
      await p.$disconnect();
    }
  },
);
