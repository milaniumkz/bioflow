import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { writeFileSync } from "node:fs";
import { bootstrapCollection } from "../prisma/bootstrap-collection";
import { applyOpeningBalances } from "../prisma/opening-collection";
import {
  CollectionService,
  assertCollectionDatabase,
} from "../src/collection/collection.service";
import { CollectionDriverService } from "../src/collection/collection-driver.service";
const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).pathname.endsWith("_spec"))
  throw Error("Collection tests require a separate *_spec database");
const db = new PrismaClient();
const api = process.env.COLLECTION_TEST_API ?? "http://127.0.0.1:4198/api/v1";
const key = () => randomUUID();
async function request(
  path: string,
  expected: number,
  body?: unknown,
  token?: string,
) {
  const response = await fetch(api + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
test("Collection: separate database, all roles, full material/GP delivery flow, notices and stock safety", async (t) => {
  t.after(() => db.$disconnect());
  const run = key();
  process.env.COLLECTION_ORGANIZATION_ID = "collection-spec-" + run;
  const org = await bootstrapCollection(db);
  const again = await bootstrapCollection(db);
  assert.equal(org.id, again.id);
  assert.equal(
    await db.user.count({ where: { organizationId: org.id } }),
    0,
    "Bootstrap must not create user accounts",
  );
  const openingInput = {
    effectiveDate: "2026-11-11",
    balances: [
      { warehouseCode: "HELIOS", state: "RAW" as const, tonnes: "2" },
      { warehouseCode: "ZHANA_AUL", state: "RAW" as const, tonnes: "3" },
      { warehouseCode: "EKIBASTUZ", state: "RAW" as const, tonnes: "1" },
      { warehouseCode: "EKIBASTUZ", state: "WASHED" as const, tonnes: "1.5" },
      { warehouseCode: "TEC3", state: "RAW" as const, tonnes: "1.25" },
    ],
  };
  await applyOpeningBalances(db, openingInput);
  await applyOpeningBalances(db, openingInput);
  const locations = await db.collectionLocation.findMany({
    where: { organizationId: org.id },
  });
  assert.equal(locations.length, 4);
  const helios = locations.find((l) => l.code === "HELIOS")!;
  const zhana = locations.find((l) => l.code === "ZHANA_AUL")!;
  const opening = await db.collectionBatch.groupBy({
    by: ["state"],
    where: { organizationId: org.id },
    _sum: { remainingKg: true },
  });
  assert.equal(
    opening.find((row) => row.state === "RAW")?._sum.remainingKg?.toString(),
    "7250",
  );
  assert.equal(
    opening.find((row) => row.state === "WASHED")?._sum.remainingKg?.toString(),
    "1500",
  );
  const password = "CollectionSpec2026!";
  const passwordHash = await argon2.hash(password);
  async function actor(
    roleCode: string,
    name: string,
    organizationId = org.id,
    siteId?: string,
  ) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await db.user.create({
      data: {
        organizationId,
        fullName: name,
        email: `${key()}@collection.test`,
        passwordHash,
        userRoles: { create: { roleId: role.id } },
      },
    });
    if (siteId)
      await db.collectionMembership.create({
        data: { userId: user.id, locationId: siteId },
      });
    const token = await new JwtService().signAsync(
      { sub: user.id },
      {
        secret: process.env.JWT_ACCESS_SECRET ?? "dev-access",
        expiresIn: "1h",
      },
    );
    return { ...user, token, password };
  }
  const owner = await actor("OWNER", "Spec owner");
  const collector = await actor("COLLECTOR", "Spec collector");
  const secondCollector = await actor("COLLECTOR", "Other spec collector");
  const loginPhone = "+7" + Date.now().toString().slice(-10);
  await db.user.update({
    where: { id: collector.id },
    data: { phone: loginPhone },
  });
  const phoneLogin = await request("/auth/login", 201, {
    phone: loginPhone,
    password,
  });
  assert.equal(
    (await request("/auth/me", 200, undefined, phoneLogin.accessToken)).id,
    collector.id,
  );
  const warehouse = await actor(
    "WAREHOUSE_MANAGER",
    "Helios manager",
    org.id,
    helios.id,
  );
  const otherWarehouse = await actor(
    "WAREHOUSE_MANAGER",
    "Zhana manager",
    org.id,
    zhana.id,
  );
  const otherOrg = await db.organization.create({
    data: { name: "Other organization" },
  });
  const outsider = await actor("OWNER", "Other owner", otherOrg.id);
  await db.device.create({
    data: {
      userId: owner.id,
      platform: "android",
      pushToken: "spec-device-not-real",
    },
  });
  const factory = await request(
    "/collection/factories",
    201,
    { idempotencyKey: key(), name: "Spec factory" },
    owner.token,
  );
  const secondFactory = await request(
    "/collection/factories",
    201,
    { idempotencyKey: key(), name: "Other spec factory" },
    owner.token,
  );
  const factoryManager = await actor(
    "FACTORY_MANAGER",
    "Spec factory manager",
    org.id,
    factory.id,
  );
  const otherFactory = await actor(
    "FACTORY_MANAGER",
    "Other factory manager",
    org.id,
    secondFactory.id,
  );
  await request("/collection/state", 401);
  await request(
    "/collection/trips",
    403,
    {
      idempotencyKey: key(),
      warehouseId: helios.id,
      bagCount: 10,
      weightKg: "1234.56",
    },
    factoryManager.token,
  );
  const tripKey = key();
  const tripBody = {
    idempotencyKey: tripKey,
    warehouseId: helios.id,
    bagCount: 10,
    weightKg: "1234.56",
  };
  const trip = await request(
    "/collection/trips",
    201,
    tripBody,
    collector.token,
  );
  assert.deepEqual(
    await request("/collection/trips", 201, tripBody, collector.token),
    trip,
  );
  await request("/collection/trips", 409, tripBody, secondCollector.token);
  await request(
    "/collection/trips",
    409,
    { ...tripBody, weightKg: "1234.57" },
    collector.token,
  );
  assert.equal(
    await db.collectionTrip.count({ where: { organizationId: org.id } }),
    1,
  );
  await request(
    `/collection/trips/${trip.id}/qr`,
    403,
    undefined,
    warehouse.token,
  );
  await request(
    `/collection/trips/${trip.id}/qr`,
    404,
    undefined,
    outsider.token,
  );
  const savedQr = await request(
    `/collection/trips/${trip.id}/qr`,
    200,
    undefined,
    collector.token,
  );
  assert.equal(savedQr.qrToken, trip.qrToken);
  const credentials = {
    token: trip.qrToken,
    clientToken: key() + key(),
    plateNumber: "123 ABC 01",
    phone: "+77001234567",
  };
  const claim = await request("/collection-driver/claim", 201, credentials);
  assert.equal(
    (await request("/collection-driver/claim", 201, credentials)).token,
    claim.token,
  );
  await request("/collection-driver/claim", 409, {
    ...credentials,
    clientToken: key() + key(),
  });
  const videoData = Buffer.from(
    "collection tutorial upload integration sample",
  );
  const videoHash = createHash("sha256").update(videoData).digest("hex");
  const videoName = `owner--spec-${run}.mp4`;
  const uploadId = key();
  const chunk = async (
    token: string,
    index: number,
    data: Buffer,
    name = videoName,
  ) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({
      filename: name,
      uploadId,
      index: String(index),
      count: "2",
      sha256: videoHash,
    }))
      form.append(k, v);
    form.append("chunk", new Blob([data]), "chunk");
    return fetch(api + "/collection/tutorials/chunks", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: form,
    });
  };
  assert.equal(
    (await chunk(collector.token, 0, videoData.subarray(0, 10))).status,
    403,
  );
  const half = await chunk(owner.token, 0, videoData.subarray(0, 10));
  assert.equal(half.status, 201);
  assert.equal((await half.json()).complete, false);
  const final = await chunk(owner.token, 1, videoData.subarray(10));
  assert.equal(final.status, 201);
  assert.equal((await final.json()).complete, true);
  assert.equal(
    (await (await chunk(owner.token, 1, videoData.subarray(10))).json())
      .complete,
    true,
  );
  const ownVideos = await request(
    "/collection/tutorials",
    200,
    undefined,
    owner.token,
  );
  assert.ok(ownVideos.videos.some((v) => v.filename === videoName));
  const collectorVideos = await request(
    "/collection/tutorials",
    200,
    undefined,
    collector.token,
  );
  assert.ok(
    collectorVideos.videos.every((v) => v.filename.startsWith("collector--")),
  );
  const driverVideos = await request("/collection-driver/tutorials", 200);
  assert.ok(
    driverVideos.videos.every((v) => v.filename.startsWith("driver--")),
  );
  assert.equal(
    (await chunk(owner.token, 0, videoData, "../unsafe.mp4")).status,
    400,
  );
  const event = async (token: string, type: string, requestId = key()) =>
    request(
      "/collection-driver/events",
      201,
      { requestId, type, recordedAt: new Date().toISOString() },
      token,
    );
  await request(
    "/collection-driver/events",
    409,
    {
      requestId: key(),
      type: "DEPARTED",
      recordedAt: new Date().toISOString(),
    },
    claim.token,
  );
  const point = {
    sequence: 1,
    latitude: 43.238949,
    longitude: 76.889709,
    accuracy: 8,
    recordedAt: new Date().toISOString(),
  };
  await request(
    "/collection-driver/points",
    201,
    { points: [point] },
    claim.token,
  );
  await request(
    "/collection-driver/points",
    201,
    { points: [point] },
    claim.token,
  );
  const driver = await db.collectionDriverSession.findUniqueOrThrow({
    where: { tripId: trip.id },
  });
  assert.equal(
    await db.collectionDriverPoint.count({ where: { sessionId: driver.id } }),
    1,
  );
  for (const token of [owner.token, collector.token, warehouse.token]) {
    const track = await request(
      `/collection/trips/${trip.id}/route`,
      200,
      undefined,
      token,
    );
    assert.equal(track.points.length, 1);
    assert.equal(track.points[0].latitude, point.latitude);
    assert.equal(track.points[0].tokenHash, undefined);
  }
  await request(
    `/collection/trips/${trip.id}/route`,
    403,
    undefined,
    secondCollector.token,
  );
  await request(
    `/collection/trips/${trip.id}/route`,
    403,
    undefined,
    otherWarehouse.token,
  );
  await request(
    `/collection/trips/${trip.id}/route`,
    404,
    undefined,
    outsider.token,
  );
  await request(
    `/collection/trips/${trip.id}/route?cursor=unknown`,
    400,
    undefined,
    owner.token,
  );
  await request("/collection-driver/route", 401);
  assert.equal(
    (await request("/collection-driver/route", 200, undefined, claim.token))
      .points.length,
    1,
  );
  const many = Array.from({ length: 2001 }, (_, i) => ({
    sessionId: driver.id,
    sequence: 10000 + i,
    latitude: 43.23 + i / 100000,
    longitude: 76.88,
    accuracy: 8,
    recordedAt: new Date(Date.now() - 30000 + i),
  }));
  await db.collectionDriverPoint.createMany({ data: many });
  const firstPage = await request(
    `/collection/trips/${trip.id}/route`,
    200,
    undefined,
    owner.token,
  );
  assert.equal(firstPage.points.length, 2000);
  assert.ok(firstPage.nextCursor);
  const lastPage = await request(
    `/collection/trips/${trip.id}/route?cursor=${firstPage.nextCursor}`,
    200,
    undefined,
    owner.token,
  );
  assert.equal(lastPage.points.length, 2);
  assert.equal(lastPage.nextCursor, null);
  assert.equal(
    new Set([...firstPage.points, ...lastPage.points].map((p) => p.id)).size,
    2002,
  );
  await db.collectionDriverPoint.deleteMany({
    where: { sessionId: driver.id, sequence: { gte: 10000 } },
  });
  await request("/collection-driver/points", 401, { points: [point] });
  await request(
    `/collection/trips/${trip.id}/confirm`,
    409,
    { idempotencyKey: key() },
    warehouse.token,
  );
  await event(claim.token, "LOADED");
  await event(claim.token, "DEPARTED");
  const arrived = {
    requestId: key(),
    type: "ARRIVED",
    recordedAt: new Date().toISOString(),
  };
  await request("/collection-driver/events", 201, arrived, claim.token);
  await request("/collection-driver/events", 201, arrived, claim.token);
  await request(
    "/collection-driver/points",
    201,
    { points: [{ ...point, sequence: 2 }] },
    claim.token,
  );
  await request(
    "/collection-driver/points",
    400,
    {
      points: [
        {
          ...point,
          sequence: 3,
          recordedAt: new Date(Date.now() + 1000).toISOString(),
        },
      ],
    },
    claim.token,
  );
  const pending = await db.collectionBatch.findFirstOrThrow({
    where: { sourceType: "TRIP", sourceId: trip.id },
  });
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.remainingKg.toString(), "0");
  const noticePage = await request(
    "/notifications?pageSize=100",
    200,
    undefined,
    warehouse.token,
  );
  const arrivedNotice = noticePage.data.find(
    (n: any) => n.type === "COLLECTION_RAW_ARRIVED",
  );
  assert.equal(arrivedNotice.action.entityId, trip.id);
  assert.equal(arrivedNotice.action.section, "inbound");
  assert.match(arrivedNotice.body, /123 ABC 01/);
  assert.match(arrivedNotice.body, /1,23456 т/);
  await request(
    `/collection/trips/${trip.id}/confirm`,
    403,
    { idempotencyKey: key() },
    otherWarehouse.token,
  );
  const receiptKey = key();
  await request(
    `/collection/trips/${trip.id}/confirm`,
    201,
    { idempotencyKey: receiptKey },
    warehouse.token,
  );
  await request(
    `/collection/trips/${trip.id}/confirm`,
    201,
    { idempotencyKey: receiptKey },
    warehouse.token,
  );
  await request(
    `/collection/trips/${trip.id}/confirm`,
    409,
    { idempotencyKey: key() },
    warehouse.token,
  );
  assert.equal(
    (
      await db.collectionBatch.findUniqueOrThrow({ where: { id: pending.id } })
    ).remainingKg.toString(),
    "1234.56",
  );
  await request(
    "/collection/wash",
    403,
    { idempotencyKey: key(), locationId: helios.id, weightKg: "500" },
    otherWarehouse.token,
  );
  await request(
    "/collection/wash",
    201,
    { idempotencyKey: key(), locationId: helios.id, weightKg: "500" },
    warehouse.token,
  );
  const shipment = await request(
    "/collection/shipments",
    201,
    {
      idempotencyKey: key(),
      locationId: helios.id,
      factoryId: factory.id,
      bagCount: 3,
      weightKg: "450",
    },
    warehouse.token,
  );
  assert.equal(shipment.averageBagKg, "150");
  await request(
    `/collection/shipments/${shipment.id}/confirm`,
    403,
    { idempotencyKey: key() },
    otherFactory.token,
  );
  await request(
    `/collection/shipments/${shipment.id}/confirm`,
    201,
    { idempotencyKey: key() },
    factoryManager.token,
  );
  await request(
    `/collection/shipments/${shipment.id}/confirm`,
    409,
    { idempotencyKey: key() },
    factoryManager.token,
  );
  await request(
    "/collection/production",
    409,
    {
      idempotencyKey: key(),
      locationId: factory.id,
      finished: [{ weightKg: "451" }],
      rejected: [],
    },
    factoryManager.token,
  );
  const produced = await request(
    "/collection/production",
    201,
    {
      idempotencyKey: key(),
      locationId: factory.id,
      finished: [{ weightKg: "100.25" }, { weightKg: "100.25" }],
      rejected: [{ weightKg: "20" }],
    },
    factoryManager.token,
  );
  assert.equal(produced.consumedKg, "220.5");
  const finishedBatch = await db.collectionBatch.findFirstOrThrow({
    where: { sourceId: produced.id, state: "FINISHED" },
    include: { bags: true },
  });
  assert.equal(finishedBatch.bags.length, 2);
  const gp = await request(
    "/collection/gp-trips",
    201,
    {
      idempotencyKey: key(),
      locationId: factory.id,
      recipientName: "Spec recipient",
      recipientAddress: "Spec delivery address",
      bagIds: [finishedBatch.bags[0].id],
    },
    factoryManager.token,
  );
  assert.equal(gp.weightKg, "100.25");
  assert.equal(gp.bagCount, 1);
  await request(
    "/collection/gp-trips",
    409,
    {
      idempotencyKey: key(),
      locationId: factory.id,
      recipientName: "Spec recipient",
      recipientAddress: "Spec address",
      bagIds: [finishedBatch.bags[0].id],
    },
    factoryManager.token,
  );
  const gpClaim = await request("/collection-driver/claim", 201, {
    ...credentials,
    token: gp.qrToken,
    clientToken: key() + key(),
  });
  await event(gpClaim.token, "LOADED");
  await event(gpClaim.token, "DEPARTED");
  await event(gpClaim.token, "ARRIVED");
  assert.equal(
    (
      await db.collectionBag.findUniqueOrThrow({
        where: { id: finishedBatch.bags[0].id },
      })
    ).status,
    "DELIVERED",
  );
  assert.equal(
    await db.collectionBatch.count({
      where: { sourceType: "TRIP", sourceId: gp.id },
    }),
    0,
    "GP delivery must never become raw stock",
  );
  const gpRemaining = await db.collectionBatch.findUniqueOrThrow({
    where: { id: finishedBatch.id },
  });
  assert.equal(gpRemaining.remainingKg.toString(), "100.25");
  // Both concurrent washes try to consume the entire same stock; only one can commit.
  const beforeOwner = await db.notification.count({
    where: { userId: owner.id, type: "COLLECTION_WASH" },
  });
  const concurrent = await Promise.all(
    [1, 2].map(async () => {
      const response = await fetch(api + "/collection/wash", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${otherWarehouse.token}`,
        },
        body: JSON.stringify({
          idempotencyKey: key(),
          locationId: zhana.id,
          weightKg: "3000",
        }),
      });
      return response.status;
    }),
  );
  assert.deepEqual(concurrent.sort(), [201, 409]);
  assert.equal(
    await db.notification.count({
      where: { userId: owner.id, type: "COLLECTION_WASH" },
    }),
    beforeOwner + 1,
    "Rolled-back stock operations must not notify",
  );
  const ownerState = await request(
    "/collection/state",
    200,
    undefined,
    owner.token,
  );
  assert.equal(ownerState.trips.length, 2);
  assert.equal(
    ownerState.stock.find(
      (r: any) => r.locationId === factory.id && r.state === "WASHED",
    )._sum.remainingKg,
    "229.5",
  );
  const ownState = await request(
    "/collection/state",
    200,
    undefined,
    otherWarehouse.token,
  );
  assert.equal(ownState.trips.length, 0);
  assert.ok(ownState.stock.every((row: any) => row.locationId === zhana.id));
  assert.ok(
    !JSON.stringify(ownerState).includes(claim.token),
    "Session credentials must never appear in owner state",
  );
  assert.ok(
    !JSON.stringify(ownerState).includes(trip.qrToken),
    "QR bearer credentials must never appear in lists",
  );
  const ownerNotices = await db.notification.findMany({
    where: { userId: owner.id },
  });
  for (const kind of [
    "COLLECTION_TRIP_CREATED",
    "COLLECTION_DRIVER_CLAIM",
    "COLLECTION_LOADED",
    "COLLECTION_DEPARTED",
    "COLLECTION_RAW_ARRIVED",
    "COLLECTION_RAW_ACCEPTED",
    "COLLECTION_WASH",
    "COLLECTION_FACTORY_SHIPMENT",
    "COLLECTION_FACTORY_ACCEPTED",
    "COLLECTION_PRODUCTION",
    "COLLECTION_GP_SHIPMENT",
    "COLLECTION_GP_ARRIVED",
  ])
    assert.ok(
      ownerNotices.some((n) => n.type === kind),
      "Owner misses " + kind,
    );
  assert.ok(
    (await db.pushDelivery.count({
      where: { notificationId: { in: ownerNotices.map((n) => n.id) } },
    })) >= ownerNotices.length,
  );
  const unrelated = await db.notification.findMany({
    where: { userId: otherWarehouse.id },
  });
  assert.ok(
    unrelated.every((n) => n.type === "COLLECTION_WASH"),
    "Warehouse received another object's events",
  );
  // Ten-minute warning is deduplicated and sent to both QR creator and all owners.
  const lateTrip = await request(
    "/collection/trips",
    201,
    { ...tripBody, idempotencyKey: key() },
    collector.token,
  );
  const lateClaim = await request("/collection-driver/claim", 201, {
    ...credentials,
    token: lateTrip.qrToken,
    clientToken: key() + key(),
  });
  await db.collectionDriverSession.update({
    where: { tripId: lateTrip.id },
    data: { createdAt: new Date(Date.now() - 20 * 60_000) },
  });
  const driverService = new CollectionDriverService(
    new CollectionService(db as any),
  );
  await driverService.alerts();
  await driverService.alerts();
  const alerts = await db.notification.findMany({
    where: { organizationId: org.id, type: "DRIVER_SIGNAL_LOST" },
  });
  assert.equal(alerts.filter((n) => n.userId === owner.id).length, 1);
  assert.equal(alerts.filter((n) => n.userId === collector.id).length, 1);
  await request(
    "/collection-driver/points",
    201,
    { points: [{ ...point, recordedAt: new Date().toISOString() }] },
    lateClaim.token,
  );
  await driverService.alerts();
  assert.equal(
    await db.notification.count({
      where: { organizationId: org.id, type: "DRIVER_SIGNAL_LOST" },
    }),
    2,
  );
  await request("/collection-driver/stop", 201, {}, lateClaim.token);
  const sharedPushToken = "spec-installation-" + key();
  const firstDevice = await request(
    "/auth/devices",
    201,
    { platform: "android", pushToken: sharedPushToken },
    collector.token,
  );
  const reassignedDevice = await request(
    "/auth/devices",
    201,
    {
      deviceId: firstDevice.id,
      platform: "android",
      pushToken: sharedPushToken,
    },
    factoryManager.token,
  );
  assert.equal(
    (await db.device.findUniqueOrThrow({ where: { id: firstDevice.id } }))
      .pushToken,
    null,
    "Old account must stop receiving notifications on a reassigned phone",
  );
  assert.equal(
    await db.device.count({ where: { pushToken: sharedPushToken } }),
    1,
  );
  await request("/auth/logout-all", 201, {}, factoryManager.token);
  assert.equal(
    (await db.device.findUniqueOrThrow({ where: { id: reassignedDevice.id } }))
      .pushToken,
    null,
    "Logout must unregister push delivery",
  );
  // Repair an accepted receipt without replaying or rewriting prior stock movements.
  const mistaken = await request(
    "/collection/trips",
    201,
    {
      idempotencyKey: key(),
      warehouseId: helios.id,
      bagCount: 50,
      weightKg: "20",
    },
    collector.token,
  );
  const correctionDriver = await request("/collection-driver/claim", 201, {
    token: mistaken.qrToken,
    clientToken: key() + key(),
    plateNumber: "020 TEST 01",
    phone: "+77010000123",
  });
  for (const type of ["LOADED", "DEPARTED", "ARRIVED"])
    await request(
      "/collection-driver/events",
      201,
      { requestId: key(), type, recordedAt: new Date().toISOString() },
      correctionDriver.token,
    );
  await request(
    "/collection/trips/" + mistaken.id + "/confirm",
    201,
    { idempotencyKey: key() },
    warehouse.token,
  );
  const correction = {
    idempotencyKey: key(),
    expectedWeightKg: "20",
    weightKg: "20000",
    reason: "Исправление ошибочных единиц: отправлено двадцать тонн",
  };
  await request(
    "/collection/trips/" + mistaken.id + "/weight",
    403,
    correction,
    warehouse.token,
  );
  await request(
    "/collection/trips/" + mistaken.id + "/weight",
    201,
    correction,
    owner.token,
  );
  await request(
    "/collection/trips/" + mistaken.id + "/weight",
    201,
    correction,
    owner.token,
  );
  await request(
    "/collection/trips/" + mistaken.id + "/weight",
    409,
    { ...correction, idempotencyKey: key() },
    owner.token,
  );
  const correctedBatch = await db.collectionBatch.findFirstOrThrow({
    where: { sourceType: "TRIP", sourceId: mistaken.id, state: "RAW" },
  });
  assert.equal(correctedBatch.totalKg.toString(), "20000");
  assert.equal(correctedBatch.remainingKg.toString(), "20000");
  assert.equal(
    await db.collectionAction.count({
      where: { kind: "WEIGHT_CORRECTION", organizationId: org.id },
    }),
    1,
  );
  assert.equal(
    await db.auditLog.count({
      where: {
        action: "collection.trip.weight.correct",
        entityId: mistaken.id,
      },
    }),
    1,
  );
  const before = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://example:example@localhost/bioflow";
  assert.throws(() => assertCollectionDatabase(), /own collection_/);
  process.env.DATABASE_URL = before;
  if (process.env.COLLECTION_BROWSER_FIXTURE)
    writeFileSync(
      process.env.COLLECTION_BROWSER_FIXTURE,
      JSON.stringify({
        owner: { email: owner.email, password },
        collector: { email: collector.email, password },
        warehouse: { email: warehouse.email, password },
        factory: { email: factoryManager.email, password },
        organizationId: org.id,
        heliosId: helios.id,
        factoryId: factory.id,
        tripId: trip.id,
      }),
    );
});
