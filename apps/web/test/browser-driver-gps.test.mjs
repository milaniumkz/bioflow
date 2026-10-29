import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  browserPosition,
  startBrowserGps,
  stopBrowserGps,
  gpsState,
  flushBrowserGps,
} from "../app/browser-driver-gps.ts";
const old = {
  window: globalThis.window,
  navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  localStorage: globalThis.localStorage,
  fetch: globalThis.fetch,
};
const fix = {
  timestamp: Date.now(),
  coords: { latitude: 43.2, longitude: 76.9, accuracy: 5 },
};
let calls, cleared, storage, online;
beforeEach(() => {
  calls = [];
  cleared = [];
  storage = new Map();
  online = true;
  const win = new EventTarget();
  win.isSecureContext = true;
  win.location = { search: "" };
  globalThis.window = win;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition: (ok) => ok(fix),
        watchPosition: () => 7,
        clearWatch: (id) => cleared.push(id),
      },
    },
  });
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.fetch = async (url, init) => {
    if (init.body) calls.push({ url, body: JSON.parse(init.body) });
    if (!online) throw Error("offline");
    return new Response(
      url.endsWith("/state") ? JSON.stringify({ status: "IN_TRANSIT" }) : "{}",
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
});
afterEach(() => {
  stopBrowserGps();
  globalThis.window = old.window;
  globalThis.localStorage = old.localStorage;
  globalThis.fetch = old.fetch;
  if (old.navigator)
    Object.defineProperty(globalThis, "navigator", old.navigator);
});
const tick = () => new Promise((r) => setTimeout(r, 10));
test("insecure origins cannot claim geolocation is enabled", async () => {
  window.isSecureContext = false;
  await assert.rejects(browserPosition(), /HTTPS/);
  assert.equal(gpsState().running, false);
});
test("actual location points reach the server points endpoint and logout clears the watch", async () => {
  startBrowserGps("driver", "trip", "test-token", fix);
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/v1/tracking/trips/trip/points");
  assert.equal(calls[0].body.points[0].latitude, 43.2);
  assert.equal(gpsState().pending, 0);
  window.dispatchEvent(new Event("bioflow:expired"));
  assert.deepEqual(cleared, [7]);
  assert.equal(gpsState().running, false);
});
test("failed upload preserves point identity for retry and cannot switch to another trip", async () => {
  online = false;
  startBrowserGps("driver", "trip", "test-token", fix);
  await tick();
  const id = JSON.parse(storage.get("collection:gps:driver:trip"))[0].id;
  assert.equal(gpsState().pending, 1);
  assert.throws(
    () => startBrowserGps("other-driver", "other-trip", "other-token", fix),
    /другого рейса/,
  );
  online = true;
  await flushBrowserGps("test-token");
  assert.equal(calls[0].body.points[0].id, id);
  assert.equal(gpsState().pending, 0);
});
