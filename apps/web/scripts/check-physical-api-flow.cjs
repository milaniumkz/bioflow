// Complete physical UI workflow with real localhost APIs and PostgreSQL.
// A virtual camera supplies real QR pixels; business APIs are never intercepted.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const QR = require("qrcode");
const base = process.env.BIOFLOW_UI_URL || "http://localhost:3015";
const api = process.env.BIOFLOW_API_URL || "http://localhost:4102/api/v1";
for (const url of [base, api])
  assert(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const password = "IntegrationOnly2026!";
let browser, context, page;
const results = [];
async function request(path, token, body) {
  const r = await fetch(api + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert(r.ok, JSON.stringify({ path, status: r.status, body: d }));
  return d;
}
async function login(role) {
  return (
    await request("/auth/login", null, {
      email: `android-${role}@uat.local`,
      password,
    })
  ).accessToken;
}
async function open(role, qr) {
  if (
    process.env.BIOFLOW_COMBINED_ROLES &&
    [
      "wash_receiver",
      "lab_technician",
      "drying_operator",
      "finished_receiver",
      "sales_storekeeper",
    ].includes(role)
  )
    role = "operations_manager";
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 43.2, longitude: 76.9 },
    permissions: ["geolocation"],
  });
  page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await page.locator("#login-email").fill(`android-${role}@uat.local`);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.locator("nav.nav").waitFor({ state: "attached" });
  if (qr) await scan(qr, role === "driver");
}
async function scan(qr, isDriver = false) {
  const pending = page.waitForResponse(
    (r) =>
      r.url().endsWith(isDriver ? "/tracking/scan" : "/processing/scan") &&
      r.request().method() === "POST",
  );
  const image = await QR.toDataURL(qr, { width: 512, margin: 4 });
  await page.evaluate((image) => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 600;
        canvas.height = 600;
        const ctx = canvas.getContext("2d");
        const img = new Image();
        img.src = image;
        await img.decode();
        const draw = () => {
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, 600, 600);
          ctx.drawImage(img, 44, 44, 512, 512);
        };
        draw();
        const timer = setInterval(draw, 80),
          stream = canvas.captureStream(12);
        stream
          .getTracks()[0]
          .addEventListener("ended", () => clearInterval(timer));
        return stream;
      },
    });
  }, image);
  await page.getByRole("button", { name: "QR-сканер", exact: true }).click();
  assert((await pending).ok());
  await page
    .getByLabel(isDriver ? "Рейс по QR" : "Открытая партия", { exact: true })
    .waitFor();
}
function form(title) {
  return page
    .locator("form.workflow-form")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}
async function send(f, endpoint) {
  const refreshed = page.waitForResponse(
    (r) =>
      (r.url().endsWith("/processing/scan") &&
        r.request().method() === "POST") ||
      (r.url().includes("/processing/batches/") &&
        r.request().method() === "GET"),
  );
  const pending = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith(endpoint) &&
      r.request().method() === "POST",
  );
  await f.locator("button[type=submit],button:not([type])").last().click();
  const r = await pending;
  const d = await r.json();
  assert(r.ok(), JSON.stringify({ endpoint, status: r.status(), body: d }));
  await (await refreshed).finished();
  await page.waitForTimeout(200);
  results.push(endpoint);
  fs.writeFileSync(
    "/tmp/physical-ui-actions.json",
    JSON.stringify(results, null, 2),
  );
  console.log("PASS", endpoint);
  return d;
}
(async () => {
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const owner = await login("owner"),
      driver = await login("driver");
    const get = async (name) =>
      (await request("/" + name + "?pageSize=100", owner)).data.filter(
        (r) =>
          !r.archivedAt && (r.status === undefined || r.status === "ACTIVE"),
      );
    const [parties, sites, materials, vehicles, drivers, warehouses, products] =
      await Promise.all(
        [
          "counterparties",
          "extraction-sites",
          "material-types",
          "vehicles",
          "drivers",
          "warehouses",
          "product-types",
        ].map(get),
      );
    const me = await request("/auth/me", driver);
    const assigned = drivers.find((d) => d.userId === me.id);
    assert(assigned);
    const wh = warehouses.find((w) => w.name === "Мойка"),
      plant = warehouses.find((w) => w.name === "Завод"),
      finished = warehouses.find((w) => w.name === "Готовая продукция");
    await open("collector");
    const dispatchForm = form("Новая отправка");
    await dispatchForm.getByRole("button", { name: /^Далее:/ }).click();
    assert(
      (await dispatchForm.locator("input:invalid,select:invalid").count()) > 0,
    );
    const party =
      parties.find((p) => p.id === assigned.counterpartyId) ?? parties[0];
    await dispatchForm.locator("[name=counterpartyId]").selectOption(party.id);
    await dispatchForm
      .locator("[name=extractionSiteId]")
      .selectOption(sites[0].id);
    await dispatchForm
      .locator("[name=materialTypeId]")
      .selectOption(materials[0].id);
    await dispatchForm.locator("[name=bagCount]").fill("10");
    await dispatchForm.locator("[name=quantity]").fill("10");
    await dispatchForm.getByRole("button", { name: /^Далее:/ }).click();
    await dispatchForm
      .getByRole("button", { name: "Назад", exact: true })
      .click();
    assert.equal(
      await dispatchForm.locator("[name=quantity]").inputValue(),
      "10",
    );
    await dispatchForm.getByRole("button", { name: /^Далее:/ }).click();
    await dispatchForm
      .locator("[name=vehicleId]")
      .selectOption(vehicles.find((v) => v.counterpartyId === party.id).id);
    await dispatchForm.locator("[name=driverId]").selectOption(assigned.id);
    await dispatchForm
      .locator("[name=destinationWarehouseId]")
      .selectOption(wh.id);
    await dispatchForm.getByRole("button", { name: /^Далее:/ }).click();
    const dispatched = page.waitForResponse(
      (r) =>
        r.url().endsWith("/collection/dispatch") &&
        r.request().method() === "POST",
    );
    await dispatchForm
      .getByRole("button", { name: "Создать отправку и QR", exact: true })
      .click();
    const dispatchResponse = await dispatched;
    assert(dispatchResponse.ok());
    const trip = await dispatchResponse.json();
    await dispatchForm
      .getByRole("button", { name: "Сохранено ✓", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Создать следующую отправку", exact: true })
      .click();
    assert.equal(
      await form("Новая отправка").locator("[name=quantity]").inputValue(),
      "",
    );
    results.push(
      "collector wizard: required fields, back, confirmation, QR and new draft",
    );
    await open("driver", trip.qrToken);
    for (const label of [
      "Загрузился",
      "Выехал · включить геолокацию",
      "Прибыл",
    ]) {
      const pending = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/tracking/trips/${trip.id}/status`) &&
          r.request().method() === "POST",
      );
      await page
        .getByLabel("Рейс по QR", { exact: true })
        .getByRole("button", { name: label, exact: true })
        .click();
      assert((await pending).ok());
      results.push("driver " + label);
      console.log("PASS driver", label);
    }
    await open("packer", trip.qrToken);
    assert.equal(await page.locator("form.workflow-form").count(), 0);
    results.push("early packer has no actions");
    await open("wash_receiver", trip.qrToken);
    let f = form("Приёмка на мойку");
    await f.locator("[name=warehouseId]").selectOption(wh.id);
    await f.locator("[name=quantity]").fill("10");
    await f.locator("[name=bagCount]").fill("10");
    const upload = page.waitForResponse(
      (r) =>
        /\/files\/[^/]+\/complete$/.test(r.url()) &&
        r.request().method() === "POST",
    );
    await f.locator("input[type=file]").setInputFiles({
      name: "Весы.png",
      mimeType: "image/png",
      buffer: fs.readFileSync("apps/web/public/branding/icon-192.png"),
    });
    assert((await upload).ok());
    await send(f, `/processing/trips/${trip.id}/receive`);
    await page
      .getByRole("button", { name: "Вся история партии", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Весы.png", exact: true })
      .first()
      .click();
    await page.getByAltText("Фото документа партии").waitFor();
    await page.waitForFunction(() =>
      [...document.images].some(
        (i) =>
          i.alt === "Фото документа партии" && i.complete && i.naturalWidth > 0,
      ),
    );
    await page
      .getByRole("button", { name: "Закрыть фото", exact: true })
      .click();
    results.push("private weight photo upload and viewing");
    await open("lab_technician", trip.qrToken);
    f = form("Лабораторный анализ");
    await f.locator("[name=moisturePercent]").fill("10");
    await f.locator("[name=sedimentPercent]").fill("0");
    await send(f, "/processing/laboratory");
    await open("wash_operator", trip.qrToken);
    f = form("Взвесить перед мойкой");
    await f.locator("[name=fromWarehouseId]").selectOption(wh.id);
    await f.locator("[name=toWarehouseId]").selectOption(wh.id);
    await f.locator("[name=outputWeights]").fill("7.5");
    await send(f, "/processing/runs");
    f = form("Выход с мойки");
    await f.waitFor();
    await f.locator("[name=fromWarehouseId]").selectOption(wh.id);
    await f.locator("[name=toWarehouseId]").selectOption(wh.id);
    await f
      .getByRole("button", { name: "＋ Добавить биг-бэг", exact: true })
      .click();
    await f
      .getByRole("button", { name: "Убрать последний", exact: true })
      .click();
    await f
      .getByRole("button", { name: "＋ Добавить биг-бэг", exact: true })
      .click();
    await f.locator("[name=outputWeights]").nth(0).fill("3.75");
    await f.locator("[name=outputWeights]").nth(1).fill("3.75");
    const wash = await send(f, "/processing/runs");
    assert.equal(wash.outputs.length, 2);
    if (process.env.BIOFLOW_COMBINED_ROLES) {
      await open("wash_operator");
      await page
        .getByRole("button", { name: "Открыть меню", exact: true })
        .click();
      await page
        .locator("nav.nav")
        .getByRole("button", { name: "Биг-бэги и упаковка", exact: true })
        .click();
      await page
        .getByLabel("Номер партии", { exact: true })
        .fill(wash.outputs[1].number);
      await page
        .getByRole("button", { name: "Продать с мойки", exact: true })
        .click();
      const washedSale = form("Продать с мойки");
      await washedSale.locator("[name=warehouseId]").selectOption(wh.id);
      await washedSale
        .locator("[name=recipient]")
        .fill("Покупатель мытого материала");
      await washedSale
        .locator("[name=documentNumber]")
        .fill("WASH-UI-" + Date.now());
      await washedSale.getByLabel("Оформить доставку", { exact: true }).check();
      await washedSale
        .locator("[name=deliveryDestination]")
        .fill("Покупатель без GPS");
      await washedSale
        .locator("[name=deliveryRoute]")
        .fill("Мойка → покупатель");
      await washedSale.locator("[name=deliveryDriverId]").selectOption("");
      await washedSale.locator("[name=deliveryVehicleId]").selectOption("");
      const sold = await send(washedSale, "/processing/sales");
      assert.equal(sold.delivery.trackingEnabled, false);
      assert.equal(sold.delivery.driverId, null);
      assert.equal(sold.delivery.vehicleId, null);
      const driverTrips = await request("/tracking/trips?pageSize=100", driver);
      assert(!driverTrips.data.some((r) => r.id === sold.delivery.id));
      results.push(
        "washed registry sale and optional delivery without driver, vehicle or GPS",
      );
    }
    await open("drying_operator", wash.outputs[0].qrToken);
    f = form("Приём на завод");
    await f.locator("[name=warehouseId]").selectOption(plant.id);
    await send(f, `/processing/bags/${wash.outputs[0].id}/plant-intake`);
    f = form("Выход после завода");
    await f.waitFor();
    await f.locator("[name=fromWarehouseId]").selectOption(plant.id);
    await f.locator("[name=toWarehouseId]").selectOption(plant.id);
    await f.locator("[name=productTypeId]").selectOption(products[0].id);
    await f.locator("[name=outputWeights]").fill("2.4");
    const dry = await send(f, "/processing/runs");
    await open("finished_receiver", dry.outputs[0].qrToken);
    f = form("Склад готовой продукции");
    await f.locator("[name=warehouseId]").selectOption(finished.id);
    await send(f, `/processing/bags/${dry.outputs[0].id}/receive`);
    await open("packer", dry.outputs[0].qrToken);
    await page
      .getByText(/упакован и записан/)
      .first()
      .waitFor();
    let detail = await request(
      "/processing/batches/" + dry.outputs[0].id,
      owner,
    );
    assert(detail.batch.bigBag.packedAt);
    const credited = detail.batch.bigBag.packedById;
    await scan(dry.outputs[0].qrToken);
    await page
      .getByText(/Повторное сканирование не увеличивает счётчик/)
      .first()
      .waitFor();
    detail = await request("/processing/batches/" + dry.outputs[0].id, owner);
    assert.equal(detail.batch.bigBag.packedById, credited);
    results.push("packing scan credits once");
    await open("sales_storekeeper", dry.outputs[0].qrToken);
    f = page.locator("form.workflow-form").filter({
      has: page.getByRole("button", {
        name: "Подтвердить продажу и списать",
        exact: true,
      }),
    });
    await f.locator("[name=warehouseId]").selectOption(finished.id);
    await f.locator("[name=recipient]").fill("Покупатель проверки интерфейса");
    const documentNumber = "UI-" + Date.now();
    await f.locator("[name=documentNumber]").fill(documentNumber);
    if (process.env.BIOFLOW_TRACK_DELIVERY) {
      await f.getByLabel("Оформить доставку", { exact: true }).check();
      await f.getByLabel("Отслеживать машину по GPS", { exact: true }).check();
      await f
        .locator("[name=deliveryDestination]")
        .fill("Павлодар, тестовый покупатель");
      await f.locator("[name=deliveryRoute]").fill("Склад → покупатель");
      await f.locator("[name=deliveryDriverId]").selectOption(assigned.id);
      await f.locator("[name=deliveryVehicleId]").selectOption(vehicles[0].id);
    }
    await send(f, "/processing/sales");
    const beforeDelivery = await request(
      "/processing/batches/" + dry.outputs[0].id,
      owner,
    );
    if (process.env.BIOFLOW_TRACK_DELIVERY) {
      const tracked = await request("/tracking/scan", driver, {
        token: dry.outputs[0].qrToken,
      });
      await open("driver", dry.outputs[0].qrToken);
      for (const label of [
        "Загрузился",
        "Выехал · включить геолокацию",
        "Прибыл",
      ]) {
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith(`/tracking/trips/${tracked.id}/status`) &&
            r.request().method() === "POST",
        );
        await page
          .getByLabel("Рейс по QR", { exact: true })
          .getByRole("button", { name: label, exact: true })
          .click();
        assert((await response).ok());
        if (label.startsWith("Выехал")) {
          for (let tries = 0; ; tries++) {
            const route = await request(
              `/tracking/trips/${tracked.id}/route?pageSize=100`,
              owner,
            );
            if (route.total > 0) break;
            assert(tries < 20, "Delivery GPS point missing");
            await page.waitForTimeout(500);
          }
        }
        results.push("customer driver " + label);
      }
      await open("operations_manager");
      await page
        .getByRole("button", { name: "Открыть меню", exact: true })
        .click();
      await page
        .locator("nav.nav")
        .getByRole("button", { name: "Доставка продукции", exact: true })
        .click();
      const card = page.locator("article.workflow-event").filter({
        has: page.getByRole("heading", { name: tracked.number, exact: true }),
      });
      await card
        .getByRole("button", { name: "Маршрут и остановки", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Маршрут и время рейса", exact: true })
        .waitFor();
      await page.getByText("Время выезда", { exact: true }).waitFor();
      await card
        .getByRole("button", { name: "Открыть доставку", exact: true })
        .click();
      const drawer = page.getByRole("dialog").last();
      await drawer
        .getByLabel("Статус доставки", { exact: true })
        .selectOption("DELIVERED");
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/processing/deliveries") &&
          r.request().method() === "POST",
      );
      await drawer
        .getByRole("button", { name: "Сохранить доставку", exact: true })
        .click();
      assert((await saved).ok());
      await drawer.waitFor({ state: "hidden" });
      results.push(
        "tracked delivery: assignment, QR, driver GPS, arrival, route and separate handover",
      );
    } else {
      await open("owner", dry.outputs[0].qrToken);
      await page
        .getByRole("button", { name: "Открыть меню", exact: true })
        .click();
      await page
        .locator("nav.nav")
        .getByRole("button", { name: "Обзор предприятия", exact: true })
        .click();
      await page
        .locator("button.owner-metric")
        .filter({ hasText: "Доставка покупателю" })
        .click();
      for (const status of ["PLANNED", "IN_TRANSIT", "DELIVERED"]) {
        await page
          .locator("button.owner-record")
          .filter({ hasText: documentNumber })
          .click();
        const drawer = page.getByRole("dialog").last();
        const driverChoice = drawer.getByLabel("Водитель доставки", {
          exact: true,
        });
        if (await driverChoice.isEnabled())
          await driverChoice.selectOption(assigned.id);
        await drawer
          .getByLabel("Адрес покупателя", { exact: true })
          .fill("Проверочный адрес покупателя");
        await drawer
          .getByLabel("Маршрут доставки", { exact: true })
          .fill("Склад — покупатель");
        await drawer
          .getByLabel("Статус доставки", { exact: true })
          .selectOption(status);
        const delivery = page.waitForResponse(
          (r) =>
            r.url().endsWith("/processing/deliveries") &&
            r.request().method() === "POST",
        );
        const updated = page.waitForResponse(
          (r) =>
            r.url().includes("/processing/owner-dashboard") &&
            r.request().method() === "GET",
        );
        await drawer
          .getByRole("button", { name: "Сохранить доставку", exact: true })
          .click();
        assert((await delivery).ok());
        await (await updated).finished();
        await drawer.waitFor({ state: "hidden" });
        await page.waitForTimeout(200);
        results.push("delivery " + status);
        console.log("PASS delivery", status);
      }
    }
    const afterDelivery = await request(
      "/processing/batches/" + dry.outputs[0].id,
      owner,
    );
    assert.deepEqual(
      afterDelivery.batch.stocks,
      beforeDelivery.batch.stocks,
      "Delivery cannot deduct warehouse stock a second time",
    );
    const trace = await request(
      "/processing/trace/" + dry.outputs[0].id,
      owner,
    );
    assert(trace);
    results.push("full provenance after sale");
    fs.writeFileSync(
      "/tmp/physical-ui-actions.json",
      JSON.stringify(results, null, 2),
    );
    console.log("PASS full physical UI lifecycle");
  } finally {
    await browser?.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
