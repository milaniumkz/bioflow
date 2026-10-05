import { readFileSync } from "fs";
import { join } from "path";
import { test } from "node:test";
import assert from "node:assert/strict";

test("OpenAPI contract is exported", () => {
  const spec = JSON.parse(readFileSync(join(__dirname, "../openapi/openapi.json"), "utf8"));
  assert.equal(spec.openapi, "3.0.0");
  assert.ok(spec.paths["/api/v1/health"]);
  assert.ok(spec.paths["/api/v1/auth/login"]);
  assert.ok(spec.paths["/api/v1/waybills"]);
  assert.ok(spec.paths["/api/v1/inventory/movements"]);
  assert.ok(spec.paths["/api/v1/transfers"]);
});
