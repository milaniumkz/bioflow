/* Read-only audit detail check against explicitly isolated local data. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const origin = process.env.COLLECTION_UI_ORIGIN || "http://127.0.0.1:3059",
  url = new URL(origin);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.port)
  throw Error("Explicit isolated local port required");
const f = JSON.parse(fs.readFileSync(process.env.COLLECTION_UI_FIXTURE_FILE)),
  out = process.env.COLLECTION_UI_REPORT_DIR;
if (!out) throw Error("Report directory required");
(async () => {
  const b = await chromium.launch({
    headless: true,
    proxy: process.env.HTTP_PROXY
      ? { server: process.env.HTTP_PROXY, bypass: "localhost,127.0.0.1" }
      : undefined,
  });
  const c = await b.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "ru-RU",
    }),
    p = await c.newPage(),
    checks = [];
  try {
    await p.goto(origin);
    await p
      .getByLabel("Номер телефона", { exact: true })
      .fill(f.accounts.OWNER.phone);
    await p.locator("#login-password").fill(f.accounts.OWNER.password);
    await p.getByRole("button", { name: "Войти", exact: true }).click();
    await p
      .getByRole("heading", { name: "Материал по этапам", exact: true })
      .waitFor();
    await p
      .locator(".nav details")
      .evaluateAll((ns) => ns.forEach((n) => (n.open = true)));
    await p
      .locator(".nav")
      .getByRole("button", { name: "Аудит", exact: true })
      .click();
    const response = p.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith("/audit") &&
        new URL(r.url()).searchParams.get("status") === "user.access",
    );
    await p.getByLabel("Действие", { exact: true }).selectOption("user.access");
    assert.equal((await response).status(), 200);
    await p
      .locator("tbody tr")
      .first()
      .getByRole("button", { name: "Открыть", exact: true })
      .click();
    const detail = p.getByRole("dialog");
    await detail
      .getByRole("heading", { name: "Было / стало", exact: true })
      .waitFor();
    assert.equal(await p.locator("dialog:modal").count(), 1);
    assert.equal(
      (await detail.innerText()).includes("user.access"),
      false,
      "action value must be readable in Russian",
    );
    assert.equal(
      await detail.getByRole("heading", { name: "id", exact: true }).count(),
      0,
    );
    const diff = detail.getByRole("region", {
      name: "Изменения записи",
      exact: true,
    });
    assert(
      (await diff.getByText(f.warehouses[0].name, { exact: true }).count()) > 0,
    );
    assert(!(await diff.innerText()).includes(f.warehouses[0].id));
    checks.push(
      "Real access event: before/after, current scoped object names and no raw warehouse identifiers",
    );
    await p.screenshot({
      path: path.join(out, "audit-before-after-desktop.png"),
    });
    await p.setViewportSize({ width: 390, height: 844 });
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await p.screenshot({
      path: path.join(out, "audit-before-after-mobile.png"),
    });
    checks.push("Audit change cards at 1440/390px in a real modal");
    await p.keyboard.press("Escape");
    await detail.waitFor({ state: "detached" });
    assert.equal(
      await p.getByLabel("Действие", { exact: true }).inputValue(),
      "user.access",
    );
    checks.push(
      "Escape returns to the filtered registry without losing context",
    );
    fs.writeFileSync(
      path.join(out, "audit-checks.json"),
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
