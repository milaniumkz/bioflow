// Camera frames and API fixtures stay isolated in this browser. No working data is used.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const QR = require("../../../node_modules/qrcode");
const { PNG } = require("../../../node_modules/pngjs");
const jsqr = require("../../../node_modules/jsqr");
const base = process.env.BIOFLOW_UI_URL || "http://localhost:3000";
const org = "cm123456789012345678901234";
const rootNumber = org + "-LOT-000001";
const roles = {
  WASH_RECEIVER: ["processing.read", "processing.receive"],
  LAB_TECHNICIAN: ["processing.read", "laboratory.manage"],
  WASH_OPERATOR: ["processing.read", "processing.wash"],
  DRYING_OPERATOR: ["processing.read", "processing.dry"],
  FINISHED_RECEIVER: ["processing.read", "processing.finished"],
  PACKER: ["processing.read", "processing.pack"],
  DRIVER: ["tracking.write"],
};
let browser, qrImage, printedImages;
async function setup(role, initial, deny = false) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: 43.2, longitude: 76.9 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = {
    phase: initial,
    analysed: role === "WASH_OPERATOR",
    writes: [],
    scans: 0,
    logged: false,
    packed: false,
    tripStatus: "CREATED",
  };
  await page.addInitScript(
    ({ image, deny }) => {
      window.__cameraCalls = 0;
      window.__labelText = [];
      window.__printed = false;
      const text = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
        window.__labelText.push(value);
        return text.call(this, value, ...args);
      };
      window.print = () => {
        window.__printed = true;
      };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          window.__cameraCalls++;
          if (deny) throw new DOMException("Denied", "NotAllowedError");
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
    },
    { image: qrImage, deny },
  );
  const getItem = () => {
    if (role === "PACKER" && state.phase === "accepted")
      return {
        readOnly: true,
        stageLabel: "Приёмка и подготовка к мойке",
        batch: {
          id: "root",
          number: rootNumber,
          state: "DIRTY",
          stocks: [],
          bigBag: null,
        },
        rootFacts: { number: rootNumber },
        analyses: [],
        trip: null,
        preparedAvailable: false,
      };

    const bagPhase = [
      "washed",
      "intake",
      "dry-used",
      "ready",
      "received",
      "packed",
    ].includes(state.phase);
    const dried = ["ready", "received", "packed"].includes(state.phase);
    const used = state.phase === "dry-used" || state.phase === "washed-used";
    const bag = bagPhase
      ? {
          ordinal: 1,
          stage: dried ? "DRIED" : "WASHED",
          quantity: dried ? "2.56" : "4",
          factoryStartedAt: ["intake", "dry-used"].includes(state.phase)
            ? "2026-11-09T00:00:00Z"
            : null,
          receivedAt: ["received", "packed"].includes(state.phase)
            ? "2026-11-09T00:00:00Z"
            : null,
          packedAt: state.phase === "packed" ? "2026-11-09T00:00:00Z" : null,
        }
      : null;
    return {
      batch: {
        id: bag ? "bag-batch" : "root",
        number: bag ? org + "-LOT-000003" : rootNumber,
        state: dried ? "FINISHED" : bag ? "WASHED" : "DIRTY",
        initialQuantity: bag ? (dried ? "2.56" : "4") : "10",
        actualBagCount: 10,
        bigBag: bag,
        stocks: used
          ? []
          : [
              {
                id: "stock",
                warehouseId: "wh",
                quantity: bag ? (dried ? "2.56" : "4") : "10",
              },
            ],
      },
      trip: bag
        ? null
        : {
            id: "trip",
            number: "WB-000001",
            status: state.phase === "incoming" ? "ARRIVED" : "ACCEPTED",
            receivedWeight: state.phase === "incoming" ? null : "10",
            declaredWeight: "10",
            bagCount: 10,
            receivedBagCount: 10,
            destinationWarehouseId: "wh",
          },
      analyses: state.analysed ? [{}] : [],
      rootFacts: {
        number: rootNumber,
        physicalReceivedByWarehouse: { wh: 10 },
      },
      rootBatchId: "root",
      preparedBatchId: ["prepared", "washed-used"].includes(state.phase)
        ? "prepared"
        : null,
      preparedAvailable: state.phase === "prepared",
      preparedWarehouseId: "wh",
      preparedQuantity: state.phase === "prepared" ? "7.35" : "0",
      qrImage,
      qrToken: "physical-code",
    };
  };
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace("/api/v1", "");
    let body = {},
      status = 200,
      headers = {};
    if (path === "/auth/browser-refresh") {
      if (
        !state.logged ||
        !req.headers().cookie?.includes("bioflow_refresh=fixture")
      )
        status = 401;
      else body = { accessToken: "browser-access" };
    } else if (path === "/auth/browser-login") {
      state.logged = true;
      status = 201;
      body = { accessToken: "browser-access" };
      headers["set-cookie"] =
        "bioflow_refresh=fixture; HttpOnly; SameSite=Strict; Path=/api/v1/auth";
    } else if (path === "/auth/browser-logout" || path === "/auth/logout-all") {
      state.logged = false;
      body = { ok: true };
    } else if (path === "/auth/me")
      body = {
        id: role,
        fullName: "Сотрудник проверки",
        roles: [role],
        permissions: [...roles[role], "references.read"],
        accessAllObjects: true,
      };
    else if (path === "/processing/scan") {
      state.scans++;
      body = getItem();
    } else if (path === "/processing/packing-stats")
      body =
        state.phase === "packed"
          ? [
              {
                packingDate: "2026-11-09",
                packingShift: "Ночная",
                _count: { _all: 1 },
                _sum: { quantity: "2.56" },
              },
            ]
          : [];
    else if (req.method() === "POST" && path === "/processing/laboratory") {
      state.writes.push({ path, ...req.postDataJSON() });
      state.analysed = true;
      body = { ok: true };
    } else if (req.method() === "POST" && path.includes("/processing/trips/")) {
      state.writes.push({ path, ...req.postDataJSON() });
      state.phase = "accepted";
      body = { ok: true };
    } else if (req.method() === "POST" && path === "/processing/runs") {
      const d = req.postDataJSON();
      state.writes.push({ path, ...d });
      state.phase =
        d.kind === "PREWASH"
          ? "prepared"
          : d.kind === "WASHING"
            ? "washed-used"
            : "dry-used";
      body = {
        outputs: await Promise.all(
          d.outputWeights.map(async (weight, i) => ({
            id: "out-" + i,
            number: org + "-LOT-00000" + (i + 4),
            initialQuantity: weight,
            state:
              d.kind === "DRYING"
                ? "FINISHED"
                : d.kind === "PREWASH"
                  ? "DIRTY"
                  : "WASHED",
            ordinal: i + 1,
            qrImage: await QR.toDataURL("bag-" + (i + 1), { width: 512 }),
          })),
        ),
      };
    } else if (req.method() === "POST" && path.endsWith("/plant-intake")) {
      state.writes.push({ path, ...req.postDataJSON() });
      state.phase = "intake";
      body = { ok: true };
    } else if (req.method() === "POST" && path.endsWith("/receive")) {
      state.writes.push({ path, ...req.postDataJSON() });
      state.phase = "received";
      body = { ok: true };
    } else if (req.method() === "POST" && path.endsWith("/pack")) {
      state.writes.push({ path, ...req.postDataJSON(), actor: role });
      state.phase = "packed";
      body = { alreadyPacked: false };
    } else if (path === "/tracking/scan")
      body = { id: "trip", number: "WB-000001", status: state.tripStatus };
    else if (req.method() === "POST" && path.includes("/tracking/trips/")) {
      state.writes.push({ path, ...req.postDataJSON() });
      state.tripStatus = req.postDataJSON().status;
      body = { ok: true };
    } else if (path === "/tracking/trips")
      body = {
        data: [
          {
            id: "trip",
            number: "WB-000001",
            status: state.tripStatus,
            bagCount: 10,
            declaredWeight: 10,
            vehicle: { plateNumber: "001" },
            destinationWarehouse: { name: "Склад" },
          },
        ],
        total: 1,
      };
    else if (path === "/warehouses")
      body = {
        data: [{ id: "wh", name: "Склад", status: "ACTIVE" }],
        total: 1,
      };
    else if (path === "/product-types")
      body = {
        data: [{ id: "product", name: "Готовая продукция", status: "ACTIVE" }],
        total: 1,
      };
    else body = { data: [], total: 0 };
    await route.fulfill({ status, json: body, headers });
  });
  await page.goto(base);
  await page.locator("#login-email").fill("+77000000000");
  await page.locator("#login-password").fill("Synthetic123!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("button", { name: "QR-сканер", exact: true }).waitFor();
  const scan = async () => {
    await page.getByRole("button", { name: "QR-сканер", exact: true }).click();
    if (!deny) {
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page
        .locator('[aria-label="Открытая партия"], [aria-label="Рейс по QR"]')
        .waitFor();
      assert((await page.evaluate(() => window.__cameraCalls)) > 0);
      await page.waitForFunction(() => {
        const el = document.querySelector(
          '[aria-label="Открытая партия"], [aria-label="Рейс по QR"]',
        );
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return (
          document.activeElement === el &&
          r.top >= -2 &&
          r.top < innerHeight - 100
        );
      });
    }
  };
  const finish = async () => {
    assert.deepEqual(errors, []);
    assert.equal((await page.locator("body").innerText()).includes(org), false);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await context.close();
  };
  return { context, page, state, scan, finish };
}
const form = (page, title) =>
  page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const scenarios = [
  [
    "Камера сразу открывает партию и приёмку мойки",
    async () => {
      const x = await setup("WASH_RECEIVER", "incoming");
      await x.scan();
      const f = form(x.page, "Приёмка на мойку");
      await f
        .getByRole("button", { name: "Принять фактически поступившее" })
        .click();
      await x.page
        .getByRole("heading", { name: "Лабораторный анализ", exact: true })
        .waitFor();
      assert.equal(x.state.writes.length, 1);
      assert.equal(x.state.scans, 2);
      assert.equal(
        await x.page
          .getByRole("button", {
            name: /Сфотографировать|Выбрать фото|Включить камеру/,
          })
          .count(),
        0,
      );
      await x.finish();
    },
  ],
  [
    "Лаборатория сохраняет анализ и передаёт следующий шаг оператору",
    async () => {
      const x = await setup("LAB_TECHNICIAN", "accepted");
      await x.scan();
      const f = form(x.page, "Лабораторный анализ");
      await f.locator("[name=moisturePercent]").fill("25");
      await f.locator("[name=sedimentPercent]").fill("2");
      await f.locator("[name=actualBagCount]").fill("10");
      await f.getByRole("button", { name: "Сохранить влажность" }).click();
      await x.page
        .getByRole("heading", { name: "Взвесить перед мойкой", exact: true })
        .waitFor();
      assert.equal(x.state.writes[0].path, "/processing/laboratory");
      await x.finish();
    },
  ],
  [
    "Мойка: подготовка, два биг-бэга, понятные подписи и читаемая печать QR",
    async () => {
      const x = await setup("WASH_OPERATOR", "accepted");
      await x.scan();
      let f = form(x.page, "Взвесить перед мойкой");
      await f.locator("[name=outputWeights]").fill("7.35");
      await f
        .getByRole("button", { name: "Подтвердить фактический вес" })
        .click();
      f = form(x.page, "Выход с мойки");
      await f.waitFor();
      assert.equal(await x.page.locator(".qr-result:visible").count(), 0);
      await f
        .getByRole("button", { name: "＋ Добавить биг-бэг", exact: true })
        .click();
      await f.locator("[name=outputWeights]").nth(0).fill("4");
      await f.locator("[name=outputWeights]").nth(1).fill("3.35");
      await f
        .getByRole("button", { name: "Подтвердить фактический вес" })
        .click();
      await x.page
        .getByRole("heading", { name: "Созданы биг-бэги: 2" })
        .waitFor();
      assert.equal(await x.page.locator(".qr-result:visible").count(), 2);
      assert.equal(
        await x.page.locator(".qr-result:visible h3").first().innerText(),
        "Биг-бэг №1",
      );
      assert.equal(
        await x.page.locator(".qr-result:visible h3").nth(1).innerText(),
        "Биг-бэг №2",
      );
      await x.page.locator(".qr-result:visible button").first().click();
      await x.page.waitForFunction(() => window.__printed);
      const src = await x.page
        .locator(".qr-print-sheet img")
        .getAttribute("src");
      const png = PNG.sync.read(Buffer.from(src.split(",")[1], "base64"));
      assert.equal(
        png.width,
        png.height,
        "Existing Android print bridge requires a square PNG",
      );
      assert(png.width <= 2048);
      assert.equal(
        jsqr(new Uint8ClampedArray(png.data), png.width, png.height).data,
        "bag-1",
      );
      assert(
        (await x.page.evaluate(() => window.__labelText)).includes(
          "Биг-бэг №1",
        ),
      );
      await x.finish();
    },
  ],
  [
    "Завод: приём входного биг-бэга и выпуск отдельных QR",
    async () => {
      const x = await setup("DRYING_OPERATOR", "washed");
      await x.scan();
      await form(x.page, "Приём на завод")
        .getByRole("button", { name: "Принять этот биг-бэг на завод" })
        .click();
      const f = form(x.page, "Выход после завода");
      await f.waitFor();
      await f.locator("[name=outputWeights]").fill("2.56");
      await f
        .getByRole("button", { name: "Подтвердить фактический вес" })
        .click();
      await x.page
        .getByRole("heading", { name: "Созданы биг-бэги: 1" })
        .waitFor();
      assert.equal(x.state.writes[1].kind, "DRYING");
      await x.finish();
    },
  ],
  [
    "Приёмщик готовой продукции не засчитывает упаковку",
    async () => {
      const x = await setup("FINISHED_RECEIVER", "ready");
      await x.scan();
      await form(x.page, "Склад готовой продукции")
        .getByRole("button", { name: "Принять этот биг-бэг", exact: true })
        .click();
      await x.page
        .getByRole("heading", { name: "Упаковка", exact: true })
        .waitFor();
      assert.equal(x.state.phase, "received");
      assert.equal(
        x.state.writes.filter((r) => r.path.endsWith("/pack")).length,
        0,
      );
      await x.finish();
    },
  ],
  [
    "Упаковщик не может обработать партию до своего этапа",
    async () => {
      const x = await setup("PACKER", "accepted");
      await x.scan();
      await x.page
        .getByRole("heading", { name: "Партия ещё не дошла до упаковки" })
        .waitFor();
      assert.equal(x.state.writes.length, 0);
      assert.equal(
        await x.page
          .getByRole("button", { name: "Биг-бэг упакован", exact: true })
          .count(),
        0,
      );
      await x.finish();
    },
  ],
  [
    "Сканирование упаковщика зачисляет смену один раз",
    async () => {
      const x = await setup("PACKER", "received");
      await x.page.getByLabel("Смена", { exact: true }).fill("Ночная");
      await x.scan();
      await x.page
        .getByText("Биг-бэг №1 упакован и записан в вашу смену «Ночная».", {
          exact: true,
        })
        .waitFor();
      assert.equal(x.state.writes.length, 1);
      assert.equal(x.state.writes[0].actor, "PACKER");
      assert.equal(x.state.writes[0].shift, "Ночная");
      await x.scan();
      await x.page
        .getByRole("heading", { name: "Биг-бэг уже упакован" })
        .waitFor();
      assert.equal(x.state.writes.length, 1);
      await x.finish();
    },
  ],
  [
    "Водителю открывается нужный рейс и следующее действие",
    async () => {
      const x = await setup("DRIVER", "incoming");
      await x.scan();
      await x.page
        .getByRole("button", { name: "Загрузился", exact: true })
        .click();
      await x.page
        .getByRole("button", {
          name: "Выехал · включить геолокацию",
          exact: true,
        })
        .waitFor();
      assert.equal(x.state.writes[0].status, "LOADED");
      await x.finish();
    },
  ],
  [
    "Обновление сохраняет вход; явный выход сохраняется после обновления",
    async () => {
      const x = await setup("WASH_RECEIVER", "incoming");
      const cookie = (await x.context.cookies()).find(
        (c) => c.name === "bioflow_refresh",
      );
      assert(cookie?.httpOnly);
      assert.equal(
        await x.page.evaluate(() =>
          document.cookie.includes("bioflow_refresh"),
        ),
        false,
      );
      await x.page.reload();
      await x.page
        .getByRole("button", { name: "QR-сканер", exact: true })
        .waitFor();
      assert.equal(await x.page.locator("#login-email").count(), 0);
      await x.page.getByRole("button", { name: "Выйти", exact: true }).click();
      await x.page.locator("#login-email").waitFor();
      await x.page.reload();
      await x.page.locator("#login-email").waitFor();
      assert.equal(x.state.logged, false);
      await x.finish();
    },
  ],
  [
    "Отказ камеры даёт русское сообщение без меню фото и ручного кода",
    async () => {
      const x = await setup("WASH_RECEIVER", "incoming", true);
      await x.page
        .getByRole("button", { name: "QR-сканер", exact: true })
        .click();
      await x.page.getByRole("dialog").getByRole("alert").waitFor();
      assert.match(
        await x.page.getByRole("dialog").getByRole("alert").innerText(),
        /Разрешите доступ к камере/,
      );
      assert.equal(
        await x.page.getByRole("dialog").locator("input").count(),
        0,
      );
      assert.equal(
        await x.page
          .getByRole("button", { name: "Сканировать ещё раз" })
          .count(),
        1,
      );
      await x.finish();
    },
  ],
];
(async () => {
  qrImage = await QR.toDataURL("physical-code", { width: 512, margin: 4 });
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const repeats = Number(process.env.BIOFLOW_FLOW_REPEATS || 1);
  try {
    for (let round = 1; round <= repeats; round++)
      for (let i = 0; i < scenarios.length; i++) {
        await scenarios[i][1]();
        console.log(`PASS ${round}/${repeats} ${i + 1}/10: ${scenarios[i][0]}`);
      }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
