import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import JSZip from "jszip";

const base = process.env.ACCEPTANCE_API_URL ?? "http://localhost:4100/api/v1";
const db = process.env.DATABASE_URL ?? "";
if (!new URL(db).pathname.endsWith("_spec"))
  throw new Error("Acceptance tests require a dedicated *_spec database");
const prisma = new PrismaClient();
let token = "";
const key = () => randomUUID();
async function api(
  path: string,
  data?: unknown,
  expected = 200,
  overrideToken = token,
) {
  const response = await fetch(base + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      ...(overrideToken ? { Authorization: `Bearer ${overrideToken}` } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(body)}`);
  return body;
}
async function file() {
  const data = Buffer.from("%PDF-1.4\nBIOFLOW acceptance fixture\n%%EOF\n");
  const result = await api(
    "/files/upload-url",
    { fileName: "test.pdf", mimeType: "application/pdf", size: data.length },
    201,
  );
  const upload = await fetch(result.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: data,
  });
  assert.ok(upload.ok, `S3 upload ${upload.status}: ${await upload.text()}`);
  await api(`/files/${result.file.id}/complete`, {}, 201);
  return result.file.id;
}

test("BIOFLOW specification AT 01–13 on PostgreSQL and private S3", async (t) => {
  t.after(() => prisma.$disconnect());
  const run = key();
  const org = await prisma.organization.create({ data: { name: `AT ${run}` } });
  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { code: "OWNER" },
  });
  const password = "Acceptance123!";
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `${run}@bioflow.test`,
      fullName: "Acceptance owner",
      passwordHash: await argon2.hash(password),
      userRoles: { create: { roleId: ownerRole.id } },
    },
  });
  token = (await api("/auth/login", { email: user.email, password }, 201, ""))
    .accessToken;
  const counterparty = await prisma.counterparty.create({
    data: { organizationId: org.id, name: "AT contractor" },
  });
  const site = await prisma.extractionSite.create({
    data: { organizationId: org.id, name: "AT lake" },
  });
  const material = await prisma.materialType.create({
    data: { name: `AT material ${run}` },
  });
  const product = await prisma.productType.create({
    data: { name: `AT product ${run}` },
  });
  const warehouse = await prisma.warehouse.create({
    data: {
      organizationId: org.id,
      name: "AT raw",
      capacity: "100",
      lowStockLimit: "1",
    },
  });
  const target = await prisma.warehouse.create({
    data: { organizationId: org.id, name: "AT finished", capacity: "100" },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      organizationId: org.id,
      counterpartyId: counterparty.id,
      type: "Truck",
      brand: "AT",
      plateNumber: run,
      capacity: "20",
      tareWeight: "2",
    },
  });
  let batch: any, trip: any, washed: any, finished: any;
  const operation = (
    kind: string,
    inputs: Array<{ batchId: string; quantity: string }>,
    extras = {},
  ) => ({
    kind,
    inputs,
    fromWarehouseId: warehouse.id,
    idempotencyKey: key(),
    ...extras,
  });
  async function createAndConfirm(data: unknown) {
    const op = await api("/ledger/operations", data, 201);
    return api(
      `/ledger/operations/${op.id}/confirm`,
      { idempotencyKey: key() },
      201,
    );
  }

  await t.test(
    "UI regression — notifications and audit keep their own routes",
    async () => {
      assert.ok(Array.isArray((await api("/notifications")).data));
      assert.ok(Array.isArray((await api("/audit")).data));
    },
  );
  await t.test(
    "UI regression — settings accept valid values and reject negative thresholds",
    async () => {
      const setting = await api(
        "/settings",
        {
          key: "acceptance.differenceThresholdPercent",
          value: 4,
          reason: "Acceptance regression",
        },
        201,
      );
      assert.equal(setting.value, 4);
      await api(
        "/settings",
        { key: "acceptance.differenceThresholdPercent", value: -1 },
        400,
      );
      await api(
        "/settings",
        {
          key: "acceptance.differenceThresholdPercent",
          value: 3,
          reason: "Restore test default",
        },
        201,
      );
    },
  );
  await t.test(
    "UI regression — missing fields and duplicate plates are client errors",
    async () => {
      await api("/counterparties", { data: {} }, 400);
      await api(
        "/vehicles",
        {
          data: {
            plateNumber: vehicle.plateNumber,
            brand: "AT",
            type: "Truck",
          },
        },
        409,
      );
    },
  );

  await t.test(
    "AT 01 — source batch, number, QR and available quantity",
    async () => {
      batch = await api(
        "/ledger/batches",
        {
          counterpartyId: counterparty.id,
          extractionSiteId: site.id,
          materialTypeId: material.id,
          quantity: "30",
          measurementMethod: "Manual scale",
          measuredAt: new Date().toISOString(),
          idempotencyKey: key(),
        },
        201,
      );
      assert.ok(batch.number && batch.qrToken);
      assert.equal(batch.availableSourceQuantity, "30");
      await api(
        `/ledger/batches/${batch.id}/confirm`,
        { reason: "AT confirmation", idempotencyKey: key() },
        201,
      );
    },
  );
  await t.test(
    "AT 02 — split batches, reject over-allocation and concurrent overspend",
    async () => {
      const input = {
        batchId: batch.id,
        vehicleId: vehicle.id,
        destinationWarehouseId: warehouse.id,
        quantity: "10",
        documentDate: new Date().toISOString(),
        idempotencyKey: key(),
      };
      trip = await api("/ledger/waybills", input, 201);
      const second = await api(
        "/ledger/waybills",
        { ...input, quantity: "5", idempotencyKey: key() },
        201,
      );
      await api(
        "/ledger/waybills",
        { ...input, quantity: "16", idempotencyKey: key() },
        409,
      );
      await api(
        `/ledger/waybills/${second.id}/status`,
        {
          status: "CANCELLED",
          reason: "AT unused trip",
          idempotencyKey: key(),
        },
        201,
      );
      const results = await Promise.all(
        [1, 2].map(() =>
          fetch(base + "/ledger/waybills", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ...input,
              quantity: "15",
              idempotencyKey: key(),
            }),
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      for (const r of results) {
        const b = await r.json();
        if (r.status === 201)
          await api(
            `/ledger/waybills/${b.id}/status`,
            {
              status: "CANCELLED",
              reason: "AT concurrent cleanup",
              idempotencyKey: key(),
            },
            201,
          );
      }
    },
  );
  await t.test(
    "AT 03 — real document upload, gross/tare/net, capacity and invalid weight",
    async () => {
      const attachment = await file();
      await api(
        `/ledger/waybills/${trip.id}/load`,
        {
          grossWeight: "2",
          tareWeight: "2",
          fileIds: [attachment],
          idempotencyKey: key(),
        },
        400,
      );
      await api(
        `/ledger/waybills/${trip.id}/load`,
        {
          grossWeight: "24",
          tareWeight: "2",
          fileIds: [attachment],
          idempotencyKey: key(),
        },
        400,
      );
      const loaded = await api(
        `/ledger/waybills/${trip.id}/load`,
        {
          grossWeight: "12",
          tareWeight: "2",
          fileIds: [attachment],
          idempotencyKey: key(),
        },
        201,
      );
      assert.equal(loaded.declaredWeight, "10");
      assert.equal(loaded.status, "LOADED");
      await api(
        `/ledger/waybills/${trip.id}/status`,
        { status: "IN_TRANSIT", idempotencyKey: key() },
        201,
      );
      await api(
        `/ledger/waybills/${trip.id}/status`,
        { status: "ARRIVED", idempotencyKey: key() },
        201,
      );
    },
  );
  await t.test(
    "AT 04 — QR opens linked batch, vehicle and transport",
    async () => {
      const resolved = await api(
        "/ledger/qr/resolve",
        { token: trip.qrToken },
        201,
      );
      assert.equal(resolved.batch.id, batch.id);
      assert.equal(resolved.vehicle.id, vehicle.id);
      await api("/ledger/qr/resolve", { token: "unknown" }, 404);
    },
  );
  await t.test(
    "AT 05 — discrepancy reason and idempotent receipt",
    async () => {
      const attachment = await file();
      const body = {
        warehouseId: warehouse.id,
        grossWeight: "11",
        tareWeight: "2",
        fileIds: [attachment],
        idempotencyKey: key(),
      };
      await api(`/ledger/waybills/${trip.id}/receipt`, body, 400);
      const accepted = await api(
        `/ledger/waybills/${trip.id}/receipt`,
        { ...body, reason: "AT 10% discrepancy" },
        201,
      );
      assert.equal(accepted.difference, "-1");
      assert.equal(accepted.differencePercent, "-10.000");
      const repeated = await api(
        `/ledger/waybills/${trip.id}/receipt`,
        { ...body, reason: "AT 10% discrepancy" },
        201,
      );
      assert.deepEqual(repeated, accepted);
      assert.equal((await api("/ledger/stocks")).length, 0);
    },
  );
  await t.test(
    "AT 06 — stock only after unload; no duplicate receipt",
    async () => {
      const body = { idempotencyKey: key() };
      await api(`/ledger/waybills/${trip.id}/unload`, body, 201);
      await api(`/ledger/waybills/${trip.id}/unload`, body, 201);
      await api(
        `/ledger/waybills/${trip.id}/unload`,
        { idempotencyKey: key() },
        409,
      );
      assert.equal((await api("/ledger/stocks"))[0].quantity, "9");
    },
  );
  await t.test(
    "AT 07 — confirmed transfer and reversal preserve batch identity",
    async () => {
      const transfer = await createAndConfirm(
        operation("TRANSFER", [{ batchId: batch.id, quantity: "1" }], {
          toWarehouseId: target.id,
        }),
      );
      const rows = await api("/ledger/stocks");
      assert.equal(
        rows.find((x: any) => x.warehouseId === target.id).quantity,
        "1",
      );
      await api(
        `/ledger/operations/${transfer.id}/cancel`,
        { reason: "AT reverse transfer", idempotencyKey: key() },
        201,
      );
      assert.equal(
        (await api("/ledger/stocks")).find(
          (x: any) => x.warehouseId === warehouse.id,
        ).quantity,
        "9",
      );
    },
  );
  await t.test(
    "AT 08 — washing balances and creates linked output lot",
    async () => {
      const op = await createAndConfirm(
        operation("WASHING", [{ batchId: batch.id, quantity: "6" }], {
          outputQuantity: "5",
          wasteQuantity: "0.5",
          lossQuantity: "0.5",
          toWarehouseId: warehouse.id,
          shift: "AT day",
        }),
      );
      washed = op.outputBatch;
      assert.equal(washed.state, "WASHED");
    },
  );
  await t.test(
    "AT 09 — production requires material balance and creates FINISHED lot",
    async () => {
      const invalid = await api(
        "/ledger/operations",
        operation("PRODUCTION", [{ batchId: washed.id, quantity: "5" }], {
          outputQuantity: "3",
          wasteQuantity: "0.5",
          lossQuantity: "0.5",
          productTypeId: product.id,
          toWarehouseId: warehouse.id,
          shift: "AT day",
        }),
        201,
      );
      await api(
        `/ledger/operations/${invalid.id}/confirm`,
        { idempotencyKey: key() },
        400,
      );
      const op = await createAndConfirm(
        operation("PRODUCTION", [{ batchId: washed.id, quantity: "5" }], {
          outputQuantity: "4",
          wasteQuantity: "0.5",
          lossQuantity: "0.5",
          productTypeId: product.id,
          toWarehouseId: warehouse.id,
          shift: "AT day",
        }),
      );
      finished = op.outputBatch;
      assert.equal(finished.state, "FINISHED");
    },
  );
  await t.test(
    "AT 10 — finished → washed → source → lake/contractor/trip",
    async () => {
      const trace = await api(`/ledger/batches/${finished.id}/trace`);
      const source = trace.inputs[0].source.inputs[0].source;
      assert.equal(source.batch.id, batch.id);
      assert.equal(source.batch.extractionSiteId, site.id);
      assert.equal(source.batch.counterpartyId, counterparty.id);
      assert.equal(source.trips[0].vehicle.id, vehicle.id);
    },
  );
  await t.test(
    "AT 11 — historical balances, totals, CSV/XLSX/PDF export",
    async () => {
      const report = await api("/ledger/reports/inventory");
      assert.equal(
        report.rows.find((r: any) => r.batchId === finished.id).closing,
        "4",
      );
      const historical = await api(
        "/ledger/reports/inventory?dateTo=2000-01-01",
      );
      assert.equal(historical.rows.length, 0);
      for (const format of ["csv", "xlsx", "pdf"]) {
        const res = await fetch(
          base + `/ledger/reports/inventory/export?format=${format}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        assert.equal(res.status, 200);
        const data = Buffer.from(await res.arrayBuffer());
        assert.ok(data.length > 20);
        if (format === "xlsx")
          assert.ok(
            (await JSZip.loadAsync(data)).file("xl/worksheets/sheet1.xml"),
          );
        if (format === "pdf")
          assert.equal(data.subarray(0, 4).toString(), "%PDF");
        if (format === "csv") assert.ok(data.toString().includes(finished.id));
      }
    },
  );
  await t.test(
    "AT 12 — object assignments deny unassigned warehouse and legacy routes",
    async () => {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: "WAREHOUSE_OPERATOR" },
      });
      const restricted = await prisma.user.create({
        data: {
          organizationId: org.id,
          email: `restricted-${run}@bioflow.test`,
          fullName: "Assigned keeper",
          passwordHash: await argon2.hash(password),
          warehouseScopeIds: [target.id],
          userRoles: { create: { roleId: role.id } },
        },
      });
      const restrictedToken = (
        await api("/auth/login", { email: restricted.email, password }, 201, "")
      ).accessToken;
      await api(
        `/ledger/stocks?warehouseId=${warehouse.id}`,
        undefined,
        403,
        restrictedToken,
      );
      await api("/reports?type=inventory", undefined, 403, restrictedToken);
      await api(
        "/ledger/operations",
        operation("TRANSFER", [{ batchId: batch.id, quantity: "1" }], {
          toWarehouseId: target.id,
        }),
        403,
        restrictedToken,
      );
      const visible = await api(
        "/ledger/stocks",
        undefined,
        200,
        restrictedToken,
      );
      assert.ok(visible.every((r: any) => r.warehouseId === target.id));
    },
  );
  await t.test(
    "AT 13 — audited correction and append-only SQL protection",
    async () => {
      const correction = await createAndConfirm(
        operation("CORRECTION", [{ batchId: batch.id, quantity: "-0.5" }], {
          reason: "AT physical recount",
        }),
      );
      const entry = await prisma.auditLog.findFirst({
        where: {
          organizationId: org.id,
          entityId: correction.id,
          action: "operation.confirm",
        },
      });
      assert.ok(entry);
      await assert.rejects(prisma.auditLog.delete({ where: { id: entry.id } }));
      const movement = await prisma.batchMovement.findFirstOrThrow({
        where: { operationId: correction.id },
      });
      await assert.rejects(
        prisma.batchOperation.delete({ where: { id: correction.id } }),
      );
      await assert.rejects(
        prisma.batchMovement.update({
          where: { id: movement.id },
          data: { quantity: "1000" },
        }),
      );
      await api(
        `/ledger/operations/${correction.id}/cancel`,
        { reason: "AT reverse correction", idempotencyKey: key() },
        201,
      );
    },
  );
  await t.test(
    "Additional — reserves, zero physical inventory, rollback and concurrent consumption",
    async () => {
      const reserve = await createAndConfirm({
        kind: "RESERVE",
        fromWarehouseId: warehouse.id,
        inputs: [{ batchId: batch.id, quantity: "2" }],
        idempotencyKey: key(),
      });
      const blocked = await api(
        "/ledger/operations",
        {
          kind: "WRITE_OFF",
          fromWarehouseId: warehouse.id,
          inputs: [{ batchId: batch.id, quantity: "2" }],
          reason: "AT reserved",
          idempotencyKey: key(),
        },
        201,
      );
      await api(
        `/ledger/operations/${blocked.id}/confirm`,
        { idempotencyKey: key() },
        409,
      );
      await createAndConfirm({
        kind: "RELEASE",
        fromWarehouseId: warehouse.id,
        inputs: [{ batchId: batch.id, quantity: "2" }],
        reason: "AT release",
        idempotencyKey: key(),
      });
      const inventory = await createAndConfirm({
        kind: "INVENTORY",
        fromWarehouseId: warehouse.id,
        inputs: [{ batchId: batch.id, quantity: "0" }],
        reason: "AT zero inventory",
        idempotencyKey: key(),
      });
      assert.equal(
        (await api("/ledger/stocks")).find(
          (x: any) => x.batchId === batch.id && x.warehouseId === warehouse.id,
        ).quantity,
        "0",
      );
      await api(
        `/ledger/operations/${inventory.id}/cancel`,
        { reason: "AT reversal", idempotencyKey: key() },
        201,
      );
      const commands = await Promise.all(
        [1, 2].map(() =>
          api(
            "/ledger/operations",
            {
              kind: "WRITE_OFF",
              fromWarehouseId: warehouse.id,
              inputs: [{ batchId: batch.id, quantity: "2" }],
              reason: "AT concurrent",
              idempotencyKey: key(),
            },
            201,
          ),
        ),
      );
      const results = await Promise.all(
        commands.map((o) =>
          fetch(base + `/ledger/operations/${o.id}/confirm`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ idempotencyKey: key() }),
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      for (const r of results)
        if (r.status === 201) {
          const o = await r.json();
          await api(
            `/ledger/operations/${o.id}/cancel`,
            { reason: "AT reversal", idempotencyKey: key() },
            201,
          );
        }
      assert.ok(reserve.id);
    },
  );
  await t.test(
    "Additional — contractor scope, export over 500 records and shipment/return accounting",
    async () => {
      const party2 = await prisma.counterparty.create({
        data: { organizationId: org.id, name: "AT other party" },
      });
      const privateBatch = await api(
        "/ledger/batches",
        {
          counterpartyId: party2.id,
          extractionSiteId: site.id,
          materialTypeId: material.id,
          quantity: "1",
          measurementMethod: "AT",
          measuredAt: new Date().toISOString(),
          idempotencyKey: key(),
        },
        201,
      );
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: "CONTRACTOR_REP" },
      });
      const contractor = await prisma.user.create({
        data: {
          organizationId: org.id,
          email: `party-${run}@bioflow.test`,
          fullName: "AT contractor",
          passwordHash: await argon2.hash(password),
          counterpartyScopeId: counterparty.id,
          warehouseScopeIds: [warehouse.id],
          userRoles: { create: { roleId: role.id } },
        },
      });
      const ct = (
        await api("/auth/login", { email: contractor.email, password }, 201, "")
      ).accessToken;
      const batches = await api("/ledger/batches", undefined, 200, ct);
      assert.ok(
        batches.data.every(
          (x: any) =>
            x.originCounterpartyIds.length === 1 &&
            x.originCounterpartyIds[0] === counterparty.id,
        ),
      );
      await api(`/ledger/batches/${privateBatch.id}/trace`, undefined, 404, ct);
      const shipped = await createAndConfirm({
        kind: "SHIPMENT",
        fromWarehouseId: warehouse.id,
        inputs: [{ batchId: finished.id, quantity: "1" }],
        recipient: "AT client",
        vehicleId: vehicle.id,
        documentNumber: "AT shipment",
        fileIds: [await file()],
        idempotencyKey: key(),
      });
      await createAndConfirm({
        kind: "RETURN",
        fromWarehouseId: warehouse.id,
        inputs: [{ batchId: finished.id, quantity: "0.5" }],
        reversesOperationId: shipped.id,
        reason: "AT customer return",
        idempotencyKey: key(),
      });
      await api(
        `/ledger/operations/${shipped.id}/cancel`,
        { reason: "AT returned shipment", idempotencyKey: key() },
        409,
      );
      const filtered = await api(
        `/ledger/reports/production?warehouseId=${target.id}`,
      );
      assert.equal(filtered.rows.length, 0);
      await prisma.auditLog.createMany({
        data: Array.from({ length: 603 }, (_, i) => ({
          organizationId: org.id,
          userId: user.id,
          action: `AT export ${i}`,
          entity: "AT",
          entityId: org.id,
        })),
      });
      const report = await api("/ledger/reports/audit");
      assert.ok(report.rows.length > 603);
      const exportResponse = await fetch(
        base + "/ledger/reports/audit/export?format=csv",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      assert.equal(exportResponse.status, 200);
      assert.match(await exportResponse.text(), /AT export 602/);
    },
  );
  await t.test(
    "Additional — partial receipt accumulates without premature stock and uploads remain private",
    async () => {
      const trip2 = await api(
        "/ledger/waybills",
        {
          batchId: batch.id,
          vehicleId: vehicle.id,
          destinationWarehouseId: warehouse.id,
          quantity: "3",
          documentDate: new Date().toISOString(),
          idempotencyKey: key(),
        },
        201,
      );
      const proof = await file();
      await api(
        `/ledger/waybills/${trip2.id}/load`,
        {
          grossWeight: "4",
          tareWeight: "1",
          fileIds: [proof],
          idempotencyKey: key(),
        },
        201,
      );
      await api(
        `/ledger/waybills/${trip2.id}/status`,
        { status: "IN_TRANSIT", idempotencyKey: key() },
        201,
      );
      await api(
        `/ledger/waybills/${trip2.id}/status`,
        { status: "ARRIVED", idempotencyKey: key() },
        201,
      );
      const receipt = {
        warehouseId: warehouse.id,
        grossWeight: "2",
        tareWeight: "1",
        partial: true,
        fileIds: [await file()],
        idempotencyKey: key(),
      };
      await api(`/ledger/waybills/${trip2.id}/receipt`, receipt, 201);
      await api(
        `/ledger/waybills/${trip2.id}/receipt`,
        { ...receipt, grossWeight: "3" },
        409,
      );
      const before = await api("/ledger/stocks");
      assert.equal(
        before.find(
          (x: any) => x.batchId === batch.id && x.warehouseId === warehouse.id,
        ).quantity,
        "3",
      );
      await api(
        `/ledger/waybills/${trip2.id}/receipt`,
        {
          ...receipt,
          partial: false,
          grossWeight: "3",
          fileIds: [await file()],
          idempotencyKey: key(),
        },
        201,
      );
      await api(
        `/ledger/waybills/${trip2.id}/unload`,
        { idempotencyKey: key() },
        201,
      );
      const after = await api("/ledger/stocks");
      assert.equal(
        after.find(
          (x: any) => x.batchId === batch.id && x.warehouseId === warehouse.id,
        ).quantity,
        "6",
      );
      const linked = await api(`/ledger/files/Waybill/${trip2.id}`);
      assert.equal(linked.length, 3);
    },
  );
});
