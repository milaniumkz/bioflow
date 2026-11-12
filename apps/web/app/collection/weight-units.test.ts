import test from "node:test";
import assert from "node:assert/strict";
import { tonnesToKg, kgAsTonnes } from "./weight-units.ts";
test("tonne inputs round-trip through existing kilogram storage without scaling loss", () => {
  for (const [input, stored] of [
    ["20", "20000"],
    ["0.4", "400"],
    ["0,08", "80"],
    ["0.000001", "0.001"],
    ["20.123456", "20123.456"],
  ]) {
    assert.equal(tonnesToKg(input), stored);
    assert.equal(
      Number(kgAsTonnes(stored).replace(/\s/g, "").replace(",", ".")),
      Number(input.replace(",", ".")),
    );
  }
  for (const input of ["", "-1", "20abc", "0.0000001", "10000000"])
    assert.throws(() => tonnesToKg(input));
});
