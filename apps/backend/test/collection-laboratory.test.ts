import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import { bootstrapCollection } from "../prisma/bootstrap-collection";
const db = new PrismaClient(),
  api = process.env.COLLECTION_TEST_API ?? "http://127.0.0.1:4198/api/v1",
  key = () => randomUUID();
const intake = {
  sedimentPercent: "3",
  moisturePercent: "35",
  conductivity: "400",
  waterTransparent: true,
  colorCompliant: true,
  packagingCompliant: true,
};
const clean = {
  sedimentPercent: "5",
  moisturePercent: "0.5",
  conductivity: "400",
  waterTransparent: true,
  colorCompliant: true,
  bulkDensity: "450",
};
test("Laboratory: actual collector credit, drying intake net mass / full returns, per-bag GP/reject/redrying, replay and safe reversals", async (t) => {
  if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_spec"))
    throw Error("Isolated database required");
  t.after(() => db.$disconnect());
  process.env.COLLECTION_ORGANIZATION_ID = "lab-spec-" + key();
  const org = await bootstrapCollection(db);
  const sites = await db.collectionLocation.findMany({
      where: { organizationId: org.id },
    }),
    warehouse = sites.find((s) => s.code === "HELIOS")!,
    other = sites.find((s) => s.code === "ZHANA_AUL")!,
    factory = sites.find((s) => s.code === "FACTORY-SEZ")!;
  async function actor(code: string, siteId?: string) {
    const role = await db.role.findUniqueOrThrow({ where: { code } }),
      user = await db.user.create({
        data: {
          organizationId: org.id,
          fullName: "Laboratory spec " + code,
          passwordHash: "not-a-login",
          userRoles: { create: { roleId: role.id } },
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
    collector = await actor("COLLECTOR"),
    manager = await actor("WAREHOUSE_MANAGER", warehouse.id),
    outsider = await actor("WAREHOUSE_MANAGER", other.id),
    factoryManager = await actor("FACTORY_MANAGER", factory.id);
  async function req(
    path: string,
    token: string,
    status: number,
    body?: unknown,
  ) {
    const r = await fetch(api + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      v = await r.json();
    assert.equal(r.status, status, path + " " + JSON.stringify(v));
    return v;
  }
  const trip = await req("/collection/trips", collector.token, 201, {
    idempotencyKey: key(),
    warehouseId: warehouse.id,
    weightKg: "20000",
    bagCount: 40,
  });
  await req(`/collection/admin/trips/${trip.id}/stage`, owner.token, 201, {
    idempotencyKey: key(),
    reason: "Локальная проверка лаборатории",
    status: "ARRIVED",
  });
  const raw = {
    idempotencyKey: key(),
    sedimentPercent: "6",
    moisturePercent: "37",
    colorPercent: "41",
  };
  await req(`/collection/trips/${trip.id}/confirm`, manager.token, 400, {
    idempotencyKey: key(),
  });
  await req(`/collection/trips/${trip.id}/confirm`, outsider.token, 403, raw);
  await req(`/collection/trips/${trip.id}/confirm`, manager.token, 400, {
    ...raw,
    sedimentPercent: "101",
  });
  const accepted = await req(
    `/collection/trips/${trip.id}/confirm`,
    manager.token,
    201,
    raw,
  );
  assert.equal(accepted.acceptedWeightKg, "19000");
  assert.equal(accepted.totalDeductionPercent, "5");
  await req(`/collection/trips/${trip.id}/confirm`, manager.token, 201, raw);
  await req(`/collection/trips/${trip.id}/confirm`, manager.token, 409, {
    ...raw,
    idempotencyKey: key(),
  });
  const saved = await db.collectionTrip.findUniqueOrThrow({
    where: { id: trip.id },
  });
  assert.equal(saved.weightKg.toString(), "20000");
  assert.equal(saved.acceptedWeightKg!.toString(), "19000");
  const receipt = await db.collectionBatch.findFirstOrThrow({
    where: { sourceType: "TRIP", sourceId: trip.id },
  });
  assert.equal(receipt.remainingKg.toString(), "19000");
  assert.equal(receipt.totalKg.toString(), "19000");
  let own = await req("/collection/state", collector.token, 200);
  assert.equal(own.totals.acceptedWeightKg, "19000");
  assert.equal(own.trips[0].laboratory.sedimentPercent, "6");
  assert.equal(own.trips[0].laboratory.moisturePercent, "37");
  assert.equal(own.trips[0].laboratory.colorPercent, "41");
  assert.equal(own.trips[0].weightKg, "20000");
  const notice = await db.notification.findFirstOrThrow({
    where: { userId: collector.id, type: "COLLECTION_RAW_ACCEPTED" },
  });
  assert.match(notice.body, /20 т/);
  assert.match(notice.body, /19 т/);
  await req("/collection/wash", manager.token, 201, {
    idempotencyKey: key(),
    locationId: warehouse.id,
    weightKg: "19000",
  });
  async function shipment(weightKg = "2000") {
    return req("/collection/shipments", manager.token, 201, {
      idempotencyKey: key(),
      locationId: warehouse.id,
      factoryId: factory.id,
      weightKg,
      bagCount: 4,
    });
  }
  const sent = await shipment();
  await req(
    `/collection/shipments/${sent.id}/confirm`,
    factoryManager.token,
    400,
    { idempotencyKey: key() },
  );
  const checked = await req(
    `/collection/shipments/${sent.id}/confirm`,
    factoryManager.token,
    201,
    {
      idempotencyKey: key(),
      ...intake,
      sedimentPercent: "4",
      moisturePercent: "38",
    },
  );
  assert.equal(checked.acceptedWeightKg, "1900");
  const bag = (weightKg: string, laboratory = clean) => ({
    weightKg,
    laboratory,
  });
  await req("/collection/production", factoryManager.token, 400, {
    idempotencyKey: key(),
    locationId: factory.id,
    bags: [{ weightKg: "500" }],
  });
  await req("/collection/production", factoryManager.token, 400, {
    idempotencyKey: key(),
    locationId: factory.id,
    bags: [bag("800")],
  });
  const outputBody = {
    idempotencyKey: key(),
    locationId: factory.id,
    bags: [
      bag("500"),
      bag("525", { ...clean, sedimentPercent: "6" }),
      bag("500", { ...clean, moisturePercent: "0.51" }),
    ],
  };
  const output = await req(
    "/collection/production",
    factoryManager.token,
    201,
    outputBody,
  );
  await req("/collection/production", factoryManager.token, 201, outputBody);
  assert.equal(output.finishedKg, "500");
  assert.equal(output.rejectedKg, "525");
  assert.equal(output.redryKg, "500");
  assert.equal(output.consumedKg, "1525");
  const outputs = await db.collectionBatch.findMany({
    where: { sourceId: output.id },
    include: { bags: true },
  });
  const redry = outputs.find((b) => b.state === "REDRY")!,
    rejected = outputs.find((b) => b.state === "REJECT")!;
  assert.equal((rejected.bags[0].laboratory as any).sedimentPercent, "6");
  assert.equal((redry.bags[0].laboratory as any).moisturePercent, "0.51");
  // Neither reject nor repeat-drying bags can be dispatched as finished product.
  for (const invalid of [redry.bags[0].id, rejected.bags[0].id]) {
    const r = await fetch(api + "/collection/gp-trips", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + factoryManager.token,
      },
      body: JSON.stringify({
        idempotencyKey: key(),
        locationId: factory.id,
        recipientName: "Spec",
        recipientAddress: "Spec address",
        bagIds: [invalid],
      }),
    });
    assert(!r.ok);
  }
  const repeatedBody = {
    idempotencyKey: key(),
    locationId: factory.id,
    redryBatchId: redry.id,
    bags: [{ ...bag("500"), redryBagId: redry.bags[0].id }],
  };
  const repeated = await req(
    "/collection/production",
    factoryManager.token,
    201,
    repeatedBody,
  );
  assert.equal(repeated.finishedKg, "500");
  assert.equal(
    (
      await db.collectionBag.findUniqueOrThrow({
        where: { id: redry.bags[0].id },
      })
    ).status,
    "REDRIED",
  );
  await req("/collection/production", factoryManager.token, 409, {
    ...repeatedBody,
    idempotencyKey: key(),
  });
  await req(
    `/collection/admin/operations/${repeated.id}/reverse`,
    owner.token,
    201,
    {
      idempotencyKey: key(),
      reason: "Проверка возврата бигбега на повторную сушку",
    },
  );
  assert.equal(
    (
      await db.collectionBag.findUniqueOrThrow({
        where: { id: redry.bags[0].id },
      })
    ).status,
    "AVAILABLE",
  );
  assert.equal(
    (
      await db.collectionBatch.findUniqueOrThrow({ where: { id: redry.id } })
    ).remainingKg.toString(),
    "500",
  );
  // Every failed yes/no check and conductivity above 400 returns gross mass to the original wash.
  for (const fail of [
    { conductivity: "400.001" },
    { waterTransparent: false },
    { colorCompliant: false },
    { packagingCompliant: false },
  ]) {
    const s = await shipment("1000"),
      body = {
        idempotencyKey: key(),
        ...intake,
        ...fail,
        sedimentPercent: "4",
        moisturePercent: "38",
      };
    const r = await req(
      `/collection/shipments/${s.id}/confirm`,
      factoryManager.token,
      201,
      body,
    );
    assert.equal(r.disposition, "REWORK");
    assert.equal(r.returnedWeightKg, "1000");
    assert.equal(r.acceptedWeightKg, "0");
    await req(
      `/collection/shipments/${s.id}/confirm`,
      factoryManager.token,
      201,
      body,
    );
    const returned = await db.collectionBatch.findFirstOrThrow({
      where: { sourceType: "SHIPMENT_REWORK", sourceId: s.id },
    });
    assert.equal(returned.locationId, warehouse.id);
    assert.equal(returned.state, "RAW");
    assert.equal(returned.remainingKg.toString(), "1000");
    assert.equal(
      await db.collectionBatch.count({
        where: { sourceType: "SHIPMENT", sourceId: s.id },
      }),
      0,
    );
    if (fail.packagingCompliant === false) {
      const washed = await req("/collection/wash", manager.token, 201, {
        idempotencyKey: key(),
        locationId: warehouse.id,
        weightKg: "4000",
      });
      await req(
        `/collection/admin/shipments/${s.id}/cancel`,
        owner.token,
        409,
        {
          idempotencyKey: key(),
          reason: "Нельзя удваивать использованный возврат",
        },
      );
      await req(
        `/collection/admin/operations/${washed.id}/reverse`,
        owner.token,
        201,
        { idempotencyKey: key(), reason: "Возврат исходного остатка" },
      );
      await req(
        `/collection/admin/shipments/${s.id}/cancel`,
        owner.token,
        201,
        {
          idempotencyKey: key(),
          reason: "Проверка отмены возвращённой отправки",
        },
      );
      assert.equal(
        (
          await db.collectionBatch.findUniqueOrThrow({
            where: { id: returned.id },
          })
        ).status,
        "CANCELLED",
      );
    }
  }
  const correction = {
    idempotencyKey: key(),
    expectedWeightKg: "20000",
    weightKg: "21000",
    reason: "Исправление веса с сохранением лабораторных вычетов",
  };
  await req(
    `/collection/trips/${trip.id}/weight`,
    owner.token,
    201,
    correction,
  );
  const corrected = await db.collectionTrip.findUniqueOrThrow({
    where: { id: trip.id },
  });
  assert.equal(corrected.acceptedWeightKg!.toString(), "19950");
  assert.equal(
    (
      await db.collectionBatch.findUniqueOrThrow({ where: { id: receipt.id } })
    ).totalKg.toString(),
    "19950",
  );
  await req(`/collection/trips/${trip.id}/weight`, owner.token, 409, {
    ...correction,
    idempotencyKey: key(),
    expectedWeightKg: "21000",
    weightKg: "19000",
  });
  own = await req("/collection/state", collector.token, 200);
  assert.equal(own.totals.acceptedWeightKg, "19950");
  assert.equal(own.trips[0].laboratory.acceptedWeightKg, "19950");
  for (const type of [
    "COLLECTION_RAW_ACCEPTED",
    "COLLECTION_FACTORY_ACCEPTED",
    "COLLECTION_FACTORY_REWORK",
    "COLLECTION_PRODUCTION",
  ])
    assert(
      (await db.notification.count({
        where: { organizationId: org.id, userId: owner.id, type },
      })) > 0,
    );
});
