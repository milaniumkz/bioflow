import test from "node:test";
import assert from "node:assert/strict";
import {
  setSession,
  clearSession,
  webRequest,
  downloadReport,
} from "../app/session.ts";

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  clearSession();
});

test("old session responses cannot reach a new user's UI", async () => {
  setSession({ accessToken: "owner" });
  let resolve;
  globalThis.fetch = () =>
    new Promise((r) => {
      resolve = r;
    });
  const request = webRequest("/users", "owner");
  clearSession();
  setSession({ accessToken: "auditor" });
  resolve(Response.json({ data: [{ email: "private-owner-data" }] }));
  await assert.rejects(request, /Пользователь изменился/);
});

test("an old refresh cannot replace the new identity", async () => {
  setSession({ accessToken: "old", refreshToken: "old-refresh" });
  let resolve;
  let refreshStarted;
  const started = new Promise((r) => {
    refreshStarted = r;
  });
  const headers = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/auth/refresh")) {
      refreshStarted();
      return new Promise((r) => {
        resolve = r;
      });
    }
    headers.push(init?.headers.Authorization);
    return Response.json({}, { status: headers.length === 1 ? 401 : 200 });
  };
  const old = webRequest("/users");
  await started;
  clearSession();
  setSession({ accessToken: "new-user" });
  resolve(
    Response.json({
      accessToken: "stale-owner",
      refreshToken: "stale-refresh",
    }),
  );
  await assert.rejects(old, /Пользователь изменился/);
  await webRequest("/users");
  assert.equal(headers.at(-1), "Bearer new-user");
});

test("a successful refresh retries the request for the same identity", async () => {
  setSession({ accessToken: "expired", refreshToken: "refresh" });
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/auth/refresh"))
      return Response.json({ accessToken: "renewed", refreshToken: "next" });
    return init?.headers.Authorization === "Bearer renewed"
      ? Response.json({ ok: true })
      : Response.json({}, { status: 401 });
  };
  assert.deepEqual(await webRequest("/users"), { ok: true });
});

test("network and credential failures are readable in Russian", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(webRequest("/users"), /Нет связи с сервером/);
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "Invalid credentials" } },
      { status: 401 },
    );
  await assert.rejects(webRequest("/auth/login"), /Неверный логин или пароль/);
});

test("retry network failures remain readable after a successful token refresh", async () => {
  setSession({ accessToken: "expired", refreshToken: "refresh" });
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/auth/refresh"))
      return Response.json({ accessToken: "renewed" });
    if (init?.headers.Authorization === "Bearer renewed")
      throw new TypeError("Failed to fetch");
    return Response.json({}, { status: 401 });
  };
  await assert.rejects(webRequest("/users"), /Нет связи с сервером/);
});
test("offline exports show a readable network failure", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
    downloadReport("/ledger/reports/inventory?format=csv", "token"),
    /Нет связи с сервером/,
  );
});
test("exports renew an expired access token before downloading a PDF", async () => {
  setSession({ accessToken: "expired", refreshToken: "refresh" });
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/auth/refresh"))
      return Response.json({ accessToken: "renewed", refreshToken: "next" });
    return init?.headers.Authorization === "Bearer renewed"
      ? new Response("%PDF-fixture", {
          headers: { "Content-Type": "application/pdf" },
        })
      : Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  };
  const blob = await downloadReport(
    "/ledger/reports/inventory/export?format=pdf",
    "expired",
  );
  assert.equal(await blob.text(), "%PDF-fixture");
});
test("a pending export cannot return a previous account's data after switching accounts", async () => {
  setSession({ accessToken: "owner" });
  let resolve;
  globalThis.fetch = () =>
    new Promise((r) => {
      resolve = r;
    });
  const result = downloadReport("/reports/export?format=pdf", "owner");
  setSession({ accessToken: "auditor" });
  resolve(new Response("%PDF-owner-private"));
  await assert.rejects(result, /Пользователь изменился/);
});
test("a gateway HTML response is reported without a JSON parser exception", async () => {
  globalThis.fetch = async () =>
    new Response("<h1>Bad Gateway</h1>", { status: 502 });
  await assert.rejects(webRequest("/users"), /Сервер временно недоступен/);
});
test("rate limiting shows a readable wait instruction", async () => {
  globalThis.fetch = async () =>
    Response.json(
      { message: "ThrottlerException: Too Many Requests" },
      { status: 429 },
    );
  await assert.rejects(webRequest("/users"), /Подождите минуту/);
});

test("browser restoration coalesces simultaneous requests and uses credentials without exposing a refresh token", async () => {
  const { restoreBrowserSession } = await import("../app/session.ts");
  let resolve,
    calls = 0;
  globalThis.fetch = (_url, init) => {
    calls++;
    assert.equal(init.credentials, "include");
    assert.equal(init.body, undefined);
    return new Promise((r) => (resolve = r));
  };
  const first = restoreBrowserSession(),
    second = restoreBrowserSession();
  assert.equal(first, second);
  resolve(Response.json({ accessToken: "restored" }));
  assert.equal(await first, "restored");
  assert.equal(calls, 1);
});
test("restoration cannot overwrite a later explicit login", async () => {
  const { restoreBrowserSession } = await import("../app/session.ts");
  let resolve;
  globalThis.fetch = () => new Promise((r) => (resolve = r));
  const old = restoreBrowserSession();
  setSession({ accessToken: "new-identity" });
  resolve(Response.json({ accessToken: "old-identity" }));
  assert.equal(await old, undefined);
});

test("a cookie refreshed for another account cannot return data into the previous account UI", async () => {
  const jwt = (sub) => `x.${btoa(JSON.stringify({ sub }))}.x`;
  setSession({ accessToken: jwt("first") });
  globalThis.fetch = async (url) =>
    String(url).endsWith("/auth/browser-refresh")
      ? Response.json({ accessToken: jwt("second") })
      : Response.json({}, { status: 401 });
  await assert.rejects(webRequest("/users"), /Пользователь изменился/);
});
