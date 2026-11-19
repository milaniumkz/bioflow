import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import { bootstrapCollection } from "../prisma/bootstrap-collection";
import {
  calculateCollectionLaboratory,
  assessDryingIntake,
  assessDryingOutput,
} from "@bioflow/shared-types";
const db = new PrismaClient(),
  api = process.env.COLLECTION_TEST_API ?? "http://127.0.0.1:4198/api/v1",
  key = () => randomUUID();
test("Owner dashboard and collector reports: exact quality totals, all entities, timezone edges, period/basis filters, pagination and tenant/role isolation", async (t) => {
  if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_spec"))
    throw Error("Isolated reporting database required");
  t.after(() => db.$disconnect());
  const org = "report-spec-" + key();
  process.env.COLLECTION_ORGANIZATION_ID = org;
  await bootstrapCollection(db);
  const foreignOrg = "report-foreign-" + key();
  process.env.COLLECTION_ORGANIZATION_ID = foreignOrg;
  await bootstrapCollection(db);
  process.env.COLLECTION_ORGANIZATION_ID = org;
  async function actor(role: string, organizationId = org, name = role) {
    const r = await db.role.findUniqueOrThrow({ where: { code: role } }),
      u = await db.user.create({
        data: {
          organizationId,
          fullName: "Report " + name,
          passwordHash: "not-login",
          userRoles: { create: { roleId: r.id } },
        },
      });
    return {
      ...u,
      token: await new JwtService().signAsync(
        { sub: u.id },
        { secret: process.env.JWT_ACCESS_SECRET ?? "dev-access" },
      ),
    };
  }
  const owner = await actor("OWNER"),
    admin = await actor("ADMIN"),
    collector = await actor("COLLECTOR"),
    second = await actor("COLLECTOR", org, "second"),
    manager = await actor("WAREHOUSE_MANAGER"),
    foreign = await actor("OWNER", foreignOrg),
    exCollector = await actor("FACTORY_MANAGER", org, "former collector");
  const sites = await db.collectionLocation.findMany({
      where: { organizationId: org },
    }),
    warehouse = sites.find((s) => s.code === "HELIOS")!,
    factory = sites.find((s) => s.code === "FACTORY-SEZ")!;
  const at = (s: string) => new Date(s),
    d = "2026-11-19T07:00:00Z",
    lab = calculateCollectionLaboratory("20000", {
      sedimentPercent: "6",
      moisturePercent: "37",
      colorPercent: "41",
    });
  async function trip(fields: Record<string, unknown> = {}) {
    return db.collectionTrip.create({
      data: {
        organizationId: org,
        number: "REPORT-" + key(),
        createdById: collector.id,
        warehouseId: warehouse.id,
        kind: "RAW",
        bagCount: 40,
        weightKg: "20000",
        qrTokenHash: key(),
        createdAt: at("2026-11-18T17:00:00Z"),
        arrivedAt: at("2026-11-18T19:00:00Z"),
        confirmedAt: at(d),
        status: "ACCEPTED",
        acceptedWeightKg: "19000",
        laboratory: lab,
        ...fields,
      } as any,
    });
  }
  const a = await trip(),
    b = await trip({
      createdAt: at(d),
      arrivedAt: at("2026-11-19T18:59:59.999Z"),
      confirmedAt: null,
      status: "ARRIVED",
      weightKg: "5000",
      acceptedWeightKg: null,
      laboratory: undefined,
    }),
    c = await trip({
      createdAt: at(d),
      arrivedAt: at("2026-11-19T19:00:00Z"),
      confirmedAt: at("2026-11-19T19:00:00Z"),
      weightKg: "1000",
      acceptedWeightKg: null,
      laboratory: undefined,
    }),
    cancelled = await trip({
      createdAt: at(d),
      arrivedAt: at(d),
      status: "CANCELLED",
      weightKg: "999",
    });
  const f = await trip({
      createdAt: at(d),
      arrivedAt: null,
      confirmedAt: null,
      status: "IN_TRANSIT",
      weightKg: "2000",
      acceptedWeightKg: null,
      laboratory: undefined,
    }),
    gp = await trip({
      kind: "GP",
      warehouseId: null,
      fromLocationId: factory.id,
      recipientName: "Report recipient",
      createdAt: at(d),
      arrivedAt: at(d),
      confirmedAt: null,
      status: "ARRIVED",
      weightKg: "500",
      acceptedWeightKg: null,
      laboratory: undefined,
    });
  for (const [tr, plate] of [
    [a, "REPORT 01"],
    [f, "REPORT 01"],
    [gp, "REPORT 02"],
  ] as const)
    await db.collectionDriverSession.create({
      data: {
        tripId: tr.id,
        tokenHash: key(),
        driverPhone: "+79998887766",
        driverPlate: plate,
        expiresAt: at("2027-01-01T00:00:00Z"),
      },
    });
  await trip({
    organizationId: foreignOrg,
    createdById: foreign.id,
    warehouseId: null,
    weightKg: "999999",
  });
  await trip({
    createdById: exCollector.id,
    weightKg: "5",
    acceptedWeightKg: null,
    laboratory: undefined,
  });
  await db.collectionTrip.createMany({
    data: Array.from({ length: 205 }, () => ({
      organizationId: org,
      number: "HISTORY-" + key(),
      createdById: second.id,
      warehouseId: warehouse.id,
      kind: "RAW",
      bagCount: 1,
      weightKg: "1.001",
      qrTokenHash: key(),
      createdAt: at("2026-11-01T00:00:00Z"),
      arrivedAt: at("2026-11-01T01:00:00Z"),
      confirmedAt: at("2026-11-01T02:00:00Z"),
      status: "ACCEPTED",
    })),
  });
  const intake = assessDryingIntake("3000", {
    sedimentPercent: "4",
    moisturePercent: "38",
    conductivity: "400",
    waterTransparent: true,
    colorCompliant: true,
    packagingCompliant: true,
  });
  await db.collectionShipment.create({
    data: {
      organizationId: org,
      number: "FACTORY-" + key(),
      fromLocationId: warehouse.id,
      toLocationId: factory.id,
      createdById: manager.id,
      bagCount: 6,
      weightKg: "3000",
      averageBagKg: "500",
      status: "ACCEPTED",
      acceptedWeightKg: "2850",
      laboratory: intake,
      createdAt: at(d),
      confirmedAt: at(d),
    },
  });
  const returnLab = assessDryingIntake("1000", {
    sedimentPercent: "3",
    moisturePercent: "35",
    conductivity: "401",
    waterTransparent: true,
    colorCompliant: true,
    packagingCompliant: true,
  });
  await db.collectionShipment.create({
    data: {
      organizationId: org,
      number: "RETURN-" + key(),
      fromLocationId: warehouse.id,
      toLocationId: factory.id,
      createdById: manager.id,
      bagCount: 2,
      weightKg: "1000",
      averageBagKg: "500",
      status: "RETURNED_TO_WASH",
      acceptedWeightKg: "0",
      laboratory: returnLab,
      createdAt: at(d),
      confirmedAt: at(d),
    },
  });
  const dry = {
    sedimentPercent: "5",
    moisturePercent: "0.5",
    conductivity: "400",
    waterTransparent: true,
    colorCompliant: true,
    bulkDensity: "450",
  };
  const production = await db.collectionAction.create({
    data: {
      organizationId: org,
      locationId: factory.id,
      createdById: manager.id,
      kind: "PRODUCTION",
      quantityKg: "1525",
      createdAt: at(d),
      details: { bags: [{ weightKg: "500", laboratory: dry }] },
    },
  });
  for (const [state, weight] of [
    ["FINISHED", "500"],
    ["REJECT", "525"],
    ["REDRY", "500"],
  ]) {
    const batch = await db.collectionBatch.create({
      data: {
        organizationId: org,
        locationId: factory.id,
        state,
        totalKg: weight,
        remainingKg: weight,
        bagCount: 1,
        sourceType: "PRODUCTION",
        sourceId: production.id,
        createdById: manager.id,
      },
    });
    await db.collectionBag.create({
      data: {
        batchId: batch.id,
        index: 1,
        weightKg: weight,
        laboratory: assessDryingOutput({
          ...dry,
          ...(state === "REJECT"
            ? { sedimentPercent: "6" }
            : state === "REDRY"
              ? { moisturePercent: "1" }
              : {}),
        }),
      },
    });
  }
  await db.collectionAction.createMany({
    data: [
      {
        organizationId: org,
        locationId: warehouse.id,
        createdById: manager.id,
        kind: "WASH",
        quantityKg: "3000",
        createdAt: at(d),
        details: {},
      },
      {
        organizationId: org,
        locationId: warehouse.id,
        createdById: owner.id,
        kind: "WEIGHT_CORRECTION",
        quantityKg: "0",
        createdAt: at(d),
        details: { tripId: a.id, reason: "Report test" },
      },
    ],
  });
  async function req(path: string, token: string, expected = 200) {
    const r = await fetch(api + path, {
        headers: { Authorization: "Bearer " + token },
      }),
      v = await r.json();
    assert.equal(r.status, expected, path + " " + JSON.stringify(v));
    return v;
  }
  for (const token of [collector.token, manager.token])
    for (const path of [
      "/collection/dashboard",
      "/collection/collectors",
      "/collection/collectors/" + collector.id,
    ])
      await req(path, token, 403);
  await req("/collection/collectors/" + collector.id, foreign.token, 404);
  await req("/collection/dashboard?from=2026-02-30", owner.token, 400);
  await req(
    "/collection/collectors?from=2026-11-20&to=2026-11-19",
    owner.token,
    400,
  );
  await req("/collection/dashboard?minKg=200&maxKg=100", owner.token, 400);
  const period = "from=2026-11-19&to=2026-11-19&basis=delivery";
  const report = await req(
    "/collection/collectors/" + collector.id + "?" + period,
    owner.token,
  );
  assert.equal(report.summary.deliveredKg, "25000");
  assert.equal(report.summary.laboratoryKg, "20000");
  assert.equal(report.summary.deductionKg, "1000");
  assert.equal(report.summary.acceptedKg, "19000");
  assert.equal(report.summary.pendingLabKg, "5000");
  assert.equal(report.summary.cancelledCount, 1);
  assert.equal(report.total, 3);
  assert.equal(report.days[0].day, "2026-11-19");
  assert(
    report.shipments.some(
      (s: any) => s.id === a.id && s.laboratory.sedimentPercent === "6",
    ),
  );
  assert(!report.shipments.some((s: any) => s.id === c.id));
  assert(!JSON.stringify(report).includes("qrTokenHash"));
  const allCollector = await req(
    "/collection/collectors/" + collector.id,
    owner.token,
  );
  assert.equal(allCollector.total, 5);
  assert.equal(allCollector.summary.pendingTransitKg, "2000");
  assert(allCollector.days.some((d: any) => d.day === "pending"));
  const plate = await req(
    "/collection/dashboard?driverPlate=report01",
    owner.token,
  );
  assert.equal(plate.summary.driverTrips, 2);
  const history = await req(
    "/collection/collectors/" + second.id + "?page=11&pageSize=20",
    admin.token,
  );
  assert.equal(history.total, 205);
  assert.equal(history.shipments.length, 5);
  assert.equal(history.summary.acceptedKg, "205.205");
  assert.equal(history.summary.legacyCount, 205);
  const directory = await req("/collection/collectors", owner.token);
  assert(directory.collectors.some((u: any) => u.id === exCollector.id));
  assert(!directory.collectors.some((u: any) => u.id === foreign.id));
  const dashboard = await req("/collection/dashboard", owner.token);
  assert.equal(dashboard.summary.driverTrips, 3);
  assert.equal(dashboard.summary.driverDelivered, 2);
  assert.equal(dashboard.summary.driverActive, 1);
  assert.equal(dashboard.summary.factoryAcceptedKg, "2850");
  assert.equal(dashboard.summary.factoryReturnedKg, "1000");
  assert.equal(dashboard.summary.finishedKg, "500");
  assert.equal(dashboard.summary.rejectedKg, "525");
  assert.equal(dashboard.summary.redryKg, "500");
  assert.equal(dashboard.options.drivers.length, 1);
  assert.deepEqual(dashboard.options.drivers[0].plates.sort(), [
    "REPORT 01",
    "REPORT 02",
  ]);
  assert(!JSON.stringify(dashboard).includes("qrTokenHash"));
  assert(!JSON.stringify(dashboard).includes("tokenHash"));
  assert(!JSON.stringify(dashboard).includes(foreign.id));
  const own = await req(
    "/collection/dashboard?collectorId=" + collector.id + "&" + period,
    owner.token,
  );
  assert.equal(own.summary.rawAcceptedKg, "19000");
  assert.equal(own.summary.rawDeliveredKg, "25000");
  assert.equal(own.summary.rawDeductionKg, "1000");
  assert.equal(own.summary.factoryAcceptedKg, "0");
  assert.equal(own.stock.length, 0);
  const fac = await req(
    "/collection/dashboard?factoryId=" + factory.id,
    owner.token,
  );
  assert.equal(fac.summary.rawAcceptedKg, "0");
  assert.equal(fac.summary.factoryAcceptedKg, "2850");
  assert.equal(fac.summary.finishedKg, "500");
  assert(fac.stock.every((s: any) => s.locationId === factory.id));
  assert(
    fac.events.find((e: any) => e.kind === "PRODUCTION").bags.length === 3,
  );
  const driver = await req(
    "/collection/dashboard?driverPhone=%2B79998887766",
    owner.token,
  );
  assert.equal(driver.summary.driverTrips, 3);
  assert.equal(driver.summary.rawAcceptedKg, "19000");
  assert.equal(driver.summary.gpDeliveredKg, "500");
  assert.equal(driver.stock.length, 0);
  const washed = await req(
    "/collection/dashboard?warehouseId=" + warehouse.id + "&kind=WASH",
    owner.token,
  );
  assert.equal(washed.summary.washedKg, "3000");
  assert.equal(washed.events.length, 1);
  const one = await req(
    "/collection/dashboard?kind=RAW&status=ACCEPTED&laboratory=checked&minKg=20000&maxKg=20000",
    owner.token,
  );
  assert.equal(one.total, 1);
  assert.equal(one.events[0].id, a.id);
  const empty = await req(
    "/collection/dashboard?collectorId=" + foreign.id,
    owner.token,
  );
  assert.equal(empty.total, 0);
  assert.equal(empty.summary.rawAcceptedKg, "0");
  const checked = await req(
    "/collection/dashboard?kind=PRODUCTION&laboratory=checked",
    owner.token,
  );
  assert.equal(checked.total, 1);
  assert.equal(checked.events[0].id, production.id);
  const last = await req(
    "/collection/dashboard?kind=RAW&collectorId=" +
      second.id +
      "&page=3&pageSize=100",
    owner.token,
  );
  assert.equal(last.total, 205);
  assert.equal(last.events.length, 5);
  assert.equal(last.summary.rawAcceptedKg, "205.205");
});
