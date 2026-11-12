import test from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { bootstrapCollection } from "../prisma/bootstrap-collection";
import { CollectionService } from "../src/collection/collection.service";
import { CollectionRegistrationService } from "../src/collection/collection-registration";
const api = process.env.COLLECTION_TEST_API ?? "http://127.0.0.1:4198/api/v1";
const db = new PrismaClient();
const key = () => randomUUID();
const phone = () => "+788" + randomInt(10000000, 99999999);
async function req(
  path: string,
  expected: number,
  body?: unknown,
  token?: string,
) {
  const r = await fetch(api + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.equal(
    r.status,
    expected,
    path +
      ": " +
      JSON.stringify(
        path.startsWith("/auth/")
          ? { error: data.error ?? data.message ?? "Unexpected status" }
          : data,
      ),
  );
  return data;
}
test("Collection administration: role isolation, account lifecycle, exact stock corrections, complete reversal chain and private export", async (t) => {
  if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_spec"))
    throw Error("Admin tests require isolated *_spec database");
  t.after(() => db.$disconnect());
  const orgId = "admin-spec-" + key();
  process.env.COLLECTION_ORGANIZATION_ID = orgId;
  const otherId = "admin-foreign-" + key();
  await Promise.all([
    bootstrapCollection(db),
    (async () => {
      process.env.COLLECTION_ORGANIZATION_ID = otherId;
      await bootstrapCollection(db);
    })(),
  ]);
  process.env.COLLECTION_ORGANIZATION_ID = orgId;
  const hash = await argon2.hash("AdminSpec2026!");
  async function actor(role: string, org = orgId) {
    const r = await db.role.findUniqueOrThrow({ where: { code: role } });
    const user = await db.user.create({
      data: {
        organizationId: org,
        fullName: "Spec " + role,
        phone: phone(),
        passwordHash: hash,
        userRoles: { create: { roleId: r.id } },
      },
    });
    const token = await new JwtService().signAsync(
      { sub: user.id },
      { secret: process.env.JWT_ACCESS_SECRET ?? "dev-access" },
    );
    return { user, token };
  }
  const owner = await actor("OWNER"),
    collector = await actor("COLLECTOR"),
    admin = await actor("ADMIN"),
    foreign = await actor("OWNER", otherId);
  const locations = await db.collectionLocation.findMany({
    where: { organizationId: orgId },
  });
  const helios = locations.find((l) => l.code === "HELIOS")!,
    zhana = locations.find((l) => l.code === "ZHANA_AUL")!,
    factory = locations.find((l) => l.code === "FACTORY-SEZ")!;
  const body = (fields: Record<string, unknown> = {}) => ({
    idempotencyKey: key(),
    reason: "Проверка администрирования",
    ...fields,
  });
  await req("/collection/admin/state", 401);
  await req("/collection/admin/state", 403, undefined, collector.token);
  await req(
    "/collection/admin/users",
    403,
    body({
      fullName: "Нельзя",
      phone: phone(),
      password: "123456",
      role: "ADMIN",
      locationIds: [],
    }),
    collector.token,
  );
  await req("/collection/admin/export", 403, undefined, collector.token);
  const initial = await req(
    "/collection/admin/state",
    200,
    undefined,
    owner.token,
  );
  assert.equal(initial.locations.length, 6);
  assert.equal(initial.roles.length, 5);
  assert.ok(!JSON.stringify(initial).includes("passwordHash"));
  await req(
    "/collection/admin/users/" + foreign.user.id + "/password",
    404,
    body({ password: "SecretReset!" }),
    owner.token,
  );
  await req(
    "/collection/registration/owner",
    403,
    { fullName: "Недопустимый владелец", phone: phone(), password: "123456" },
    admin.token,
  );
  await req(
    "/collection/admin/users/" + owner.user.id + "/password",
    403,
    body({ password: "SecretReset!" }),
    admin.token,
  );
  await req(
    "/collection/admin/users/" + owner.user.id + "/block",
    409,
    body({ blocked: true }),
    owner.token,
  );
  const workerPhone = phone();
  const worker = await req(
    "/collection/admin/users",
    201,
    body({
      fullName: "Созданный ответственный",
      phone: workerPhone,
      password: "123456",
      role: "FACTORY_MANAGER",
      locationIds: [factory.id],
    }),
    owner.token,
  );
  assert.ok(!JSON.stringify(worker).includes("passwordHash"));
  const browserLogin = await fetch(api + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: workerPhone,
      password: "123456",
      platform: "web",
    }),
  });
  assert.equal(browserLogin.status, 201);
  const cookie = browserLogin.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  const cookiePair = cookie.split(";")[0];
  const resumed = await Promise.all(
    Array.from({ length: 4 }, () =>
      fetch(api + "/auth/browser-session", {
        method: "POST",
        headers: { Cookie: cookiePair, "Content-Type": "application/json" },
        body: "{}",
      }),
    ),
  );
  assert.ok(
    resumed.every((r) => r.status === 200),
    "Parallel tabs must not invalidate a browser session",
  );
  const resumedToken = (await resumed[0].json()).accessToken;
  await req("/auth/me", 200, undefined, resumedToken);
  const rejectedOrigin = await fetch(api + "/auth/browser-logout", {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      Origin: "https://not-our-site.invalid",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(rejectedOrigin.status, 403);
  const ended = await fetch(api + "/auth/browser-logout", {
    method: "POST",
    headers: { Cookie: cookiePair, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(ended.status, 200);
  await req("/auth/me", 401, undefined, resumedToken);
  const afterLogout = await fetch(api + "/auth/browser-session", {
    method: "POST",
    headers: { Cookie: cookiePair, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(afterLogout.status, 401);
  let login = await req("/auth/login", 201, {
    phone: workerPhone,
    password: "123456",
    platform: "web",
  });
  assert.equal(
    (await req("/auth/me", 200, undefined, login.accessToken))
      .mustChangePassword,
    false,
  );
  await req(
    "/collection/admin/users/" + worker.id,
    201,
    body({
      fullName: "Назначенный ответственный",
      phone: workerPhone,
      role: "WAREHOUSE_MANAGER",
      locationIds: [helios.id, zhana.id],
    }),
    owner.token,
  );
  assert.equal(
    await db.collectionMembership.count({ where: { userId: worker.id } }),
    2,
  );
  await req("/auth/me", 401, undefined, login.accessToken);
  await req(
    "/collection/admin/users/" + worker.id + "/password",
    201,
    body({ password: "AdminSpecSecret!" }),
    owner.token,
  );
  await req("/auth/login", 401, {
    phone: workerPhone,
    password: "123456",
    platform: "web",
  });
  login = await req("/auth/login", 201, {
    phone: workerPhone,
    password: "AdminSpecSecret!",
    platform: "web",
  });
  await req(
    "/collection/admin/users/" + worker.id + "/block",
    201,
    body({ blocked: true }),
    owner.token,
  );
  await req("/auth/me", 401, undefined, login.accessToken);
  await req(
    "/collection/admin/users/" + worker.id + "/block",
    201,
    body({ blocked: false }),
    owner.token,
  );
  await req("/auth/login", 201, {
    phone: workerPhone,
    password: "AdminSpecSecret!",
    platform: "web",
  });
  await req(
    "/collection/admin/users",
    400,
    body({
      fullName: "Чужой объект",
      phone: phone(),
      password: "123456",
      role: "FACTORY_MANAGER",
      locationIds: [helios.id],
    }),
    owner.token,
  );
  const newSite = await req(
    "/collection/admin/locations",
    201,
    body({ name: "Новый склад", kind: "WAREHOUSE", active: true }),
    owner.token,
  );
  await req(
    "/collection/admin/locations/" + newSite.id,
    201,
    body({ name: "Переименованный склад", kind: "WAREHOUSE", active: false }),
    owner.token,
  );
  assert.equal(
    (
      await db.collectionLocation.findUniqueOrThrow({
        where: { id: newSite.id },
      })
    ).active,
    false,
  );
  await req(
    "/collection/admin/locations/" + newSite.id,
    201,
    body({ name: "Переименованный склад", kind: "WAREHOUSE", active: true }),
    owner.token,
  );
  const registration = new CollectionRegistrationService(
    new CollectionService(db),
  );
  assert.ok(
    (await registration.options()).locations.some((l) => l.id === newSite.id),
  );
  const stock = async (site: string, state: string) =>
    (
      await db.collectionBatch.aggregate({
        where: {
          organizationId: orgId,
          locationId: site,
          state,
          status: "ACTIVE",
        },
        _sum: { remainingKg: true },
      })
    )._sum.remainingKg?.toString() ?? "0";
  const correction = body({
    locationId: helios.id,
    state: "RAW",
    expectedKg: "0",
    targetKg: "20000",
  });
  const added = await req(
    "/collection/admin/stock",
    201,
    correction,
    owner.token,
  );
  await req("/collection/admin/stock", 201, correction, owner.token);
  assert.equal(await stock(helios.id, "RAW"), "20000");
  await req(
    "/collection/admin/stock",
    409,
    body({
      locationId: helios.id,
      state: "RAW",
      expectedKg: "0",
      targetKg: "10000",
    }),
    owner.token,
  );
  const reduced = await req(
    "/collection/admin/stock",
    201,
    body({
      locationId: helios.id,
      state: "RAW",
      expectedKg: "20000",
      targetKg: "19000",
    }),
    owner.token,
  );
  assert.equal(await stock(helios.id, "RAW"), "19000");
  await req(
    "/collection/admin/operations/" + reduced.actionId + "/reverse",
    201,
    body(),
    owner.token,
  );
  assert.equal(await stock(helios.id, "RAW"), "20000");
  const washed = await req(
    "/collection/wash",
    201,
    { idempotencyKey: key(), locationId: helios.id, weightKg: "2000" },
    owner.token,
  );
  const shipment = await req(
    "/collection/shipments",
    201,
    {
      idempotencyKey: key(),
      locationId: helios.id,
      factoryId: factory.id,
      weightKg: "1625",
      bagCount: 2,
    },
    owner.token,
  );
  await req(
    "/collection/shipments/" + shipment.id + "/confirm",
    201,
    { idempotencyKey: key() },
    owner.token,
  );
  const production = await req(
    "/collection/production",
    201,
    {
      idempotencyKey: key(),
      locationId: factory.id,
      finished: [{ weightKg: "800" }, { weightKg: "825" }],
      rejected: [],
    },
    owner.token,
  );
  const bags = await db.collectionBag.findMany({
    where: { batch: { organizationId: orgId, sourceId: production.id } },
    orderBy: { index: "asc" },
  });
  const gp = await req(
    "/collection/gp-trips",
    201,
    {
      idempotencyKey: key(),
      locationId: factory.id,
      bagIds: [bags[0].id],
      recipientName: "Учебный получатель",
      recipientAddress: "Учебный адрес",
    },
    owner.token,
  );
  await req(
    "/collection/admin/operations/" + production.id + "/reverse",
    409,
    body(),
    owner.token,
  );
  await req(
    "/collection/admin/shipments/" + shipment.id + "/cancel",
    409,
    body(),
    owner.token,
  );
  await req(
    "/collection/admin/trips/" + gp.id + "/cancel",
    201,
    body(),
    owner.token,
  );
  assert.equal(await stock(factory.id, "FINISHED"), "1625");
  await req(
    "/collection/admin/operations/" + production.id + "/reverse",
    201,
    body(),
    owner.token,
  );
  await req(
    "/collection/admin/operations/" + production.id + "/reverse",
    409,
    body(),
    owner.token,
  );
  assert.equal(await stock(factory.id, "WASHED"), "1625");
  await req(
    "/collection/admin/shipments/" + shipment.id + "/cancel",
    201,
    body(),
    owner.token,
  );
  assert.equal(await stock(helios.id, "WASHED"), "2000");
  await req(
    "/collection/admin/operations/" + washed.id + "/reverse",
    201,
    body(),
    owner.token,
  );
  assert.equal(await stock(helios.id, "RAW"), "20000");
  await req(
    "/collection/admin/operations/" + added.actionId + "/reverse",
    201,
    body(),
    owner.token,
  );
  assert.equal(await stock(helios.id, "RAW"), "0");
  const raw = await req(
    "/collection/trips",
    201,
    {
      idempotencyKey: key(),
      warehouseId: helios.id,
      weightKg: "20000",
      bagCount: 50,
    },
    owner.token,
  );
  await req(
    "/collection/admin/trips/" + raw.id,
    201,
    body({ bagCount: 40 }),
    owner.token,
  );
  await req(
    "/collection/admin/trips/" + raw.id + "/stage",
    201,
    body({ status: "ARRIVED" }),
    owner.token,
  );
  await req(
    "/collection/trips/" + raw.id + "/confirm",
    201,
    { idempotencyKey: key() },
    owner.token,
  );
  const rawWash = await req(
    "/collection/wash",
    201,
    { idempotencyKey: key(), locationId: helios.id, weightKg: "1000" },
    owner.token,
  );
  await req(
    "/collection/admin/trips/" + raw.id + "/cancel",
    409,
    body(),
    owner.token,
  );
  await req(
    "/collection/admin/operations/" + rawWash.id + "/reverse",
    201,
    body(),
    owner.token,
  );
  await req(
    "/collection/admin/trips/" + raw.id + "/cancel",
    201,
    body(),
    owner.token,
  );
  assert.equal(await stock(helios.id, "RAW"), "0");
  const bagAdjustment = await req(
    "/collection/admin/bags",
    201,
    body({
      locationId: factory.id,
      state: "FINISHED",
      bags: [{ weightKg: "825" }],
    }),
    owner.token,
  );
  const adjustedBag = await db.collectionBag.findFirstOrThrow({
    where: { batchId: bagAdjustment.batchId },
  });
  await req(
    "/collection/admin/bags/" + adjustedBag.id,
    201,
    body({ available: false }),
    owner.token,
  );
  assert.equal(await stock(factory.id, "FINISHED"), "0");
  await req(
    "/collection/admin/bags/" + adjustedBag.id,
    201,
    body({ available: true }),
    owner.token,
  );
  assert.equal(await stock(factory.id, "FINISHED"), "825");
  const driverTrip = await req(
    "/collection/trips",
    201,
    {
      idempotencyKey: key(),
      warehouseId: helios.id,
      weightKg: "1000",
      bagCount: 2,
    },
    owner.token,
  );
  const claim = await req("/collection-driver/claim", 201, {
    token: driverTrip.qrToken,
    clientToken: key() + key(),
    plateNumber: "123 ABC 01",
    phone: phone(),
  });
  await req(
    "/collection/admin/trips/" + driverTrip.id + "/stop",
    201,
    body(),
    owner.token,
  );
  await req("/collection-driver/route", 401, undefined, claim.token);
  await req(
    "/collection/admin/settings",
    201,
    body({ registrationEnabled: false }),
    owner.token,
  );
  await assert.rejects(
    registration.register({
      fullName: "Закрытая регистрация",
      phone: phone(),
      password: "123456",
      role: "COLLECTOR",
    }),
    /регистрация закрыта/,
  );
  await req(
    "/collection/admin/settings",
    201,
    body({ registrationEnabled: true }),
    owner.token,
  );
  await registration.register({
    fullName: "Открытая регистрация",
    phone: phone(),
    password: "123456",
    role: "COLLECTOR",
  });
  await req(
    "/collection/admin/notifications",
    400,
    body({
      target: "LOCATION",
      title: "Без получателя",
      body: "Проверка адресата",
    }),
    owner.token,
  );
  await req(
    "/collection/admin/notifications",
    201,
    body({
      target: "USER",
      targetId: worker.id,
      title: "Сообщение администратора",
      body: "Учебное уведомление",
    }),
    owner.token,
  );
  const notification = await db.notification.findFirstOrThrow({
    where: {
      organizationId: orgId,
      userId: worker.id,
      title: "Сообщение администратора",
    },
  });
  const device = await db.device.create({
    data: {
      userId: worker.id,
      platform: "android",
      pushToken: "local-spec-only",
    },
  });
  await db.pushDelivery.create({
    data: {
      notificationId: notification.id,
      deviceId: device.id,
      status: "FAILED",
      attempts: 4,
      lastError: "Test failure",
    },
  });
  const retried = await req(
    "/collection/admin/notifications/" + notification.id + "/retry",
    201,
    body(),
    owner.token,
  );
  assert.equal(retried.requeued, 1);
  const history = await req(
    "/collection/admin/audit?page=1&pageSize=2",
    200,
    undefined,
    owner.token,
  );
  assert.equal(history.data.length, 2);
  assert.ok(history.total > 10);
  const operations = await req(
    "/collection/admin/operations?page=2&pageSize=2",
    200,
    undefined,
    owner.token,
  );
  assert.equal(operations.data.length, 2);
  assert.ok(operations.total > 10);
  const exported = await req(
    "/collection/admin/export",
    200,
    undefined,
    owner.token,
  );
  assert.ok(exported.actions.length > 10);
  const encoded = JSON.stringify({ exported, history });
  assert.doesNotMatch(
    encoded,
    /passwordHash|private_key|refreshToken|tokenHash|qrTokenHash|AdminSpecSecret!/,
  );
  assert.ok(
    !exported.users.some((u: { id: string }) => u.id === foreign.user.id),
  );
  assert.equal(
    await db.auditLog.count({
      where: {
        organizationId: otherId,
        action: { startsWith: "collection.admin." },
      },
    }),
    0,
  );
});
