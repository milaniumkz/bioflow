// Exercise read-only filter controls through the real localhost UI/API.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const base = process.env.BIOFLOW_UI_URL || "http://localhost:3015";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const errors = [],
    tested = [];
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    p.on("dialog", (d) => d.accept());
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("response", (r) => {
      if (r.status() >= 400 && !r.url().endsWith("/auth/browser-refresh"))
        errors.push(r.status() + " " + r.url());
    });
    await p.goto(base);
    await p.locator("#login-email").fill("android-owner@uat.local");
    await p.locator("#login-password").fill("IntegrationOnly2026!");
    await p.getByRole("button", { name: "Войти", exact: true }).click();
    await p.locator("nav.nav").waitFor();
    await p
      .locator("nav.nav details")
      .evaluateAll((es) => es.forEach((e) => (e.open = true)));
    const sections = await p.locator("nav.nav button").allTextContents();
    for (const section of sections) {
      await p
        .locator("nav.nav details")
        .evaluateAll((es) => es.forEach((e) => (e.open = true)));
      await p
        .locator("nav.nav")
        .getByRole("button", { name: section.trim(), exact: true })
        .click();
      await p.waitForTimeout(400);
      const controls = await p
        .locator(
          "main .toolbar input:visible,main .toolbar select:visible,.owner-filters input:visible,.owner-filters select:visible",
        )
        .evaluateAll((es) =>
          es
            .filter(
              (e) =>
                !e.closest("form") &&
                !e.disabled &&
                ["SELECT", "text", "search", "date"].some(
                  (t) => e.tagName === t || e.type === t,
                ),
            )
            .map((e, i) => {
              e.dataset.filterProbe = String(i);
              return {
                id: i,
                label:
                  e.getAttribute("aria-label") ||
                  e.labels?.[0]?.innerText ||
                  e.placeholder,
                tag: e.tagName,
                type: e.type,
                value: e.value,
                alternative:
                  e.tagName === "SELECT"
                    ? [...e.options].find(
                        (o) => !o.disabled && o.value !== e.value,
                      )?.value
                    : undefined,
              };
            }),
        );
      for (const c of controls) {
        const x = p
          .locator(
            "main .toolbar input:visible,main .toolbar select:visible,.owner-filters input:visible,.owner-filters select:visible",
          )
          .nth(c.id);
        if (!(await x.count())) continue;
        if (c.tag === "SELECT") {
          if (c.alternative === undefined) continue;
          await x.selectOption(c.alternative);
          await p.waitForTimeout(200);
          await x.selectOption(c.value);
        } else {
          await x.fill(
            c.type === "date" ? "2000-01-01" : "Проверка отсутствующей записи",
          );
          await p.waitForTimeout(200);
          await x.fill(c.value);
        }
        await p.waitForTimeout(100);
        tested.push({ section: section.trim(), field: c.label });
      }
      console.log("PASS filters", section.trim(), controls.length);
      fs.writeFileSync(
        "/tmp/filter-ui-results.json",
        JSON.stringify({ tested, errors }, null, 2),
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS",
      tested.length,
      "filter fields across",
      sections.length,
      "sections",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
