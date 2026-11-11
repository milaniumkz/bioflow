import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DriverTrackingService } from "../src/driver-tracking/driver-tracking.service";
import { JwtService } from "@nestjs/jwt";

const database = process.env.DATABASE_URL ?? "";
if (!new URL(database).pathname.endsWith("_spec"))
  throw new Error("Requires disposable *_spec database");
const base = process.env.DRIVER_TEST_API ?? "http://127.0.0.1:4197/api/v1";
const db = new PrismaClient();
const plate = "123ABC" + randomUUID().slice(0, 4);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function request(
  path: string,
  expected: number,
  body?: unknown,
  token?: string,
) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body:
      body === undefined
        ? undefined
        : JSON.stringify(
            path === "/driver-tracking/claim"
              ? {
                  clientToken: randomUUID() + randomUUID(),
                  plateNumber: plate,
                  phone: "+77000000000",
                  ...(body as object),
                }
              : body,
          ),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
test("driver QR lifecycle, idempotency, validation, organization isolation and revocation over HTTP/PostgreSQL", async (t) => {
  t.after(() => db.$disconnect());
  const suffix = randomUUID();
  const org = await db.organization.create({
    data: { name: `driver-spec-${suffix}` },
  });
  const otherOrg = await db.organization.create({
    data: { name: `other-driver-spec-${suffix}` },
  });
  const ownerRole = await db.role.upsert({
    where: { code: "OWNER" },
    update: {},
    create: { code: "OWNER", name: "Owner" },
  });
  async function actor(organizationId: string, owner: boolean) {
    const user = await db.user.create({
      data: {
        organizationId,
        fullName: "Driver spec owner",
        passwordHash: "unused-test-hash",
        ...(owner ? { userRoles: { create: { roleId: ownerRole.id } } } : {}),
      },
    });
    return new JwtService().signAsync(
      { sub: user.id },
      {
        secret: process.env.JWT_ACCESS_SECRET ?? "dev-access",
        expiresIn: "10m",
      },
    );
  }
  const owner = await actor(org.id, true);
  const otherOwner = await actor(otherOrg.id, true);
  const worker = await actor(org.id, false);
  const creator = await db.user.findFirstOrThrow({
    where: { organizationId: org.id },
  });
  const counterparty = await db.counterparty.create({
    data: { organizationId: org.id, name: suffix },
  });
  const extraction = await db.extractionSite.create({
    data: { organizationId: org.id, name: suffix },
  });
  const warehouse = await db.warehouse.create({
    data: { organizationId: org.id, name: suffix },
  });
  const vehicle = await db.vehicle.create({
    data: {
      organizationId: org.id,
      type: "TRUCK",
      brand: "Test",
      plateNumber: plate,
    },
  });
  const material = await db.materialType.create({ data: { name: suffix } });
  async function trip(status: "CREATED" | "COMPLETED" = "CREATED") {
    const qr =
      randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    const row = await db.waybill.create({
      data: {
        organizationId: org.id,
        number: randomUUID(),
        counterpartyId: counterparty.id,
        extractionSiteId: extraction.id,
        // Driver supplies identity after scanning; no pre-created vehicle is required.
        vehicleId: null,
        destinationWarehouseId: warehouse.id,
        materialTypeId: material.id,
        declaredWeight: 1,
        createdById: creator.id,
        status,
        qrTokenHash: hash(qr),
      },
    });
    return { qr, row };
  }
  const { qr, row } = await trip();
  await request(`/driver-tracking/waybills/${row.id}`, 401);
  await request(`/driver-tracking/waybills/${row.id}`, 403, undefined, worker);
  await request(
    `/driver-tracking/waybills/${row.id}`,
    404,
    undefined,
    otherOwner,
  );
  assert.equal(
    (
      await request(
        `/driver-tracking/waybills/${row.id}`,
        200,
        undefined,
        owner,
      )
    ).status,
    "NOT_STARTED",
  );
  await request("/driver-tracking/claim", 400, { token: "bad" });
  await request("/driver-tracking/claim", 400, { token: "x".repeat(43) });
  const claim = await request("/driver-tracking/claim", 201, { token: qr });
  assert.equal(claim.waybillNumber, row.number);
  const retryClaim = await request("/driver-tracking/claim", 201, {
    token: qr,
    clientToken: claim.token,
  });
  assert.equal(retryClaim.token, claim.token);
  await request("/driver-tracking/claim", 409, { token: qr });
  const stored = await db.driverTrackingSession.findUniqueOrThrow({
    where: { waybillId: row.id },
  });
  assert.equal(stored.tokenHash, hash(claim.token));
  assert.notEqual(stored.tokenHash, claim.token);
  assert.equal(
    (
      await request(
        `/driver-tracking/waybills/${row.id}`,
        200,
        undefined,
        owner,
      )
    ).status,
    "WAITING",
  );
  const point = {
    sequence: 1,
    latitude: 43.238949,
    longitude: 76.889709,
    accuracy: 8,
    recordedAt: new Date().toISOString(),
  };
  await request("/driver-tracking/points", 401, { points: [point] });
  await request("/driver-tracking/points", 401, { points: [point] }, qr);
  await request(
    "/driver-tracking/points",
    400,
    { points: [{ ...point, latitude: 91 }] },
    claim.token,
  );
  await request(
    "/driver-tracking/points",
    400,
    {
      points: [
        { ...point, recordedAt: new Date(Date.now() + 3600_000).toISOString() },
      ],
    },
    claim.token,
  );
  await request(
    "/driver-tracking/points",
    400,
    { points: Array.from({ length: 101 }, () => point) },
    claim.token,
  );
  await request(
    "/driver-tracking/points",
    201,
    { points: [point] },
    claim.token,
  );
  await request(
    "/driver-tracking/points",
    201,
    { points: [point] },
    claim.token,
  );
  assert.equal(
    await db.driverLocation.count({ where: { sessionId: stored.id } }),
    1,
  );
  const position = await request(
    `/driver-tracking/waybills/${row.id}`,
    200,
    undefined,
    owner,
  );
  assert.equal(position.status, "ACTIVE");
  assert.equal(position.point.latitude, point.latitude);
  assert.equal(position.driverPhone, "+77000000000");
  assert.equal(position.driverPlate, plate.toUpperCase());
  assert.equal(position.tokenHash, undefined);
  await request("/driver-tracking/stop", 201, {}, claim.token);
  await request(
    "/driver-tracking/points",
    401,
    { points: [{ ...point, sequence: 2 }] },
    claim.token,
  );
  assert.equal(
    (
      await request(
        `/driver-tracking/waybills/${row.id}`,
        200,
        undefined,
        owner,
      )
    ).status,
    "STOPPED",
  );
  const completed = await trip("COMPLETED");
  await request("/driver-tracking/claim", 400, { token: completed.qr });
  const expiring = await trip();
  const expiringClaim = await request("/driver-tracking/claim", 201, {
    token: expiring.qr,
  });
  await db.driverTrackingSession.update({
    where: { waybillId: expiring.row.id },
    data: {
      createdAt: new Date(Date.now() - 2 * 3600_000),
      expiresAt: new Date(Date.now() - 3600_000),
    },
  });
  await request(
    "/driver-tracking/points",
    400,
    { points: [{ ...point, recordedAt: new Date().toISOString() }] },
    expiringClaim.token,
  );
  await request(
    "/driver-tracking/points",
    201,
    {
      points: [
        {
          ...point,
          sequence: 2,
          recordedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
        },
      ],
    },
    expiringClaim.token,
  );
  await request("/driver-tracking/stop", 201, {}, expiringClaim.token);
  const ending = await trip();
  const endingClaim = await request("/driver-tracking/claim", 201, {
    token: ending.qr,
  });
  await db.waybill.update({
    where: { id: ending.row.id },
    data: { status: "COMPLETED" },
  });
  await request(
    "/driver-tracking/points",
    400,
    {
      points: [
        { ...point, recordedAt: new Date(Date.now() + 1000).toISOString() },
      ],
    },
    endingClaim.token,
  );
  // Alert only the QR creator, once per signal gap, and enqueue mobile push.
  const alertTrip = await trip();
  const alertClaim = await request("/driver-tracking/claim", 201, {
    token: alertTrip.qr,
  });
  const alertSession = await db.driverTrackingSession.update({
    where: { waybillId: alertTrip.row.id },
    data: { createdAt: new Date(Date.now() - 20 * 60_000) },
  });
  await db.device.create({
    data: {
      userId: creator.id,
      platform: "android",
      pushToken: "fixture-not-a-real-push-token",
    },
  });
  const tracking = new DriverTrackingService(db as any);
  await tracking.checkSignalGaps();
  await tracking.checkSignalGaps();
  const prefix = `driver-signal:${alertSession.id}:`;
  let notices = await db.notification.findMany({
    where: { id: { startsWith: prefix } },
  });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].userId, creator.id);
  assert.equal(
    await db.pushDelivery.count({ where: { notificationId: notices[0].id } }),
    1,
  );
  await request(
    "/driver-tracking/points",
    201,
    {
      points: [
        {
          ...point,
          sequence: 2,
          recordedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
        },
      ],
    },
    alertClaim.token,
  );
  await tracking.checkSignalGaps();
  assert.equal(
    await db.notification.count({ where: { id: { startsWith: prefix } } }),
    1,
    "Old offline batches must not create repeated alerts for the same outage",
  );
  await request(
    "/driver-tracking/points",
    201,
    { points: [{ ...point, recordedAt: new Date().toISOString() }] },
    alertClaim.token,
  );
  await tracking.checkSignalGaps();
  assert.equal(
    await db.notification.count({ where: { id: { startsWith: prefix } } }),
    1,
  );
  await db.driverLocation.updateMany({
    where: { sessionId: alertSession.id },
    data: { recordedAt: new Date(Date.now() - 11 * 60_000) },
  });
  await tracking.checkSignalGaps();
  notices = await db.notification.findMany({
    where: { id: { startsWith: prefix } },
  });
  assert.equal(notices.length, 2);
  await request("/driver-tracking/stop", 201, {}, alertClaim.token);
  await tracking.checkSignalGaps();
  assert.equal(
    await db.notification.count({ where: { id: { startsWith: prefix } } }),
    2,
  );
});
