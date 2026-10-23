import test from "node:test";
import assert from "node:assert/strict";
import { weightPreview, decimalError } from "./weight-preview.mjs";
test("36% is a loss; actual output remains 6.4 t", () =>
  assert.deepEqual(weightPreview(10, ["6,4"]), {
    output: 6.4,
    loss: 3.6,
    percent: 36,
  }));
test("prewash boundaries 21 and 27 are preserved", () => {
  assert.equal(weightPreview(10, ["7.9"]).percent, 21);
  assert.equal(weightPreview(10, ["7.3"]).percent, 27);
});
test("no percentage for missing output, zero base, NaN, negative", () => {
  for (const input of [0, -1, NaN])
    assert.equal(weightPreview(input, ["1"]), null);
  for (const output of ["", "-1", "NaN"])
    assert.equal(weightPreview(10, [output]), null);
});
test("sums per-bag actual weights and shows deviations", () =>
  assert.deepEqual(weightPreview(3.675, ["1.176", "1,176"]), {
    output: 2.352,
    loss: 1.323,
    percent: 36,
  }));
test("UI accepts decimal comma and rejects unsupported precision and range", () => {
  assert.equal(decimalError("1,234", { min: 0.001, step: "0.001" }), "");
  assert.ok(decimalError("0,0001", { min: 0.001, step: "0.001" }));
  assert.ok(decimalError("0,1234", { min: 0.001, step: "0.001" }));
  assert.ok(decimalError("101", { max: 100, step: "0.01" }));
  assert.ok(decimalError("-1"));
  assert.ok(decimalError("hello"));
});
