const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const source = readFileSync(
  join(__dirname, "create-collection-owner.cjs"),
  "utf8",
);
const request = {
  review: "apple-deletion",
  email: "apple-deletion-review@collection.invalid",
  password: "a".repeat(48),
};

async function provision(input, options = {}) {
  const created = [],
    memberships = [],
    logs = [],
    organizationCreates = [],
    roleQueries = [];
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  const warehouse = {
    id: "review-site",
    organizationId: "collection-apple-app-review",
    code: "REVIEW-WAREHOUSE",
    kind: "WAREHOUSE",
    active: !options.inactive,
  };
  const tx = {
    organization: {
      create: async ({ data }) => {
        organizationCreates.push(data);
        return data;
      },
    },
    collectionLocation: {
      findUniqueOrThrow: async ({ where }) => {
        assert.deepEqual(JSON.parse(JSON.stringify(where)), {
          organizationId_code: {
            organizationId: "collection-apple-app-review",
            code: "REVIEW-WAREHOUSE",
          },
        });
        return warehouse;
      },
      create: async () => warehouse,
    },
    role: {
      findUniqueOrThrow: async ({ where }) => {
        roleQueries.push(where.code);
        return { id: "warehouse-role" };
      },
    },
    user: {
      create: async ({ data }) => {
        if (options.duplicate) throw Error("existing account");
        created.push(data);
        return { id: "disposable-user" };
      },
    },
    collectionMembership: {
      create: async ({ data }) => {
        memberships.push(data);
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const db = {
    $transaction: async (operation) => operation(tx),
    $disconnect: async () => finish(),
  };
  const process = {
    env: {
      COLLECTION_ENABLED: "true",
      DATABASE_URL: "postgresql://localhost/collection_live",
      COLLECTION_ORGANIZATION_ID: options.foreign ? "other" : "collection-live",
    },
  };
  const backendRequire = (name) =>
    name === "@prisma/client"
      ? {
          PrismaClient: class {
            constructor() {
              return db;
            }
          },
        }
      : { hash: async () => "spec-hash", argon2id: 2 };
  runInNewContext(source, {
    require: (name) =>
      name === "node:fs"
        ? { readFileSync: () => JSON.stringify(input) }
        : name === "node:module"
          ? { createRequire: () => backendRequire }
          : require(name),
    process,
    URL,
    AbortSignal,
    console: {
      log: (...args) => logs.push(args.join(" ")),
      error: (...args) => logs.push(args.join(" ")),
    },
    fetch: async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith("/auth/login")
          ? { accessToken: "spec-only" }
          : url.endsWith("/auth/me")
            ? { roles: ["WAREHOUSE_MANAGER"] }
            : { locations: [warehouse] },
    }),
  });
  await done;
  return {
    created,
    memberships,
    logs,
    organizationCreates,
    roleQueries,
    exitCode: process.exitCode,
  };
}

test("deletion reviewer is confined to the existing Apple review warehouse", async () => {
  const result = await provision(request);
  assert.equal(result.exitCode, undefined);
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].organizationId, "collection-apple-app-review");
  assert.equal(result.created[0].email, request.email);
  assert.equal(result.created[0].accessAllObjects, false);
  assert.equal(result.created[0].fullName, "Apple Deletion Reviewer");
  assert.equal(result.organizationCreates.length, 0);
  assert.deepEqual(result.roleQueries, ["WAREHOUSE_MANAGER"]);
  assert.equal(result.memberships[0].locationId, "review-site");
  assert.ok(
    result.logs.every((message) => !message.includes(request.password)),
  );
});
for (const [name, input, options] of [
  ["foreign email", { ...request, email: "someone@example.invalid" }, {}],
  ["short password", { ...request, password: "short" }, {}],
  ["inactive warehouse", request, { inactive: true }],
  ["duplicate account", request, { duplicate: true }],
  ["foreign environment", request, { foreign: true }],
])
  test(`provisioning refuses ${name} without overwriting accounts`, async () => {
    const result = await provision(input, options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.created.length, 0);
    assert.equal(result.organizationCreates.length, 0);
  });
test("the original Apple reviewer setup still creates its isolated organization", async () => {
  const result = await provision({
    ...request,
    review: "apple",
    email: "apple-app-review@collection.invalid",
  });
  assert.equal(result.exitCode, undefined);
  assert.equal(result.organizationCreates.length, 1);
  assert.equal(result.created[0].fullName, "Apple App Reviewer");
});
