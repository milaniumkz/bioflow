/* Local isolated UI check. Never submits an administrative or stock mutation. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const origin = process.env.COLLECTION_UI_ORIGIN || "http://127.0.0.1:3059",
  u = new URL(origin);
if (!["127.0.0.1", "localhost"].includes(u.hostname) || !u.port)
  throw Error("Explicit isolated local port required");
const fixture = JSON.parse(
  fs.readFileSync(process.env.COLLECTION_UI_FIXTURE_FILE),
);
const out = process.env.COLLECTION_UI_REPORT_DIR;
if (!out) throw Error("Report directory required");
fs.mkdirSync(out, { recursive: true });
(async () => {
  const checks = [];
  const b = await chromium.launch({
    headless: true,
    proxy: process.env.HTTP_PROXY
      ? { server: process.env.HTTP_PROXY, bypass: "127.0.0.1,localhost" }
      : undefined,
  });
  const c = await b.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const p = await c.newPage();
  async function section(name) {
    await p
      .locator(".nav details")
      .evaluateAll((ns) => ns.forEach((n) => (n.open = true)));
    await p.locator(".nav").getByRole("button", { name, exact: true }).click();
    await p.waitForTimeout(250);
  }
  async function snap(name) {
    await p.screenshot({
      path: path.join(out, name + ".png"),
      fullPage: (await p.locator("dialog:modal").count()) === 0,
    });
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      name + " page overflow",
    );
  }
  try {
    await p.goto(origin);
    await p
      .getByLabel("Номер телефона", { exact: true })
      .fill(fixture.accounts.OWNER.phone);
    await p.locator("#login-password").fill(fixture.accounts.OWNER.password);
    await p.getByRole("button", { name: "Войти", exact: true }).click();
    await p
      .getByRole("heading", { name: "Материал по этапам", exact: true })
      .waitFor();
    const names = await p.locator(".nav button").allTextContents();
    for (const name of names) {
      await section(name);
      await p
        .locator("details.section-editor")
        .evaluateAll((ns) => ns.forEach((n) => (n.open = true)));
      const missing = await p
        .locator("input,select,textarea")
        .evaluateAll((ns) =>
          ns
            .filter(
              (e) =>
                e.type !== "hidden" &&
                !e.getAttribute("aria-label") &&
                !e.getAttribute("aria-labelledby") &&
                !e.labels?.length,
            )
            .map((e) => e.tagName + ":" + e.name),
        );
      assert.deepEqual(missing, [], name + " unlabeled controls");
      checks.push(name + ": every rendered field has an accessible name");
      if (
        [
          "Контрагенты",
          "Транспорт",
          "Водители",
          "Места добычи",
          "Заводы",
          "Склады",
          "Материалы",
          "Продукция",
          "Причины и единицы",
          "Пользователи",
          "Роли",
          "Аудит",
          "Настройки",
          "Сессии",
          "Уведомления",
        ].includes(name)
      ) {
        const hash = await p.evaluate(() => location.hash.slice(1));
        await snap("workbench-" + hash + "-desktop");
        await p.setViewportSize({ width: 390, height: 844 });
        await snap("workbench-" + hash + "-mobile");
        await p.setViewportSize({ width: 1440, height: 1000 });
        checks.push(name + ": desktop/mobile form and list layout");
      }
    }
    await section("Отчёты");
    const reports = [
      "extraction",
      "waybills",
      "discrepancies",
      "movements",
      "inventory",
      "turnover",
      "washing",
      "production",
      "losses",
      "transfers",
      "shipments",
      "reconciliation",
      "audit",
    ];
    for (const type of reports) {
      const sel = p.getByRole("combobox", { name: "Тип отчёта", exact: true });
      if ((await sel.inputValue()) !== type) {
        const response = p.waitForResponse(
          (r) =>
            new URL(r.url()).pathname.endsWith("/ledger/reports/" + type) &&
            r.request().method() === "GET",
        );
        await sel.selectOption(type);
        assert.equal((await response).status(), 200);
      }
      await p
        .getByRole("heading", { name: "Результат отчёта", exact: true })
        .waitFor();
      await snap("report-" + type + "-desktop");
      await p.setViewportSize({ width: 390, height: 844 });
      await snap("report-" + type + "-mobile");
      await p.setViewportSize({ width: 1440, height: 1000 });
      if (["production", "losses"].includes(type))
        assert(
          (await p.locator(".report-results tbody tr").count()) > 0,
          type + " process data missing",
        );
      const dl = p.waitForEvent("download");
      await p.getByRole("button", { name: "Скачать CSV", exact: true }).click();
      const download = await dl;
      assert.equal(await download.failure(), null);
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      assert(Buffer.concat(chunks).length > 0);
      checks.push(
        type + ": real report, 1440/390px and completed CSV transfer",
      );
    }
    for (const format of ["XLSX", "PDF"]) {
      const dl = p.waitForEvent("download");
      await p
        .getByRole("button", { name: "Скачать " + format, exact: true })
        .click();
      const d = await dl;
      assert.equal(await d.failure(), null);
      const stream = await d.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      assert(
        format === "PDF"
          ? bytes.subarray(0, 4).toString() === "%PDF"
          : bytes.subarray(0, 2).toString() === "PK",
      );
      checks.push(
        "Real " + format + " export signature and completed download",
      );
    }
    await section("Партии и операции");
    await p.getByRole("button", { name: "Доступ", exact: true }).click();
    await p
      .locator(".ledger-desktop-table tbody tr")
      .first()
      .getByRole("button", { name: "Открыть", exact: true })
      .click();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "Назначить доступ", exact: true })
      .click();
    await p.locator(".scope-choices").first().waitFor();
    assert.equal(
      await p.locator("dialog:modal").count(),
      1,
      "object access must be a modal",
    );
    assert(
      (await p
        .getByText("ID складов через запятую", { exact: true })
        .count()) === 0,
    );
    await snap("object-access-names-desktop");
    await p.setViewportSize({ width: 390, height: 844 });
    await snap("object-access-names-mobile");
    checks.push(
      "Object access selects actual named warehouses/sites without technical IDs",
    );
    fs.writeFileSync(
      path.join(out, "workbench-checks.json"),
      JSON.stringify({ origin, checks, passed: checks.length }, null, 2),
    );
    console.log(JSON.stringify({ passed: checks.length }));
  } finally {
    await c.close();
    await b.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
