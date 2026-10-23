import test from "node:test";
import assert from "node:assert/strict";
import { saveBlob } from "../app/mobile-bridge.ts";
const savedWindow = globalThis.window,
  savedReader = globalThis.FileReader;
let messages = [];
test.beforeEach(() => {
  const win = new EventTarget();
  win.location = { search: "?mobile=1" };
  win.BioflowMobile = { postMessage: (raw) => messages.push(JSON.parse(raw)) };
  globalThis.window = win;
  messages = [];
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((bytes) => {
        this.result =
          "data:" +
          blob.type +
          ";base64," +
          Buffer.from(bytes).toString("base64");
        this.onload();
      });
    }
  };
});
test.afterEach(() => {
  window.dispatchEvent(new Event("bioflow:expired"));
  globalThis.window = savedWindow;
  globalThis.FileReader = savedReader;
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function respond(status, requestId = messages.at(-1).requestId) {
  window.dispatchEvent(
    new CustomEvent("bioflow:file-result", { detail: { status, requestId } }),
  );
}
test("file is saved only after a matching system acknowledgement", async () => {
  let done = false;
  const p = saveBlob(new Blob(["test"]), "report.csv").then((r) => {
    done = true;
    return r;
  });
  await tick();
  assert.equal(done, false);
  respond("saved", "other-document");
  assert.equal(done, false);
  respond("saved");
  assert.equal(await p, "saved");
});
test("cancelling Android file sheet is distinct from success", async () => {
  const p = saveBlob(new Blob(["test"]), "report.csv");
  await tick();
  respond("cancelled");
  assert.equal(await p, "cancelled");
});
test("file write failure and logout never report saved", async () => {
  const p = saveBlob(new Blob(["test"]), "report.csv");
  await tick();
  respond("failed");
  await assert.rejects(p, /Не удалось сохранить/);
  const next = saveBlob(new Blob(["test"]), "report.csv");
  await tick();
  window.dispatchEvent(new Event("bioflow:expired"));
  await assert.rejects(next, /Сессия завершена/);
});
