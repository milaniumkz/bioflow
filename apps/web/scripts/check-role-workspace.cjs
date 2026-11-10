// Real browser + real isolated API. No intercepted business responses.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const base = process.env.BIOFLOW_UI_URL || "http://localhost:3015";
assert(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "Only an isolated local UI is allowed",
);
const out = process.env.BIOFLOW_AUDIT_DIR || "/tmp/bioflow-role-audit";
fs.mkdirSync(out, { recursive: true });
const roles = [
  "OWNER",
  "ADMIN",
  "COLLECTOR",
  "DRIVER",
  "WASH_RECEIVER",
  "LAB_TECHNICIAN",
  "WASH_OPERATOR",
  "DRYING_OPERATOR",
  "FINISHED_RECEIVER",
  "PACKER",
  "SALES_STOREKEEPER",
  "CONTRACTOR_REP",
  "RECEIVER",
  "PRODUCTION_OPERATOR",
  "DISPATCHER",
  "EXTRACTION_OPERATOR",
  "LOADING_OPERATOR",
  "WAREHOUSE_OPERATOR",
  "AUDITOR",
];
const report = {
  screens: [],
  errors: [],
  downloads: [],
  roles: [],
  actions: [],
};
const persist = () =>
  fs.writeFileSync(
    path.join(out, "audit.json"),
    JSON.stringify(report, null, 2),
  );
async function snapshot(page, role, section) {
  const buttons = await page.locator("main button:visible").evaluateAll((es) =>
    es.map((e) => ({
      text: e.innerText.trim() || e.getAttribute("aria-label"),
      disabled: e.disabled,
    })),
  );
  const fields = await page
    .locator("main input:visible,main select:visible,main textarea:visible")
    .evaluateAll((es) =>
      es.map((e) => ({
        label:
          e.labels?.[0]?.innerText ||
          e.getAttribute("aria-label") ||
          e.placeholder ||
          "",
        type: e.type,
        required: e.required,
        disabled: e.disabled,
        options:
          e.tagName === "SELECT"
            ? [...e.options].map((o) => ({ text: o.text, value: o.value }))
            : undefined,
      })),
    );
  const errors = await page
    .locator("main .error:visible,main [role=alert]:visible")
    .allTextContents();
  report.screens.push({ role, section, buttons, fields, errors });
  for (const error of errors)
    if (error.trim()) report.errors.push({ role, section, error });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 2,
  );
  if (overflow)
    report.errors.push({
      role,
      section,
      error: "Horizontal viewport overflow",
    });
  persist();
}
async function inspectActions(page, role, section) {
  const summaries = page.locator("main details > summary:visible");
  const names = await summaries.allTextContents();
  for (const name of names) {
    const summary = page
      .locator("main details > summary")
      .filter({ hasText: name })
      .first();
    if (!(await summary.count())) continue;
    await summary.click();
    await page.waitForTimeout(100);
    await snapshot(page, role, section + " / Форма " + name.trim());
    if (name.trim() === "Новая операция") {
      const kinds = await page
        .getByLabel("Операция", { exact: true })
        .locator("option")
        .evaluateAll((es) => es.map((e) => e.value));
      if (["WASH_OPERATOR", "PRODUCTION_OPERATOR"].includes(role))
        assert(
          kinds.every((k) => ["WASHING", "PRODUCTION"].includes(k)),
          "Operator must not be offered warehouse commands",
        );
      if (role === "WAREHOUSE_OPERATOR")
        assert(
          kinds.every((k) => !["WASHING", "PRODUCTION"].includes(k)),
          "Warehouse worker must not be offered production commands",
        );
    }
    report.actions.push({ role, section, action: "open form", name });
    await summary.click();
  }
  const open = page
    .getByRole("button", { name: "Открыть", exact: true })
    .first();
  if ((await open.count()) && (await open.isVisible())) {
    await open.click();
    await page.waitForTimeout(250);
    await snapshot(page, role, section + " / Карточка");
    const drawer = page.getByRole("dialog").last();
    if (await drawer.count()) {
      const close = drawer
        .getByRole("button", {
          name: /Закрыть карточку|Закрыть паспорт|Закрыть/,
          exact: false,
        })
        .first();
      if (await close.count()) await close.click();
      else await page.keyboard.press("Escape");
      await drawer.waitFor({ state: "hidden" });
      report.actions.push({ role, section, action: "record open and close" });
    }
  }
  const refresh = page
    .getByRole("button", { name: "Обновить", exact: true })
    .first();
  if ((await refresh.count()) && (await refresh.isEnabled())) {
    await refresh.click();
    report.actions.push({ role, section, action: "refresh" });
  }
}
async function exportReports(page, role) {
  const type = page.getByLabel("Тип отчёта", { exact: true });
  const format = page.getByLabel("Формат файла", { exact: true });
  const types = await type
    .locator("option")
    .evaluateAll((es) => es.map((e) => e.value));
  const hasFormat = (await format.count()) > 0;
  for (const t of types) {
    await type.selectOption(t);
    for (const f of ["csv", "xlsx", "pdf"]) {
      if (hasFormat) await format.selectOption(f);
      await page.waitForTimeout(1000);
      try {
        const pending = page.waitForEvent("download", { timeout: 15000 });
        await page
          .getByRole("button", {
            name: hasFormat ? "Скачать отчёт" : `Скачать ${f.toUpperCase()}`,
            exact: true,
          })
          .click();
        const download = await pending;
        assert.match(download.suggestedFilename(), /^Отчёт/);
        const target = path.join(out, `${role}-${t}.${f}`);
        await download.saveAs(target);
        const data = fs.readFileSync(target);
        if (f === "pdf") assert.equal(data.subarray(0, 4).toString(), "%PDF");
        if (f === "xlsx") assert.equal(data.subarray(0, 2).toString(), "PK");
        report.downloads.push({ role, type: t, format: f, bytes: data.length });
      } catch (e) {
        report.errors.push({
          role,
          section: "reports",
          type: t,
          format: f,
          error: e.message,
          visible: await page.locator("main").innerText(),
        });
      }
      persist();
    }
  }
}
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const role of (process.env.BIOFLOW_AUDIT_REVERSE
      ? [...roles].reverse()
      : roles
    ).filter(
      (r) =>
        !process.env.BIOFLOW_AUDIT_ROLE || r === process.env.BIOFLOW_AUDIT_ROLE,
    )) {
      const context = await browser.newContext({
        viewport: {
          width: process.env.BIOFLOW_MOBILE ? 390 : 1440,
          height: 1000,
        },
        acceptDownloads: true,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("dialog", (d) => d.accept());
      let section = "login";
      page.on("pageerror", (e) => {
        report.errors.push({ role, section, error: e.message });
        persist();
      });
      page.on("response", (r) => {
        if (r.status() >= 400 && !r.url().endsWith("/auth/browser-refresh")) {
          report.errors.push({
            role,
            section,
            status: r.status(),
            url: r.url(),
          });
          persist();
        }
      });
      await page.goto(base);
      await page
        .locator("input")
        .first()
        .fill(`android-${role.toLowerCase()}@uat.local`);
      await page.locator("#login-password").fill("IntegrationOnly2026!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await page.locator("nav.nav").waitFor({ state: "attached" });
      await page.waitForFunction(() => {
        const nav = document.querySelector("nav.nav");
        return (
          Boolean(nav && nav.getBoundingClientRect().width) ||
          [...document.querySelectorAll("button")].some(
            (b) => b.textContent.trim() === "Открыть меню",
          )
        );
      });
      if (!(await page.locator("nav.nav").isVisible()))
        await page
          .getByRole("button", { name: "Открыть меню", exact: true })
          .click();
      await page
        .locator("nav.nav details")
        .evaluateAll((es) => es.forEach((e) => (e.open = true)));
      const names = await page.locator("nav.nav button").allTextContents();
      report.roles.push({ role, sections: names.map((x) => x.trim()) });
      persist();
      for (const name of names) {
        section = name.trim();
        if (process.env.BIOFLOW_AUDIT_DELAY_MS)
          await page.waitForTimeout(Number(process.env.BIOFLOW_AUDIT_DELAY_MS));
        if (!(await page.locator("nav.nav").isVisible()))
          await page
            .getByRole("button", { name: "Открыть меню", exact: true })
            .click();
        await page
          .locator("nav.nav details")
          .evaluateAll((es) => es.forEach((e) => (e.open = true)));
        await page
          .locator("nav.nav")
          .getByRole("button", { name: section, exact: true })
          .click();
        await page.waitForTimeout(400);
        await snapshot(page, role, section);
        await inspectActions(page, role, section);
        if (section === "Отчёты" && !process.env.BIOFLOW_SKIP_EXPORTS)
          await exportReports(page, role);
        const tabs = page.locator("main button").filter({
          hasText: /^(Партии добычи|Перевозки|Остатки|Операции|Отчёты|Доступ)$/,
        });
        const tabNames = await tabs.allTextContents();
        for (const tab of tabNames) {
          try {
            await tabs
              .filter({ hasText: new RegExp("^" + tab + "$") })
              .first()
              .click({ timeout: 10000 });
            await page.waitForTimeout(250);
            await snapshot(page, role, section + " / " + tab.trim());
          } catch (e) {
            report.errors.push({ role, section, tab, error: e.message });
            persist();
          }
        }
      }
      await page.screenshot({
        path: path.join(out, role + ".png"),
        fullPage: true,
      });
      await context.close();
      console.log("CHECKED", role, names.length, "sections");
    }
  } finally {
    await browser.close();
    persist();
  }
  console.log(
    JSON.stringify({
      screens: report.screens.length,
      downloads: report.downloads.length,
      errors: report.errors.length,
    }),
  );
  if (report.errors.length) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  persist();
  process.exitCode = 1;
});
