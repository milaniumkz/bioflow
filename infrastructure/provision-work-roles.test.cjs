const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const backendRequire = createRequire(
  process.cwd() + "/apps/backend/package.json",
);
const { PrismaClient } = backendRequire("@prisma/client"),
  argon2 = backendRequire("argon2");
const {
  createAccounts,
  credentials,
  verifyAccounts,
} = require("./provision-work-roles.cjs");

test("work-account credentials require an explicit purpose and are stable per encrypted batch", () => {
  const request = {
    purpose: "create-six-work-accounts-v1",
    id: randomUUID(),
    seed: randomBytes(32).toString("base64url"),
  };
  const first = credentials(request);
  assert.equal(first.length, 6);
  assert.equal(new Set(first.map((a) => a.password)).size, 6);
  assert.deepEqual(credentials(request), first);
  assert(first.every((a) => a.password.length >= 16));
  assert.throws(() =>
    credentials({ ...request, purpose: "reset-owner-password" }),
  );
  assert.throws(() => credentials({ ...request, suffix: "@another.example" }));
});

test(
  "six real working sign-ins preserve existing users and balances; replay never resets passwords",
  { skip: process.env.WORK_ACCOUNTS_INTEGRATION !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL);
    assert(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname.endsWith("_spec"),
      "Dedicated local *_spec database required",
    );
    const prisma = new PrismaClient();
    try {
      const tag = randomUUID().slice(0, 8),
        org = await prisma.organization.create({
          data: { name: "Work role account test " + tag },
        });
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: "OWNER" },
      });
      const owner = await prisma.user.create({
        data: {
          organizationId: org.id,
          email: `account-spec-owner-${tag}@example.test`,
          fullName: "Существующий владелец",
          passwordHash: await argon2.hash(
            randomBytes(20).toString("base64url"),
          ),
          userRoles: { create: { roleId: role.id } },
        },
      });
      await prisma.warehouse.create({
        data: { organizationId: org.id, name: "Рабочий склад" },
      });
      await prisma.extractionSite.create({
        data: { organizationId: org.id, name: "Рабочий участок" },
      });
      const before = await prisma.user.findUniqueOrThrow({
        where: { id: owner.id },
      });
      const snapshot = async () =>
        JSON.stringify(
          await prisma.batchStock.findMany({ orderBy: { id: "asc" } }),
        );
      const stock = await snapshot();
      const request = {
        purpose: "create-six-work-accounts-v1",
        id: randomUUID(),
        seed: randomBytes(32).toString("base64url"),
        suffix: "-t" + tag,
      };
      const result = await createAccounts(prisma, request, owner.email);
      assert.equal(result.created, 6);
      assert.equal(result.organizationId, org.id);
      assert.deepEqual(
        await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }),
        before,
      );
      assert.equal(await snapshot(), stock);
      assert.equal(
        await prisma.user.count({ where: { organizationId: org.id } }),
        7,
      );
      const packer = result.accounts.find((a) => a.code === "PACKER"),
        driver = result.accounts.find((a) => a.code === "DRIVER");
      assert.equal(
        (await prisma.user.findUniqueOrThrow({ where: { id: packer.id } }))
          .accessAllObjects,
        false,
      );
      assert.equal(
        (await prisma.user.findUniqueOrThrow({ where: { id: packer.id } }))
          .warehouseScopeIds.length,
        1,
      );
      assert(await prisma.driver.findUnique({ where: { userId: driver.id } }));
      const passwordsBefore = await prisma.user.findMany({
        where: { organizationId: org.id },
        orderBy: { id: "asc" },
        select: { id: true, passwordHash: true },
      });
      const replay = await createAccounts(prisma, request, owner.email);
      assert.equal(replay.created, 0);
      assert.deepEqual(replay.accounts, result.accounts);
      assert.deepEqual(
        await prisma.user.findMany({
          where: { organizationId: org.id },
          orderBy: { id: "asc" },
          select: { id: true, passwordHash: true },
        }),
        passwordsBefore,
      );
      await assert.rejects(
        createAccounts(prisma, { ...request, id: randomUUID() }, owner.email),
        /collision/,
      );
      await assert.rejects(
        createAccounts(
          prisma,
          { ...request, seed: randomBytes(32).toString("base64url") },
          owner.email,
        ),
        /replay/,
      );
      assert.equal(
        await prisma.user.count({ where: { organizationId: org.id } }),
        7,
      );
      if (process.env.WORK_ACCOUNTS_VERIFY_API)
        await verifyAccounts(
          prisma,
          request,
          result,
          process.env.WORK_ACCOUNTS_VERIFY_API,
        );
      const entry = credentials(request)[0];
      const user = result.accounts.find((a) => a.code === entry.code);
      await prisma.user.update({
        where: { id: user.id },
        data: { mustChangePassword: false },
      });
      await assert.rejects(
        createAccounts(prisma, request, owner.email),
        /Existing account changed/,
      );
      assert.equal(await snapshot(), stock);
    } finally {
      await prisma.$disconnect();
    }
  },
);
