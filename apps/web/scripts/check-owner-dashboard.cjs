// Isolated UI test: fixtures are intercepted only inside this browser, never in the application.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const keys = [
  "collection",
  "transport",
  "laboratory",
  "washing",
  "factory",
  "finished",
  "stocks",
  "sales",
  "delivery",
  "losses",
  "deviations",
  "idle",
];
const row = {
  id: "sale1",
  batchIds: ["root"],
  number: "Партия TEST-1",
  date: "2026-11-09T12:00:00Z",
  quantity: 6,
  bags: 2,
  employee: "Сотрудник теста",
  location: "Склад теста",
  status: "CONFIRMED",
  detail: "Тестовая запись",
  tripId: "trip1",
  loss: 2,
  delivery: null,
};
const data = {
  groups: Object.fromEntries(
    keys.map((k) => [k, { records: [row], quantity: 6, bags: 2, batches: 1 }]),
  ),
  filters: {
    warehouses: [{ id: "wh", name: "Склад теста" }],
    employees: [{ id: "employee", fullName: "Сотрудник теста" }],
    drivers: [{ id: "driver", fullName: "Водитель теста" }],
  },
  note: "Данные изолированного браузерного теста",
};
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  let urls = [],
    writes = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    let body = {};
    if (url.pathname.endsWith("/auth/browser-refresh"))
      return route.fulfill({ status: 401, json: {} });
    if (url.pathname.endsWith("/auth/browser-login"))
      body = {
        accessToken: "synthetic-ui-test",
        refreshToken: "synthetic-refresh",
      };
    else if (url.pathname.endsWith("/auth/me"))
      body = {
        id: "owner",
        fullName: "Владелец теста",
        permissions: [
          "processing.overview",
          "processing.read",
          "processing.sell",
          "tracking.read",
          "inventory.read",
        ],
        roles: ["OWNER"],
        accessAllObjects: true,
      };
    else if (url.pathname.endsWith("/processing/owner-dashboard")) {
      urls.push(url);
      body = data;
    } else if (url.pathname.endsWith("/processing/deliveries")) {
      writes.push(req.postDataJSON());
      body = { id: "delivery1" };
    } else if (url.pathname.includes("/processing/trace/"))
      body = {
        root: {
          number: "TEST-1",
          createdByName: "Сотрудник теста",
          measuredAt: row.date,
          laboratoryAnalyses: [],
          waybills: [],
          stocks: [],
        },
        runs: [],
        movements: [],
        files: [],
        summary: {
          collected: 10,
          finishedProduced: 6,
          washedSold: 0,
          expectedFinished: 4.9,
          comparisonComplete: false,
        },
      };
    else if (url.pathname.includes("/tracking/trips/"))
      body = {
        data: [],
        total: 0,
        stops: [],
        metrics: {
          departedAt: row.date,
          movingSeconds: 0,
          stoppedSeconds: 600,
          signalGapSeconds: 0,
          distanceKm: 0,
        },
      };
    else body = { data: [], total: 0 };
    await route.fulfill({ json: body });
  });
  await page.goto(process.env.BIOFLOW_UI_URL || "http://localhost:3000");
  await page.locator("#login-email").fill("+77000000000");
  await page.locator("#login-password").fill("Synthetic123!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("heading", { name: "Весь путь материала" }).waitFor();
  assert.equal(await page.locator(".owner-metric").count(), 12);
  for (const key of keys) {
    const index = keys.indexOf(key);
    await page.locator(".owner-metric").nth(index).click();
    assert.equal(await page.locator(".owner-record").count(), 1);
  }
  await page.getByLabel("Склад", { exact: true }).selectOption("wh");
  await page.getByLabel("Сотрудник", { exact: true }).selectOption("employee");
  await page.getByLabel("Водитель", { exact: true }).selectOption("driver");
  await page.getByLabel("С даты", { exact: true }).fill("2026-11-01");
  await page.getByLabel("По дату", { exact: true }).fill("2026-11-09");
  await page.waitForTimeout(500);
  const last = urls.at(-1);
  for (const [k, v] of Object.entries({
    warehouseId: "wh",
    employeeId: "employee",
    driverId: "driver",
    dateFrom: "2026-11-01",
    dateTo: "2026-11-09",
  }))
    assert.equal(last.searchParams.get(k), v);
  await page.locator(".owner-metric").nth(8).click();
  await page.locator(".owner-record").click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByLabel("Адрес покупателя", { exact: true })
    .fill("Адрес теста");
  await page
    .getByLabel("Маршрут доставки", { exact: true })
    .fill("Склад → Покупатель");
  await page
    .getByLabel("Водитель доставки", { exact: true })
    .selectOption("driver");
  await page
    .getByRole("button", { name: "Сохранить доставку", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(writes[0].sourceId, "sale1");
  assert.equal(writes[0].status, "PLANNED");
  await page.locator(".owner-record").click();
  await page
    .getByRole("button", { name: "Полная история партии", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Полная история партии", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Маршрут и простои", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Маршрут и время рейса", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Закрыть карточку", exact: true })
    .click();
  await page.screenshot({
    path: "/tmp/bioflow-dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/bioflow-dashboard-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 12 cards, records, all 5 filters, delivery save, full trace, route, drawer close, mobile overflow, no JS errors (isolated API fixtures)",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
