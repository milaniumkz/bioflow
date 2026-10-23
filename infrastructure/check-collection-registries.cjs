/* Read-only UI checks against an explicitly isolated local copy. No credentials in output. */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const origin = process.env.COLLECTION_UI_ORIGIN || "http://127.0.0.1:3059";
const url = new URL(origin);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.port)
  throw Error("Isolated local port required");
const fixture = JSON.parse(
  fs.readFileSync(process.env.COLLECTION_UI_FIXTURE_FILE),
);
const out = process.env.COLLECTION_UI_REPORT_DIR;
if (!out) throw Error("Report directory required");
const checks = [];
(async () => {
  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.HTTP_PROXY
      ? { server: process.env.HTTP_PROXY, bypass: "localhost,127.0.0.1" }
      : undefined,
  });
  const c = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const p = await c.newPage();
  try {
    await p.goto(origin);
    const account = fixture.accounts.OWNER;
    await p.getByLabel("Номер телефона", { exact: true }).fill(account.phone);
    await p.locator("#login-password").fill(account.password);
    await p.getByRole("button", { name: "Войти", exact: true }).click();
    await p
      .getByRole("heading", { name: "Материал по этапам", exact: true })
      .waitFor();
    assert(
      await p.evaluate(async () => {
        await document.fonts.ready;
        return (
          document.fonts.check('14px "Open Sans"') &&
          getComputedStyle(document.body).fontFamily.startsWith('"Open Sans"')
        );
      }),
    );
    checks.push("Approved Open Sans loaded in browser");
    for (const [name, key] of [
      ["Лаборатория", "laboratory"],
      ["Биг-бэги и упаковка", "big-bags"],
    ]) {
      await p
        .locator(".nav details")
        .evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
      await p
        .locator(".nav")
        .getByRole("button", { name, exact: true })
        .click();
      await p.locator("tbody tr").first().waitFor();
      await p.screenshot({
        path: path.join(out, key + "-registry-desktop.png"),
        fullPage: true,
      });
      await p
        .locator("tbody tr")
        .first()
        .getByRole("button", { name: "Открыть", exact: true })
        .click();
      const dialog = p.getByRole("dialog", {
        name: "Паспорт партии",
        exact: true,
      });
      await dialog.getByText("Карточка партии", { exact: true }).waitFor();
      assert(
        await dialog
          .getByRole("button", { name: "Вся история партии", exact: true })
          .isVisible(),
      );
      await p.screenshot({
        path: path.join(out, key + "-passport-desktop.png"),
        fullPage: true,
      });
      await p.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      checks.push(
        name + ": real rows, scoped passport, history action and Escape",
      );
      const search = p.getByRole("textbox", {
        name: "Номер партии",
        exact: true,
      });
      await search.fill("collection-no-such-number-uat");
      await p.getByText("Нет совпадений", { exact: true }).waitFor();
      await p
        .getByRole("button", { name: "Сбросить фильтры", exact: true })
        .click();
      await p.locator("tbody tr").first().waitFor();
      checks.push(name + ": empty filtered result and reset");
      await p.setViewportSize({ width: 390, height: 844 });
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await p.screenshot({
        path: path.join(out, key + "-registry-mobile.png"),
        fullPage: true,
      });
      checks.push(name + ": 390px without page overflow");
      await p.setViewportSize({ width: 1440, height: 1000 });
    }
    fs.writeFileSync(
      path.join(out, "registry-checks.json"),
      JSON.stringify({ origin, checks, passed: checks.length }, null, 2),
    );
    console.log(JSON.stringify({ passed: checks.length }));
  } finally {
    await c.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
