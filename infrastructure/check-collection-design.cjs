/* Read-only local UI regression. Never accepts a remote/prod origin or prints credentials. */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const origin = process.env.COLLECTION_UI_ORIGIN || "http://127.0.0.1:3059";
const url = new URL(origin);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.port)
  throw Error("Use an explicitly port-bound isolated local test copy.");
const fixture = JSON.parse(
  fs.readFileSync(process.env.COLLECTION_UI_FIXTURE_FILE),
);
const out = process.env.COLLECTION_UI_REPORT_DIR;
if (!out) throw Error("Set COLLECTION_UI_REPORT_DIR outside the repository.");
fs.mkdirSync(out, { recursive: true });
const checks = [];
(async () => {
  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.HTTP_PROXY
      ? { server: process.env.HTTP_PROXY, bypass: "127.0.0.1,localhost" }
      : undefined,
  });
  async function context(width) {
    const c = await browser.newContext({
      viewport: { width, height: width > 900 ? 1000 : 844 },
      timezoneId: "Asia/Yekaterinburg",
    });
    return { c, p: await c.newPage() };
  }
  async function noOverflow(p, label) {
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      label + " horizontal overflow",
    );
    checks.push(label);
  }
  async function login(p, role) {
    await p.goto(origin);
    const a = fixture.accounts[role];
    await p.getByLabel("Номер телефона", { exact: true }).fill(a.phone);
    await p.locator("#login-password").fill(a.password);
    await p.getByRole("button", { name: "Войти", exact: true }).click();
  }
  try {
    for (const width of [320, 360, 390, 768, 1024, 1440]) {
      const { c, p } = await context(width);
      await p.goto(origin);
      await noOverflow(p, "Login " + width);
      assert.equal(await p.locator("#login-password").inputValue(), "");
      await p.getByRole("button", { name: "Показать пароль" }).click();
      assert.equal(
        await p.locator("#login-password").getAttribute("type"),
        "text",
      );
      await p.getByRole("button", { name: "Скрыть пароль" }).click();
      if (width === 390 || width === 1440)
        await p.screenshot({
          path: path.join(out, "login-" + width + ".png"),
          fullPage: true,
        });
      if (width === 320) {
        await p.evaluate(() => {
          const styles = Array.from(document.querySelectorAll("body *")).map(
            (e) => [
              e,
              parseFloat(getComputedStyle(e).fontSize),
              parseFloat(getComputedStyle(e).lineHeight),
            ],
          );
          for (const [e, size, line] of styles) {
            e.style.fontSize = size * 2 + "px";
            if (Number.isFinite(line)) e.style.lineHeight = line * 2 + "px";
          }
        });
        await noOverflow(p, "Login 320 text 200%");
        await p.screenshot({
          path: path.join(out, "login-text-200.png"),
          fullPage: true,
        });
      }
      await c.close();
    }
    const { c, p } = await context(1440);
    await login(p, "OWNER");
    await p
      .getByRole("heading", { name: "Материал по этапам", exact: true })
      .waitFor();
    await p.screenshot({ path: path.join(out, "owner-viewport-1440.png") });
    const sections = await p
      .locator(".nav button")
      .evaluateAll((nodes) => nodes.map((n) => n.textContent.trim()));
    for (const name of sections) {
      await p
        .locator(".nav details")
        .evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
      await p
        .locator(".nav")
        .getByRole("button", { name, exact: true })
        .click();
      await p.waitForTimeout(180);
      await noOverflow(p, "Section " + name);
      if (
        [
          "Партии и операции",
          "Пользователи",
          "Роли",
          "Сессии",
          "Отчёты",
          "Аудит",
          "Настройки",
        ].includes(name)
      ) {
        await p.screenshot({
          path: path.join(
            out,
            "section-" +
              (await p.evaluate(() => location.hash.slice(1))) +
              ".png",
          ),
        });
      }
    }
    for (const width of [320, 390, 768, 1024]) {
      await p.setViewportSize({ width, height: 844 });
      await noOverflow(p, "Authenticated shell " + width);
    }
    await c.close();
    const mobile = await context(390);
    await login(mobile.p, "COLLECTOR");
    await mobile.p
      .getByRole("heading", { name: "Новая отправка", exact: true })
      .waitFor();
    const f = mobile.p.locator("form").filter({
      has: mobile.p.getByRole("heading", {
        name: "Новая отправка",
        exact: true,
      }),
    });
    let dispatches = 0;
    mobile.p.on("request", (r) => {
      if (r.url().endsWith("/collection/dispatch") && r.method() === "POST")
        dispatches++;
    });
    for (const [name, value] of Object.entries({
      counterpartyId: fixture.partyId,
      extractionSiteId: fixture.siteId,
      materialTypeId: fixture.materialTypeId,
    }))
      await f.locator(`[name=${name}]`).selectOption(value);
    await f.getByLabel("Количество мешков", { exact: true }).fill("2");
    await f.getByLabel("Вес, т", { exact: true }).fill("-1");
    await f.getByRole("button", { name: "Далее: машина и водитель" }).click();
    assert(await f.getByLabel("Вес, т", { exact: true }).isVisible());
    assert.equal(dispatches, 0);
    checks.push("Invalid weight stays on cargo step");
    await f.getByLabel("Вес, т", { exact: true }).fill("1,234");
    await f.getByRole("button", { name: "Далее: машина и водитель" }).click();
    for (const [name, value] of Object.entries({
      vehicleId: fixture.trip.vehicleId,
      driverId: fixture.trip.driverId,
      destinationWarehouseId: fixture.warehouses[0].id,
    }))
      await f.locator(`[name=${name}]`).selectOption(value);
    await f.getByRole("button", { name: "Далее: проверка отправки" }).click();
    assert(
      await f
        .getByRole("button", { name: "Создать отправку и QR" })
        .isEnabled(),
    );
    assert.equal(dispatches, 0);
    checks.push("Review step never submits dispatch");
    await f.getByRole("button", { name: "Назад", exact: true }).click();
    await f.getByRole("button", { name: "Назад", exact: true }).click();
    assert.equal(
      await f.getByLabel("Вес, т", { exact: true }).inputValue(),
      "1,234",
    );
    assert.equal(
      await f.getByLabel("Количество мешков", { exact: true }).inputValue(),
      "2",
    );
    checks.push("Back preserves entered cargo");
    await mobile.p
      .getByRole("button", { name: "Открыть меню", exact: true })
      .click();
    mobile.p.once("dialog", (dialog) => dialog.dismiss());
    await mobile.p
      .locator(".nav")
      .getByRole("button", { name: "Работа с партией по QR", exact: true })
      .click();
    assert(await f.getByLabel("Вес, т", { exact: true }).isVisible());
    checks.push("Cancel dirty navigation preserves form");
    await mobile.c.close();
    const network = await context(390);
    await login(network.p, "LAB_TECHNICIAN");
    await network.p
      .getByRole("heading", { name: "Открыть партию по QR", exact: true })
      .waitFor();
    await network.p
      .getByLabel("QR-код", { exact: true })
      .fill(fixture.trip.qrToken);
    await network.c.setOffline(true);
    await network.p
      .getByRole("button", { name: "Открыть партию", exact: true })
      .click();
    await network.p
      .getByText(
        "Нет связи с сервером. Проверьте подключение и повторите попытку.",
        { exact: true },
      )
      .first()
      .waitFor();
    assert.equal(
      await network.p.getByLabel("QR-код", { exact: true }).inputValue(),
      fixture.trip.qrToken,
    );
    checks.push("Offline scan keeps QR and gives a readable error");
    await network.c.setOffline(false);
    await network.p
      .getByRole("button", { name: "Открыть партию", exact: true })
      .click();
    await network.p.getByText("Карточка партии", { exact: true }).waitFor();
    checks.push("Reconnect safely retries the scan");
    await network.p.route("**/api/v1/auth/refresh", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Unauthorized" }),
      }),
    );
    await network.p.route("**/api/v1/processing/scan", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Unauthorized" }),
      }),
    );
    await network.p
      .getByLabel("QR-код", { exact: true })
      .fill("synthetic-expired-session-scan");
    await network.p
      .getByRole("button", { name: "Открыть партию", exact: true })
      .click();
    await network.p.locator("#login-password").waitFor();
    checks.push(
      "Expired session returns to login without persisted credentials",
    );
    await network.c.close();
    fs.writeFileSync(
      path.join(out, "ui-checks.json"),
      JSON.stringify({ checks }, null, 2),
    );
    console.log(JSON.stringify({ passed: checks.length }));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
