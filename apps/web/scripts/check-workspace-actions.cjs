// Mutating user journeys run only against disposable localhost *_spec fixtures.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.BIOFLOW_UI_URL || "http://localhost:3015";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const tag = Date.now().toString();
let page, browser, createdAccount;
const results = [];
async function login(p, role = "owner", password = "IntegrationOnly2026!") {
  await p.goto(base);
  await p.locator("#login-email").fill(`android-${role}@uat.local`);
  await p.locator("#login-password").fill(password);
  await p.getByRole("button", { name: "Войти", exact: true }).click();
  await p.locator("nav.nav").waitFor();
}
async function nav(name) {
  await page
    .locator("nav.nav details")
    .evaluateAll((es) => es.forEach((e) => (e.open = true)));
  await page
    .locator("nav.nav")
    .getByRole("button", { name, exact: true })
    .click();
}
async function responseFor(method, suffix, click) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === method &&
      new URL(r.url()).pathname.endsWith(suffix),
  );
  await click();
  const r = await response;
  const body = await r.json();
  assert(r.ok(), JSON.stringify({ method, suffix, status: r.status(), body }));
  return body;
}
async function references() {
  await nav("Сбор и отправка");
  const fixtures = [
    [
      "Контрагенты",
      "counterparties",
      {
        Название: "Проверка контрагента " + tag,
        БИН: tag.slice(-12).padStart(12, "0"),
        Телефон: "+77000000000",
        "Электронная почта": `audit-${tag}@uat.local`,
        Статус: "ACTIVE",
      },
    ],
    [
      "Транспорт",
      "vehicles",
      {
        Госномер: "AUD" + tag,
        Марка: "Тест",
        Тип: "Грузовик",
        Статус: "ACTIVE",
        Модель: "Проверка",
        "Грузоподъёмность, т": "20,500",
        "Тара, т": "7,125",
      },
    ],
    [
      "Водители",
      "drivers",
      { ФИО: "Проверка водителя " + tag, Телефон: "+7" + tag.slice(-10) },
    ],
    [
      "Места добычи",
      "extraction-sites",
      { Название: "Проверка добычи " + tag, Локация: "Тестовая площадка" },
    ],
    [
      "Склады",
      "warehouses",
      {
        Название: "Проверка склада " + tag,
        Адрес: "Тестовый адрес",
        "Мин. остаток, т": "0",
        "Вместимость, т": "100,125",
        "Тип склада": "RAW",
      },
    ],
    [
      "Заводы",
      "plants",
      { Название: "Проверка завода " + tag, Адрес: "Тестовый адрес" },
    ],
    ["Материалы", "material-types", { Название: "Проверка материала " + tag }],
    ["Продукция", "product-types", { Название: "Проверка продукции " + tag }],
    [
      "Причины и единицы",
      "reference-values",
      {
        Категория: "reason",
        Код: "audit-" + tag,
        Название: "Проверка причины " + tag,
      },
    ],
  ];
  for (const [name, entity, values] of fixtures) {
    await nav(name);
    const detail = page
      .locator("main details")
      .filter({ has: page.getByText("Добавить запись", { exact: true }) })
      .first();
    await detail.locator("summary").click();
    const submit = detail.getByRole("button", {
      name: "Сохранить",
      exact: true,
    });
    await submit.click();
    assert(
      (await detail.locator("input:invalid").count()) > 0,
      "Empty required form must remain invalid",
    );
    for (const [label, value] of Object.entries(values))
      await detail.getByLabel(label, { exact: true }).fill(value);
    const created = await responseFor("POST", "/" + entity, () =>
      submit.click(),
    );
    if (entity === "warehouses") {
      await nav("Сбор и отправка");
      await page
        .locator(
          `select[name=destinationWarehouseId] option[value="${created.id}"]`,
        )
        .waitFor({ state: "attached" });
      await nav(name);
    }
    const first = Object.keys(values)[0];
    const key = values["Название"] ?? values["Госномер"] ?? values["ФИО"];
    if (entity === "vehicles") assert.equal(created.capacity, "20.5");
    await page.getByLabel("Поиск", { exact: true }).fill(key);
    const row = page.locator("main tbody tr").filter({ hasText: key }).first();
    await row.getByRole("button", { name: "Открыть", exact: true }).click();
    const drawer = page.getByRole("dialog").last();
    const editor = drawer
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Редактировать", exact: true }),
      })
      .first();
    const changed = key + " изменено";
    await editor.locator("form input").first().fill(changed);
    await editor
      .getByLabel("Причина изменения", { exact: true })
      .fill("Проверка изменения");
    const updated = await responseFor("PATCH", `/${entity}/${created.id}`, () =>
      editor.getByRole("button", { name: "Обновить", exact: true }).click(),
    );
    assert.equal(updated.id, created.id);
    if (
      [
        "counterparties",
        "vehicles",
        "drivers",
        "extraction-sites",
        "warehouses",
        "plants",
      ].includes(entity)
    ) {
      await responseFor("POST", `/ledger/archive/${entity}/${created.id}`, () =>
        editor
          .getByRole("button", { name: "Архивировать", exact: true })
          .click(),
      );
    }
    await drawer
      .getByRole("button", { name: "Закрыть карточку", exact: true })
      .click();
    results.push({
      entity,
      create: true,
      required: true,
      edit: true,
      archive: [
        "counterparties",
        "vehicles",
        "drivers",
        "extraction-sites",
        "warehouses",
        "plants",
      ].includes(entity),
    });
    fs.writeFileSync(
      "/tmp/workspace-actions.json",
      JSON.stringify(results, null, 2),
    );
    console.log("PASS create/edit/archive", entity);
  }
}
async function users() {
  await nav("Пользователи");
  const panel = page
    .locator("main details")
    .filter({
      has: page.getByText("Создать сотрудника / назначить роли", {
        exact: true,
      }),
    })
    .first();
  await panel.locator("summary").click();
  const createForm = panel.locator("form").first();
  await createForm
    .getByLabel("ФИО", { exact: true })
    .fill("Проверка сотрудника " + tag);
  await createForm
    .getByLabel("Телефон", { exact: true })
    .fill("+7" + tag.slice(-10));
  const user = await responseFor("POST", "/users", () =>
    createForm.getByRole("button", { name: "Создать", exact: true }).click(),
  );
  const roles = panel.locator("form").nth(1);
  for (const checked of await roles.locator("input:checked").all())
    await checked.uncheck();
  await roles.getByLabel("Упаковщик", { exact: false }).check();
  await responseFor("POST", `/users/${user.id}/roles`, () =>
    roles.getByRole("button", { name: "Назначить", exact: true }).click(),
  );
  await panel
    .getByLabel("Причина", { exact: true })
    .fill("Проверка блокировки");
  await responseFor("POST", `/users/${user.id}/block`, () =>
    panel.getByRole("button", { name: "Заблокировать", exact: true }).click(),
  );
  await responseFor("POST", `/users/${user.id}/block`, () =>
    panel.getByRole("button", { name: "Разблокировать", exact: true }).click(),
  );
  createdAccount = { phone: "+7" + tag.slice(-10) };
  results.push({
    users: true,
    create: true,
    roles: true,
    block: true,
    unblock: true,
  });
}
async function firstPassword() {
  const child = await browser.newPage();
  await child.goto(base);
  await child.locator("#login-email").fill(createdAccount.phone);
  await child.locator("#login-password").fill("123456");
  await child.getByRole("button", { name: "Войти", exact: true }).click();
  await child
    .getByRole("heading", { name: "Смените временный пароль", exact: true })
    .waitFor();
  await child.getByLabel("Текущий пароль", { exact: true }).fill("123456");
  await child
    .getByLabel("Новый пароль", { exact: true })
    .fill("FirstAudit2026!");
  await child
    .getByLabel("Повторите новый пароль", { exact: true })
    .fill("ChangedAudit2026!");
  await child
    .getByLabel("Новый пароль", { exact: true })
    .fill("ChangedAudit2026!");
  assert(
    await child
      .getByLabel("Повторите новый пароль", { exact: true })
      .evaluate((e) => e.checkValidity()),
    "Matching passwords must clear an earlier mismatch, even when editing the first field",
  );
  await child
    .getByRole("button", { name: "Сохранить и войти заново", exact: true })
    .click();
  await child.locator("#login-email").waitFor();
  await child.locator("#login-email").fill(createdAccount.phone);
  await child.locator("#login-password").fill("ChangedAudit2026!");
  await child.getByRole("button", { name: "Войти", exact: true }).click();
  await child.locator("nav.nav").waitFor();
  await child
    .locator("nav.nav")
    .getByRole("button", { name: "Сессии", exact: true })
    .click();
  await child
    .getByLabel("Текущий пароль", { exact: true })
    .fill("ChangedAudit2026!");
  await child
    .getByLabel("Новый пароль", { exact: true })
    .fill("AnotherAudit2026!");
  await child
    .getByLabel("Повторите новый пароль", { exact: true })
    .fill("FinalAudit2026!");
  await child
    .getByLabel("Новый пароль", { exact: true })
    .fill("FinalAudit2026!");
  assert(
    await child
      .getByLabel("Повторите новый пароль", { exact: true })
      .evaluate((e) => e.checkValidity()),
  );
  await child
    .getByRole("button", { name: "Сменить пароль", exact: true })
    .click();
  await child.locator("#login-email").waitFor();
  results.push({
    firstPasswordChange: true,
    mismatchRecovery: true,
    profilePasswordChange: true,
  });
  await child.close();
}
async function settings() {
  await nav("Настройки");
  const field = page.getByLabel("Порог расхождения, %", { exact: true });
  const previous = await field.inputValue();
  await field.fill("-1");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  assert.equal(await field.evaluate((e) => e.checkValidity()), false);
  await field.fill("3.25");
  await responseFor("POST", "/settings", () =>
    page.getByRole("button", { name: "Сохранить", exact: true }).click(),
  );
  await field.fill(previous);
  await responseFor("POST", "/settings", () =>
    page.getByRole("button", { name: "Сохранить", exact: true }).click(),
  );
  results.push({ settings: true, negativeRejected: true });
}
(async () => {
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    page.on("dialog", (d) => d.accept());
    page.on("pageerror", (e) => {
      throw e;
    });
    await login(page);
    if (!process.env.BIOFLOW_ACTIONS_AUTH_ONLY) await references();
    await users();
    await firstPassword();
    await settings();
    await page.reload();
    await page.locator("nav.nav").waitFor();
    results.push({ reloadRestoresSession: true });
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.locator("#login-email").waitFor();
    await page.reload();
    await page.locator("#login-email").waitFor();
    results.push({ logoutPersists: true });
    fs.writeFileSync(
      "/tmp/workspace-actions.json",
      JSON.stringify(results, null, 2),
    );
    console.log("PASS user actions and session persistence");
  } finally {
    await browser?.close();
  }
})().catch((e) => {
  console.error(e);
  fs.writeFileSync("/tmp/workspace-actions-error.txt", e.stack);
  process.exitCode = 1;
});
