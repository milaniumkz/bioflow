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
test("a gateway HTML response is reported without a JSON parser exception", async () => {
  globalThis.fetch = async () =>
    new Response("<h1>Bad Gateway</h1>", { status: 502 });
  await assert.rejects(webRequest("/users"), /Сервер временно недоступен/);
});
