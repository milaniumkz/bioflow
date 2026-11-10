// Real legacy ledger operations; disposable local database and private S3 only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { randomUUID } = require("node:crypto");
const base = process.env.BIOFLOW_UI_URL || "http://localhost:3015",
  api = process.env.BIOFLOW_API_URL || "http://localhost:4102/api/v1";
for (const u of [base, api])
  assert(["localhost", "127.0.0.1"].includes(new URL(u).hostname));
let token, page, browser;
const result = [];
async function call(path, body) {
  const r = await fetch(api + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const b = await r.json();
  assert(r.ok, JSON.stringify({ path, status: r.status, body: b }));
  return b;
}
async function file() {
  const x = await call("/files/upload-url", {
    fileName: "Весы-учёт.png",
    mimeType: "image/png",
    size: fs.statSync("apps/web/public/branding/icon-192.png").size,
  });
  assert(
    (
      await fetch(x.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: fs.readFileSync("apps/web/public/branding/icon-192.png"),
      })
    ).ok,
  );
  await call(`/files/${x.file.id}/complete`, {});
  return x.file.id;
}
async function postClick(path, click) {
  const pending = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith(path) &&
      r.request().method() === "POST",
  );
  await click();
  const r = await pending,
    b = await r.json();
  assert(r.ok(), JSON.stringify({ path, status: r.status(), body: b }));
  await page
    .getByRole("dialog", { name: "Документ сохранён", exact: true })
    .getByRole("button", { name: "Закрыть", exact: true })
    .click();
  return b;
}
async function act(op, action) {
  const number = "Операция №" + Number(op.number.split("-").at(-1));
  if (!(await page.getByRole("button", { name: action, exact: true }).count()))
    await page
      .locator("tbody tr")
      .filter({ hasText: number })
      .getByRole("button", { name: "Открыть", exact: true })
      .click();
  const out = await postClick(
    `/ledger/operations/${op.id}/${{ Подтвердить: "confirm", Отменить: "cancel" }[action]}`,
    () => page.getByRole("button", { name: action, exact: true }).click(),
  );
  result.push(op.kind + " " + action);
  console.log("PASS", op.kind, action);
  return out;
}
(async () => {
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    token = (
      await call("/auth/login", {
        email: "android-owner@uat.local",
        password: "IntegrationOnly2026!",
      })
    ).accessToken;
    const refs = {};
    for (const k of [
      "counterparties",
      "extraction-sites",
      "material-types",
      "product-types",
      "warehouses",
      "vehicles",
      "drivers",
    ])
      refs[k] = (await call("/" + k + "?pageSize=100")).data.filter(
        (r) =>
          !r.archivedAt && (r.status === undefined || r.status === "ACTIVE"),
      );
    const wh = refs.warehouses.find((w) => w.name === "Мойка"),
      other = refs.warehouses.find((w) => w.name === "Завод");
    const batch = await call("/ledger/batches", {
      idempotencyKey: randomUUID(),
      counterpartyId: refs.counterparties[0].id,
      extractionSiteId: refs["extraction-sites"][0].id,
      materialTypeId: refs["material-types"][0].id,
      quantity: "10",
      measurementMethod: "Весы",
      measuredAt: new Date().toISOString(),
    });
    await call(`/ledger/batches/${batch.id}/confirm`, {
      idempotencyKey: randomUUID(),
      reason: "Проверка исходной партии",
    });
    const trip = await call("/ledger/waybills", {
      idempotencyKey: randomUUID(),
      batchId: batch.id,
      vehicleId: refs.vehicles[0].id,
      driverId: refs.drivers[0].id,
      destinationWarehouseId: wh.id,
      quantity: "10",
      documentDate: new Date().toISOString(),
    });
    const proof = await file();
    await call(`/ledger/waybills/${trip.id}/load`, {
      idempotencyKey: randomUUID(),
      grossWeight: "12",
      tareWeight: "2",
      fileIds: [proof],
    });
    for (const status of ["IN_TRANSIT", "ARRIVED"])
      await call(`/ledger/waybills/${trip.id}/status`, {
        idempotencyKey: randomUUID(),
        status,
      });
    await call(`/ledger/waybills/${trip.id}/receipt`, {
      idempotencyKey: randomUUID(),
      warehouseId: wh.id,
      grossWeight: "12",
      tareWeight: "2",
      fileIds: [proof],
    });
    await call(`/ledger/waybills/${trip.id}/unload`, {
      idempotencyKey: randomUUID(),
    });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("dialog", (d) =>
      d.accept(d.type() === "prompt" ? "Проверка интерфейса" : undefined),
    );
    await page.goto(base);
    await page.locator("#login-email").fill("android-owner@uat.local");
    await page.locator("#login-password").fill("IntegrationOnly2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator("nav.nav").waitFor();
    await page
      .locator("nav.nav")
      .getByRole("button", { name: "Партии и операции", exact: true })
      .click();
    await page
      .locator("main")
      .getByRole("button", { name: "Операции", exact: true })
      .click();
    async function create(kind, quantity, opts = {}) {
      const d = page
        .locator("main details")
        .filter({ has: page.getByText("Новая операция", { exact: true }) });
      if (!(await d.evaluate((e) => e.open)))
        await d.locator("summary").click();
      const f = d.locator("form");
      await f.getByLabel("Операция", { exact: true }).selectOption(kind);
      if (kind === "SHIPMENT")
        assert.equal(
          await f
            .getByLabel("Входная партия", { exact: true })
            .locator(`option[value="${batch.id}"]`)
            .count(),
          0,
          "Shipment must not offer raw material",
        );
      await f.locator("[name=fromWarehouseId]").selectOption(wh.id);
      if (["TRANSFER", "WASHING", "PRODUCTION"].includes(kind))
        await f
          .locator("[name=toWarehouseId]")
          .selectOption(kind === "TRANSFER" ? other.id : wh.id);
      if (kind === "RETURN")
        await f
          .getByLabel("Исходная отгрузка", { exact: true })
          .selectOption(opts.shipment.id);
      await f
        .getByLabel("Входная партия", { exact: true })
        .selectOption(opts.batchId || batch.id);
      await f.getByLabel("Количество партии", { exact: true }).fill(quantity);
      await f.locator("[name=reason]").fill("Проверка учёта");
      if (["WASHING", "PRODUCTION"].includes(kind)) {
        await f.locator("[name=outputQuantity]").fill(opts.output);
        await f.locator("[name=lossQuantity]").fill(opts.loss);
        await f.locator("[name=shift]").fill("Дневная");
        if (kind === "PRODUCTION")
          await f
            .locator("[name=productTypeId]")
            .selectOption(refs["product-types"][0].id);
      }
      if (kind === "SHIPMENT") {
        await f.locator("[name=recipient]").fill("Покупатель проверки");
        await f.locator("[name=vehicleId]").selectOption(refs.vehicles[0].id);
        await f.locator("[name=documentNumber]").fill("LEDGER-" + Date.now());
        const upload = page.waitForResponse(
          (r) =>
            /\/files\/[^/]+\/complete$/.test(r.url()) &&
            r.request().method() === "POST",
        );
        await f
          .locator("input[type=file]")
          .setInputFiles("apps/web/public/branding/icon-192.png");
        assert((await upload).ok());
        await page.waitForTimeout(100);
      }
      const op = await postClick("/ledger/operations", () =>
        f
          .getByRole("button", { name: "Создать черновик", exact: true })
          .click(),
      );
      assert.equal(op.status, "DRAFT");
      return op;
    }
    const transfer = await create("TRANSFER", "1");
    await act(transfer, "Подтвердить");
    await act(transfer, "Отменить");
    const reserve = await create("RESERVE", "0.5");
    await act(reserve, "Подтвердить");
    const release = await create("RELEASE", "0.5");
    await act(release, "Подтвердить");
    const write = await create("WRITE_OFF", "0.1");
    await act(write, "Подтвердить");
    await act(write, "Отменить");
    const correction = await create("CORRECTION", "0.1");
    await act(correction, "Подтвердить");
    await act(correction, "Отменить");
    const inventory = await create("INVENTORY", "10");
    await act(inventory, "Подтвердить");
    const washing = await create("WASHING", "1", {
      output: "0.8",
      loss: "0.2",
    });
    const washed = await act(washing, "Подтвердить");
    const production = await create("PRODUCTION", "0.8", {
      batchId: washed.outputBatchId,
      output: "0.5",
      loss: "0.3",
    });
    const produced = await act(production, "Подтвердить");
    const cancelledShipment = await create("SHIPMENT", "0.2", {
      batchId: produced.outputBatchId,
    });
    await act(cancelledShipment, "Подтвердить");
    await act(cancelledShipment, "Отменить");
    const shipment = await create("SHIPMENT", "0.2", {
      batchId: produced.outputBatchId,
    });
    await act(shipment, "Подтвердить");
    const draftReturn = await create("RETURN", "0.05", {
      shipment,
      batchId: produced.outputBatchId,
    });
    await act(draftReturn, "Отменить");
    const returned = await create("RETURN", "0.1", {
      shipment,
      batchId: produced.outputBatchId,
    });
    await act(returned, "Подтвердить");
    assert.equal(
      await page.getByRole("button", { name: "Отменить", exact: true }).count(),
      0,
      "Confirmed return must explain correction rather than offer a forbidden cancellation",
    );
    const stocks = await call("/ledger/stocks");
    const stock = (Array.isArray(stocks) ? stocks : stocks.data).find(
      (x) => x.batchId === batch.id && x.warehouseId === wh.id,
    );
    assert.equal(Number(stock.quantity), 9);
    assert.equal(Number(stock.reserved), 0);
    const finishedStock = (Array.isArray(stocks) ? stocks : stocks.data).find(
      (x) => x.batchId === produced.outputBatchId && x.warehouseId === wh.id,
    );
    assert.equal(Number(finishedStock.quantity), 0.4);
    fs.writeFileSync(
      "/tmp/ledger-ui-actions.json",
      JSON.stringify(result, null, 2),
    );
    console.log("PASS all ten ledger operation kinds and reversals");
  } finally {
    await browser?.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
