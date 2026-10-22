import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import * as argon2 from "argon2";
import { writeFileSync } from "fs";
import { PrismaService } from "../src/prisma/prisma.service";
import { LedgerService } from "../src/ledger/ledger.service";
import { ProcessingService } from "../src/processing/processing.service";
import { TrackingService } from "../src/collection/tracking.service";
import { CurrentUser } from "../src/common/current-user.decorator";
import { initializeRoles } from "../prisma/roles";
import { PageDto } from "../src/common/page.dto";
const enabled = process.env.COLLECTION_INTEGRATION === "1";
test(
  "isolated physical workflow and tracking preserve material, provenance and permissions",
  { skip: !enabled },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        ["5432", "5544"].includes(url.port) &&
        url.pathname.endsWith("_spec"),
      "Only the explicitly isolated local test database is allowed",
    );
    const p = new PrismaService();
    await p.$connect();
    try {
      await initializeRoles(p);
      const tag = Date.now().toString();
      const org = await p.organization.create({
        data: { name: "Collection isolated " + tag },
      });
      const party = await p.counterparty.create({
        data: { organizationId: org.id, name: "Поставщик " + tag },
      });
      const site = await p.extractionSite.create({
        data: { organizationId: org.id, name: "Место сбора " + tag },
      });
      const raw = await p.materialType.create({
        data: { name: "Материал " + tag },
      });
      const product = await p.productType.create({
        data: { name: "Готовое " + tag },
      });
      const warehouses = await Promise.all(
        ["Мойка", "Завод", "Готовая продукция"].map((name, i) =>
          p.warehouse.create({
            data: {
              organizationId: org.id,
              name,
              warehouseType: i === 2 ? "FINISHED" : "RAW",
            },
          }),
        ),
      );
      const password = "SyntheticWorkflow_2026!";
      const pass = await argon2.hash(password);
      let index = 0;
      const accounts: Record<string, any> = {};
      async function actor(code: string) {
        const role = await p.role.findUniqueOrThrow({ where: { code } });
        const phone =
          "+7" + String(Number(tag.slice(-10)) + index++).padStart(10, "0");
        const account = await p.user.create({
          data: {
            organizationId: org.id,
            phone,
            fullName: "Тест " + code,
            passwordHash: pass,
            mustChangePassword: false,
            accessAllObjects: code === "OWNER",
            counterpartyScopeId: code === "COLLECTOR" ? party.id : null,
            extractionScopeIds: code === "COLLECTOR" ? [site.id] : [],
            warehouseScopeIds: warehouses.map((w) => w.id),
            userRoles: { create: { roleId: role.id } },
          },
        });
        const hydrated = await p.user.findUniqueOrThrow({
          where: { id: account.id },
          include: {
            userRoles: {
              include: {
                role: {
                  include: { permissions: { include: { permission: true } } },
                },
              },
            },
          },
        });
        accounts[code] = { id: account.id, phone, password };
        return {
          id: account.id,
          organizationId: org.id,
          roles: [code],
          permissions: hydrated.userRoles.flatMap((r) =>
            r.role.permissions.map((v) => v.permission.code),
          ),
          accessAllObjects: code === "OWNER",
          counterpartyScopeId: hydrated.counterpartyScopeId,
          warehouseScopeIds: hydrated.warehouseScopeIds,
          extractionScopeIds: hydrated.extractionScopeIds,
        } satisfies CurrentUser;
      }
      const owner = await actor("OWNER"),
        collector = await actor("COLLECTOR"),
        lab = await actor("LAB_TECHNICIAN"),
        receiver = await actor("WASH_RECEIVER"),
        wash = await actor("WASH_OPERATOR"),
        plant = await actor("DRYING_OPERATOR"),
        finished = await actor("FINISHED_RECEIVER"),
        packer = await actor("PACKER"),
        sales = await actor("SALES_STOREKEEPER");
      const ledger = new LedgerService(p),
        processing = new ProcessingService(p),
        tracking = new TrackingService(p);
      const key = () => randomUUID();
      const driver = (await ledger.createCollectorDriver(
        {
          idempotencyKey: key(),
          fullName: "Тест водитель",
          phone: "+7" + String(Number(tag.slice(-10)) + 100),
          counterpartyId: party.id,
        },
        collector,
      )) as any;
      const driverUser = await p.user.findUniqueOrThrow({
        where: { id: driver.userId },
      });
      assert(driverUser.mustChangePassword);
      assert(await argon2.verify(driverUser.passwordHash, "123456"));
      assert.equal(
        await p.user.count({
          where: {
            id: driver.userId,
            userRoles: { some: { role: { code: "DRIVER" } } },
          },
        }),
        1,
      );
      const vehicle = (await ledger.createCollectorVehicle(
        {
          idempotencyKey: key(),
          plateNumber: "T" + tag,
          brand: "Тест",
          type: "Грузовая",
          counterpartyId: party.id,
        },
        collector,
      )) as any;
      const dispatch = {
        idempotencyKey: key(),
        counterpartyId: party.id,
        extractionSiteId: site.id,
        materialTypeId: raw.id,
        vehicleId: vehicle.id,
        driverId: driver.id,
        destinationWarehouseId: warehouses[0].id,
        quantity: "10",
        bagCount: 100,
        measuredAt: new Date().toISOString(),
      };
      const trip = (await ledger.createCollection(dispatch, collector)) as any;
      assert.equal(
        ((await ledger.createCollection(dispatch, collector)) as any).id,
        trip.id,
      );
      assert.equal(
        await p.waybill.count({ where: { organizationId: org.id } }),
        1,
      );
      await assert.rejects(async () =>
        ledger.createCollection({ ...dispatch, idempotencyKey: key() }, packer),
      );
      await assert.rejects(async () =>
        ledger.createCollectorDriver(
          {
            idempotencyKey: key(),
            fullName: "Повтор",
            phone: driver.phone,
            counterpartyId: party.id,
          },
          collector,
        ),
      );
      const driverActor: CurrentUser = {
        id: driver.userId,
        organizationId: org.id,
        roles: ["DRIVER"],
        permissions: ["tracking.write", "notifications.read"],
        accessAllObjects: false,
      };
      assert.equal(
        (await tracking.trips(driverActor, new PageDto(), true)).total,
        1,
      );
      await assert.rejects(async () =>
        tracking.positions(
          trip.id,
          {
            points: [
              {
                id: key(),
                recordedAt: new Date().toISOString(),
                latitude: 43.2,
                longitude: 76.9,
                accuracy: 5,
              },
            ],
          },
          { ...driverActor, id: collector.id },
        ),
      );
      await tracking.status(trip.id, "IN_TRANSIT", driverActor);
      const now = Date.now();
      await p.waybill.update({
        where: { id: trip.id },
        data: {
          createdAt: new Date(now - 20 * 60000),
          departedAt: new Date(now - 15 * 60000),
        },
      });
      const points = Array.from({ length: 23 }, (_, i) => ({
        id: key(),
        recordedAt: new Date(now - 11 * 60000 + i * 30000).toISOString(),
        latitude: 43.2,
        longitude: 76.9,
        accuracy: 5,
      }));
      assert.equal(
        (await tracking.positions(trip.id, { points }, driverActor)).inserted,
        23,
      );
      assert.equal(
        (await tracking.positions(trip.id, { points }, driverActor)).inserted,
        0,
      );
      assert.equal(
        await p.notification.count({
          where: {
            organizationId: org.id,
            userId: collector.id,
            type: "DRIVER_IDLE",
          },
        }),
        1,
      );
      assert.equal(
        await p.notification.count({
          where: {
            organizationId: org.id,
            userId: owner.id,
            type: "DRIVER_IDLE",
          },
        }),
        1,
      );
      await tracking.checkStaleLocations(new Date(now + 11 * 60000));
      await tracking.checkStaleLocations(new Date(now + 12 * 60000));
      assert.equal(
        await p.notification.count({
          where: {
            organizationId: org.id,
            userId: collector.id,
            type: "DRIVER_GPS_STALE",
          },
        }),
        1,
      );
      const route: any = await tracking.route(
        trip.id,
        new PageDto(),
        collector,
      );
      assert.equal(route.total, 23);
      assert(route.metrics.stoppedSeconds >= 660);
      await tracking.status(trip.id, "ARRIVED", driverActor);
      await assert.rejects(async () =>
        tracking.positions(
          trip.id,
          {
            points: [
              {
                id: key(),
                recordedAt: new Date(Date.now() + 1000).toISOString(),
                latitude: 43.2,
                longitude: 76.9,
                accuracy: 5,
              },
            ],
          },
          driverActor,
        ),
      );
      const scan = await processing.scan(trip.qrToken, receiver);
      assert.equal(scan.batch.id, trip.batchId);
      await processing.receive(
        trip.id,
        {
          idempotencyKey: key(),
          warehouseId: warehouses[0].id,
          quantity: "10",
          bagCount: 100,
        },
        receiver,
      );
      const labDto = {
        idempotencyKey: key(),
        batchId: trip.batchId,
        moisturePercent: "25",
        sedimentPercent: "2",
        actualBagCount: 98,
        measuredAt: new Date().toISOString(),
      };
      await processing.laboratory(labDto, lab);
      await processing.laboratory(labDto, lab);
      assert.equal(
        (
          await p.materialBatch.findUniqueOrThrow({
            where: { id: trip.batchId },
          })
        ).initialQuantity.toString(),
        "10",
      );
      assert.equal(
        (
          await p.materialBatch.findUniqueOrThrow({
            where: { id: trip.batchId },
          })
        ).actualCollectedQuantity!.toString(),
        "9.8",
      );
      assert.equal(
        (
          await p.batchStock.findUniqueOrThrow({
            where: {
              batchId_warehouseId: {
                batchId: trip.batchId,
                warehouseId: warehouses[0].id,
              },
            },
          })
        ).quantity.toString(),
        "9.8",
      );
      const pre: any = await processing.process(
        {
          idempotencyKey: key(),
          kind: "PREWASH",
          batchIds: [trip.batchId],
          fromWarehouseId: warehouses[0].id,
          toWarehouseId: warehouses[0].id,
          outputWeights: ["7.350"],
        },
        wash,
      );
      assert.equal(pre.run.coefficientPercent, "25");
      assert.equal(pre.run.deviation, "NORMAL");
      await assert.rejects(async () =>
        processing.laboratory({ ...labDto, idempotencyKey: key() }, lab),
      );
      const washed: any = await processing.process(
        {
          idempotencyKey: key(),
          kind: "WASHING",
          batchIds: [pre.outputs[0].id],
          fromWarehouseId: warehouses[0].id,
          toWarehouseId: warehouses[0].id,
          outputWeights: ["3.675", "3.675"],
        },
        wash,
      );
      assert.equal(washed.outputs.length, 2);
      assert.notEqual(washed.outputs[0].qrToken, washed.outputs[1].qrToken);
      // One bag may be sold straight after washing without going through the plant.
      const sale: any = await processing.sell(
        {
          idempotencyKey: key(),
          batchIds: [washed.outputs[0].id],
          warehouseId: warehouses[0].id,
          recipient: "Тест покупатель",
          documentNumber: "SALE-" + tag,
        },
        sales,
      );
      assert.equal(sale.count, 1);
      await assert.rejects(async () =>
        processing.sell(
          {
            idempotencyKey: key(),
            batchIds: [washed.outputs[0].id],
            warehouseId: warehouses[0].id,
            recipient: "Тест",
            documentNumber: "DUP",
          },
          sales,
        ),
      );
      await processing.factoryIntake(
        washed.outputs[1].id,
        { idempotencyKey: key(), warehouseId: warehouses[1].id },
        plant,
      );
      const inFactory: any = await processing.overview(owner);
      assert.equal(
        inFactory.currentStages
          .find((s: any) => s.label === "На заводе в обработке")
          .quantity.toString(),
        "3.675",
      );
      assert.equal(
        inFactory.currentStages
          .find((s: any) => s.label === "Мытое: ожидает завода или продажи")
          .quantity.toString(),
        "0",
      );
      const dry: any = await processing.process(
        {
          idempotencyKey: key(),
          kind: "DRYING",
          batchIds: [washed.outputs[1].id],
          fromWarehouseId: warehouses[1].id,
          toWarehouseId: warehouses[1].id,
          outputWeights: ["1.176", "1.176"],
          productTypeId: product.id,
        },
        plant,
      );
      assert.equal(dry.run.coefficientPercent, "36");
      assert.equal(dry.run.deviation, "NORMAL");
      const receiveDto = {
        idempotencyKey: key(),
        warehouseId: warehouses[2].id,
      };
      await processing.receiveBag(dry.outputs[0].id, receiveDto, finished);
      await processing.receiveBag(
        dry.outputs[0].id,
        { ...receiveDto, idempotencyKey: key() },
        finished,
      );
      assert.equal(
        (
          await p.batchStock.findUniqueOrThrow({
            where: {
              batchId_warehouseId: {
                batchId: dry.outputs[0].id,
                warehouseId: warehouses[2].id,
              },
            },
          })
        ).quantity.toString(),
        "1.176",
      );
      const packDto = {
        idempotencyKey: key(),
        workDate: new Date().toISOString().slice(0, 10),
        shift: "Дневная",
      };
      await processing.pack(dry.outputs[0].id, packDto, packer);
      await processing.pack(
        dry.outputs[0].id,
        { ...packDto, idempotencyKey: key() },
        packer,
      );
      const stats = await processing.packingStats(
        packer,
        packDto.workDate,
        packDto.workDate,
      );
      assert.equal(stats[0]._count._all, 1);
      const trace: any = await processing.trace(dry.outputs[0].id, owner);
      assert.equal(trace.root.id, trip.batchId);
      assert.equal(trace.runs.length, 3);
      assert.equal(trace.summary.normTotalLossPercent, 51);
      assert.equal(trace.summary.washedSold.toString(), "3.675");
      assert.equal(trace.summary.comparisonComplete, false);
      const overview: any = await processing.overview(owner);
      assert.equal(overview.packedBigBags, 1);
      assert.equal(overview.collected.toString(), "10");
      assert.equal(overview.soldWashed.toString(), "3.675");
      await assert.rejects(async () =>
        processing.scan(washed.outputs[0].qrToken, {
          ...receiver,
          organizationId: "wrong",
        }),
      );
      await assert.rejects(async () =>
        processing.scan(washed.outputs[0].qrToken, {
          ...receiver,
          warehouseScopeIds: [],
        }),
      );
      const deviationTrip = (await ledger.createCollection(
        { ...dispatch, idempotencyKey: key() },
        collector,
      )) as any;
      await processing.receive(
        deviationTrip.id,
        {
          idempotencyKey: key(),
          warehouseId: warehouses[0].id,
          quantity: "10",
          bagCount: 100,
        },
        receiver,
      );
      await processing.laboratory(
        {
          ...labDto,
          idempotencyKey: key(),
          batchId: deviationTrip.batchId,
          sedimentPercent: "0",
          actualBagCount: 100,
        },
        lab,
      );
      const boundary: any = await processing.process(
        {
          idempotencyKey: key(),
          kind: "PREWASH",
          batchIds: [deviationTrip.batchId],
          fromWarehouseId: warehouses[0].id,
          toWarehouseId: warehouses[0].id,
          outputWeights: ["7.300"],
        },
        wash,
      );
      assert.equal(boundary.run.coefficientPercent, "27");
      assert.equal(boundary.run.deviation, "NORMAL");
      const boundaryWash: any = await processing.process(
        {
          idempotencyKey: key(),
          kind: "WASHING",
          batchIds: [boundary.outputs[0].id],
          fromWarehouseId: warehouses[0].id,
          toWarehouseId: warehouses[0].id,
          outputWeights: ["7.300"],
        },
        wash,
      );
      await processing.factoryIntake(
        boundaryWash.outputs[0].id,
        { idempotencyKey: key(), warehouseId: warehouses[1].id },
        plant,
      );
      const abnormal = {
        idempotencyKey: key(),
        kind: "DRYING" as const,
        batchIds: [boundaryWash.outputs[0].id],
        fromWarehouseId: warehouses[1].id,
        toWarehouseId: warehouses[1].id,
        outputWeights: ["4.526"],
        productTypeId: product.id,
      };
      await assert.rejects(async () => processing.process(abnormal, plant));
      await assert.rejects(async () =>
        processing.process(
          { ...abnormal, idempotencyKey: key(), outputWeights: ["4.818"] },
          plant,
        ),
      );
      assert.equal(
        (
          await p.batchStock.findUniqueOrThrow({
            where: {
              batchId_warehouseId: {
                batchId: boundaryWash.outputs[0].id,
                warehouseId: warehouses[1].id,
              },
            },
          })
        ).quantity.toString(),
        "7.3",
      );
      const abnormalResult: any = await processing.process(
        { ...abnormal, reason: "Контрольное отклонение теста" },
        plant,
      );
      assert.equal(abnormalResult.run.coefficientPercent, "38");
      assert.equal(abnormalResult.run.deviation, "ABOVE");
      const routeTrip = (await ledger.createCollection(
        { ...dispatch, idempotencyKey: key(), quantity: "1", bagCount: 10 },
        collector,
      )) as any;
      await tracking.status(routeTrip.id, "IN_TRANSIT", driverActor);
      await p.waybill.update({
        where: { id: routeTrip.id },
        data: {
          createdAt: new Date(Date.now() - 20 * 60000),
          departedAt: new Date(Date.now() - 15 * 60000),
        },
      });
      await tracking.positions(
        routeTrip.id,
        {
          points: Array.from({ length: 12 }, (_, i) => ({
            id: key(),
            recordedAt: new Date(Date.now() - (11 - i) * 30000).toISOString(),
            latitude: 43.2 + i * 0.001,
            longitude: 76.9 + i * 0.001,
            accuracy: 5,
          })),
        },
        driverActor,
      );
      if (process.env.COLLECTION_FIXTURE_FILE)
        writeFileSync(
          process.env.COLLECTION_FIXTURE_FILE,
          JSON.stringify({
            accounts,
            driver: {
              id: driver.userId,
              phone: driver.phone,
              password: "123456",
            },
            orgId: org.id,
            partyId: party.id,
            siteId: site.id,
            materialTypeId: raw.id,
            productTypeId: product.id,
            warehouses,
            trip,
            routeTrip,
            washed,
            dry,
          }),
          { mode: 0o600 },
        );
      console.log(
        "PASS: roles, temp driver password, idempotent dispatch, scoped telemetry, idle/stale alerts, original weights, lab sediment, prewash 25%, separate QR bags, washed sale, plant 36%, warehouse/packing dedup, ownership and trace",
      );
    } finally {
      await p.$disconnect();
    }
  },
);
