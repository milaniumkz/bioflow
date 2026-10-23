/* Isolated local read-only role entry checks. No credentials are printed. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const origin = process.env.COLLECTION_UI_ORIGIN || "http://127.0.0.1:3059",
  url = new URL(origin);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.port)
  throw Error("Isolated local port required");
const fixture = JSON.parse(
  fs.readFileSync(process.env.COLLECTION_UI_FIXTURE_FILE),
);
const out = process.env.COLLECTION_UI_REPORT_DIR;
if (!out) throw Error("Report directory required");
(async () => {
  const checks = [];
  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.HTTP_PROXY
      ? { server: process.env.HTTP_PROXY, bypass: "localhost,127.0.0.1" }
      : undefined,
  });
  try {
    for (const [role, account] of [
      ...Object.entries(fixture.accounts),
      ["DRIVER", fixture.driver],
    ]) {
      await new Promise((r) => setTimeout(r, 10000));
      const c = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const p = await c.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      try {
        await p.goto(origin);
        await p
          .getByLabel("Номер телефона", { exact: true })
          .fill(account.phone);
        await p.locator("#login-password").fill(account.password);
        await p.getByRole("button", { name: "Войти", exact: true }).click();
        await p.getByRole("button", { name: "Выйти", exact: true }).waitFor();
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          role + " overflow",
        );
        assert.equal(errors.length, 0, role + " client errors");
        if (role === "AUDITOR") {
          await p
            .getByRole("button", { name: "Открыть меню", exact: true })
            .click();
          const buttons = await p.locator(".nav button").allTextContents();
          assert(!buttons.includes("Пользователи"));
        }
        await p.screenshot({
          path: path.join(out, "role-" + role.toLowerCase() + "-mobile.png"),
          fullPage: true,
        });
        checks.push(
          role +
            ": actual login, permission-selected home, 390px, no client crash",
        );
      } finally {
        await c.close();
      }
    }
    fs.writeFileSync(
      path.join(out, "role-checks.json"),
      JSON.stringify({ origin, checks, passed: checks.length }, null, 2),
    );
    console.log(JSON.stringify({ passed: checks.length }));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
