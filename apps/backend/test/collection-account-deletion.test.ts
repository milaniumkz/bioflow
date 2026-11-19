import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "../src/auth/auth.service";

const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).pathname.endsWith("_spec"))
  throw Error("Deletion tests require a separate *_spec database");
const db = new PrismaClient();
const api = process.env.COLLECTION_TEST_API ?? "http://127.0.0.1:4198/api/v1";
async function request(
  path: string,
  method: string,
  body?: object,
  token?: string,
) {
  const response = await fetch(api + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
test("self deletion removes identity and sessions, preserves organization records and rejects resurrection", async (t) => {
  t.after(() => db.$disconnect());
  const suffix = randomUUID(),
    password = "Deletion-spec-only-123";
  const org = await db.organization.create({
    data: { name: "Deletion spec " + suffix },
  });
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      email: suffix + "@example.invalid",
      fullName: "Disposable spec user",
      passwordHash: await argon2.hash(password),
      mustChangePassword: true,
    },
  });
  const victim = await db.user.create({
    data: {
      organizationId: org.id,
      fullName: "Other employee",
      passwordHash: await argon2.hash(password),
    },
  });
  const site = await db.collectionLocation.create({
    data: {
      organizationId: org.id,
      code: "DELETE-SPEC",
      name: "Spec warehouse",
      kind: "WAREHOUSE",
    },
  });
  await db.collectionMembership.create({
    data: { userId: user.id, locationId: site.id },
  });
  const role = await db.role.upsert({
    where: { code: "OWNER" },
    create: { code: "OWNER", name: "Owner" },
    update: {},
  });
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const trip = await db.collectionTrip.create({
    data: {
      organizationId: org.id,
      number: "DELETE-SPEC-" + suffix,
      createdById: user.id,
      warehouseId: site.id,
      bagCount: 2,
      weightKg: "100",
      qrTokenHash: randomUUID(),
    },
  });
  const device = await db.device.create({
    data: {
      userId: user.id,
      platform: "ios",
      pushToken: "spec-push-" + suffix,
    },
  });
  const personal = await db.notification.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      type: "SPEC",
      title: "Private",
      body: "Spec only",
    },
  });
  const shared = await db.notification.create({
    data: {
      organizationId: org.id,
      type: "SPEC",
      title: "Shared",
      body: "Keep",
    },
  });
  await db.collectionNoticeLink.create({
    data: { notificationId: personal.id, section: "stock", entityId: site.id },
  });
  await db.pushDelivery.create({
    data: { notificationId: personal.id, deviceId: device.id },
  });
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const login = await request("/auth/login", "POST", {
    email: user.email,
    password,
  });
  assert.equal(login.status, 201);
  const second = await request("/auth/login", "POST", {
    email: user.email,
    password,
  });
  assert.equal(second.status, 201);
  const token = login.body.accessToken;
  const payload = { currentPassword: password, confirmation: "DELETE" };
  assert.equal((await request("/auth/account", "DELETE", payload)).status, 401);
  assert.equal(
    (
      await request(
        "/auth/account",
        "DELETE",
        { ...payload, userId: victim.id },
        token,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/auth/account",
        "DELETE",
        { ...payload, confirmation: "yes" },
        token,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/auth/account",
        "DELETE",
        { ...payload, currentPassword: "wrong" },
        token,
      )
    ).status,
    403,
  );
  assert.equal(await db.device.count({ where: { userId: user.id } }), 1);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).email,
    user.email,
  );
  let releaseLogin!: () => void, observedLogin!: () => void;
  const pausedLogin = new Promise<void>((resolve) => {
    releaseLogin = resolve;
  });
  const observed = new Promise<void>((resolve) => {
    observedLogin = resolve;
  });
  const racedDb = db.$extends({
    query: {
      user: {
        async findFirst({ args, query }) {
          const snapshot = await query(args);
          if (args.where?.OR) {
            observedLogin();
            await pausedLogin;
          }
          return snapshot;
        },
      },
    },
  });
  const racingAuth = new AuthService(racedDb as any, new JwtService());
  const racingLogin = racingAuth
    .login({
      email: user.email!,
      password,
      platform: "ios",
      pushToken: "racing-spec",
    })
    .then(
      () => false,
      () => true,
    );
  await observed;
  const attempts = await Promise.all([
    request("/auth/account", "DELETE", payload, token),
    request("/auth/account", "DELETE", payload, token),
  ]);
  releaseLogin();
  assert.equal(
    await racingLogin,
    true,
    "A login authenticated before deletion cannot recreate a device or session afterward",
  );
  assert.equal(attempts.filter((r) => r.status === 200).length, 1);
  assert.ok(attempts.every((r) => [200, 401, 403].includes(r.status)));
  const deleted = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.ok(deleted.deletedAt);
  assert.equal(deleted.isBlocked, true);
  assert.equal(deleted.fullName, "Deleted account");
  assert.equal(deleted.email, null);
  assert.equal(deleted.phone, null);
  assert.equal(await argon2.verify(deleted.passwordHash, password), false);
  for (const model of [
    db.refreshToken,
    db.device,
    db.passwordResetToken,
    db.userRole,
    db.collectionMembership,
  ] as const)
    assert.equal(
      await (model.count as Function)({ where: { userId: user.id } }),
      0,
    );
  assert.equal(await db.notification.count({ where: { userId: user.id } }), 0);
  assert.equal(
    await db.pushDelivery.count({ where: { deviceId: device.id } }),
    0,
  );
  assert.equal(
    await db.collectionNoticeLink.count({
      where: { notificationId: personal.id },
    }),
    0,
  );
  assert.equal(
    (await request("/auth/me", "GET", undefined, token)).status,
    401,
  );
  assert.equal(
    (await request("/auth/me", "GET", undefined, second.body.accessToken))
      .status,
    401,
  );
  assert.equal(
    (
      await request("/auth/refresh", "POST", {
        refreshToken: second.body.refreshToken,
      })
    ).status,
    401,
  );
  assert.equal(
    (await request("/auth/login", "POST", { email: user.email, password }))
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        "/auth/devices",
        "POST",
        { platform: "ios", pushToken: "new" },
        token,
      )
    ).status,
    401,
  );
  assert.deepEqual(
    await db.collectionTrip.findUniqueOrThrow({ where: { id: trip.id } }),
    trip,
  );
  assert.ok(await db.notification.findUnique({ where: { id: shared.id } }));
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: victim.id } })).fullName,
    "Other employee",
  );
  assert.equal(
    await db.auditLog.count({
      where: { userId: user.id, action: "auth.account-deleted" },
    }),
    1,
  );
  await assert.rejects(
    db.user.update({ where: { id: user.id }, data: { isBlocked: false } }),
    /constraint/i,
  );
  await assert.rejects(
    db.user.update({ where: { id: user.id }, data: { phone: "+12025550123" } }),
    /constraint/i,
  );
});
