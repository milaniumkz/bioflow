import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import { bootstrapCollection } from "../prisma/bootstrap-collection";
const db = new PrismaClient();
const api = process.env.COLLECTION_TEST_API ?? "http://127.0.0.1:4198/api/v1";
test("Factory opening: scoped once per site, atomic parallel saves, replay, exact tonnes, usable bags and owner notices", async (t) => {
  if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_spec"))
    throw Error("Isolated database required");
  t.after(() => db.$disconnect());
  process.env.COLLECTION_ORGANIZATION_ID = "opening-spec-" + randomUUID();
  const org = await bootstrapCollection(db);
  const sites = await db.collectionLocation.findMany({
    where: { organizationId: org.id },
  });
  const factory = sites.find((s) => s.code === "FACTORY-SEZ")!,
    other = sites.find((s) => s.code === "FACTORY-ZHANA_AUL")!,
    warehouse = sites.find((s) => s.code === "HELIOS")!;
  async function actor(role: string, siteId?: string) {
    const r = await db.role.findUniqueOrThrow({ where: { code: role } });
    const user = await db.user.create({
      data: {
        organizationId: org.id,
        fullName: "Opening spec",
        passwordHash: "not-a-login",
        userRoles: { create: { roleId: r.id } },
      },
    });
    if (siteId)
      await db.collectionMembership.create({
        data: { userId: user.id, locationId: siteId },
      });
    return {
      id: user.id,
      token: await new JwtService().signAsync(
        { sub: user.id },
        { secret: process.env.JWT_ACCESS_SECRET ?? "dev-access" },
      ),
    };
  }
  const owner = await actor("OWNER"),
    manager = await actor("FACTORY_MANAGER", factory.id),
    second = await actor("FACTORY_MANAGER", factory.id),
    outsider = await actor("FACTORY_MANAGER", other.id),
    collector = await actor("COLLECTOR");
  async function req(path: string, token: string, body?: unknown) {
    const r = await fetch(api + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  }
  const payload = {
    idempotencyKey: randomUUID(),
    locationId: factory.id,
    washedKg: "12345.678",
    finished: [{ weightKg: "800" }, { weightKg: "825" }],
    rejected: [{ weightKg: "250.123" }],
  };
  assert.equal(
    (await req("/collection/factory-opening", outsider.token, payload)).status,
    403,
  );
  assert.equal(
    (await req("/collection/factory-opening", collector.token, payload)).status,
    403,
  );
  assert.equal(
    (
      await req("/collection/factory-opening", manager.token, {
        ...payload,
        locationId: warehouse.id,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await req("/collection/factory-opening", manager.token, {
        ...payload,
        washedKg: "-1",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await req("/collection/factory-opening", manager.token, {
        ...payload,
        rejected: [{ weightKg: "0" }],
      })
    ).status,
    400,
  );
  const parallel = await Promise.all([
    req("/collection/factory-opening", manager.token, payload),
    req("/collection/factory-opening", second.token, {
      ...payload,
      idempotencyKey: randomUUID(),
    }),
  ]);
  assert.deepEqual(parallel.map((v) => v.status).sort(), [201, 409]);
  const result = parallel.find((v) => v.status === 201)!.data;
  if (parallel[0].status === 201) {
    const replay = await req(
      "/collection/factory-opening",
      manager.token,
      payload,
    );
    assert.equal(replay.status, 201);
    assert.equal(replay.data.id, result.id);
  }
  assert.equal(
    await db.collectionAction.count({
      where: { organizationId: org.id, kind: "OPENING" },
    }),
    1,
  );
  const batches = await db.collectionBatch.findMany({
    where: { organizationId: org.id, locationId: factory.id },
    include: { bags: true },
  });
  assert.equal(
    batches.find((b) => b.state === "WASHED")!.remainingKg.toString(),
    "12345.678",
  );
  assert.equal(
    batches.find((b) => b.state === "FINISHED")!.remainingKg.toString(),
    "1625",
  );
  assert.equal(
    batches.find((b) => b.state === "REJECT")!.remainingKg.toString(),
    "250.123",
  );
  const bags = batches.find((b) => b.state === "FINISHED")!.bags;
  assert.deepEqual(bags.map((b) => b.weightKg.toString()).sort(), [
    "800",
    "825",
  ]);
  const state = await req("/collection/state", manager.token);
  assert.equal(state.status, 200);
  assert.equal(state.data.factoryOpenings.length, 1);
  assert.equal(state.data.factoryOpenings[0].locationId, factory.id);
  assert.equal(
    (await req("/collection/state", outsider.token)).data.factoryOpenings
      .length,
    0,
  );
  assert.equal(
    await db.auditLog.count({
      where: { organizationId: org.id, action: "collection.factory.opening" },
    }),
    1,
  );
  assert.equal(
    await db.notification.count({
      where: {
        organizationId: org.id,
        userId: owner.id,
        type: "COLLECTION_OPENING",
      },
    }),
    1,
  );
  const trip = await req("/collection/gp-trips", manager.token, {
    idempotencyKey: randomUUID(),
    locationId: factory.id,
    recipientName: "Spec recipient",
    recipientAddress: "Spec destination",
    bagIds: bags.map((b) => b.id),
  });
  assert.equal(trip.status, 201);
  assert.equal(
    (
      await req("/collection/factory-opening", manager.token, {
        ...payload,
        idempotencyKey: randomUUID(),
      })
    ).status,
    409,
  );
  const zero = {
    idempotencyKey: randomUUID(),
    locationId: other.id,
    washedKg: "0",
    finished: [],
    rejected: [],
  };
  assert.equal(
    (await req("/collection/factory-opening", outsider.token, zero)).status,
    201,
  );
  assert.equal(
    (
      await req("/collection/factory-opening", outsider.token, {
        ...zero,
        idempotencyKey: randomUUID(),
      })
    ).status,
    409,
  );
});
