import test from "node:test";
import assert from "node:assert/strict";
import { auditDiff } from "./audit-diff.mjs";
test("audit changes preserve false, zero, deleted fields and scope lists", () => {
  assert.deepEqual(
    auditDiff(
      {
        accessAllObjects: false,
        lossQuantity: 0,
        reason: "old",
        warehouseScopeIds: ["w1"],
      },
      {
        accessAllObjects: true,
        lossQuantity: 0,
        warehouseScopeIds: ["w1", "w2"],
      },
    ),
    [
      { field: "accessAllObjects", before: false, after: true },
      { field: "reason", before: "old", after: undefined },
      { field: "warehouseScopeIds", before: ["w1"], after: ["w1", "w2"] },
    ],
  );
});
test("creation and nested process facts are readable without a raw JSON dump", () => {
  assert.deepEqual(auditDiff(null, { balance: { lossQuantity: "0.2" } }), [
    { field: "balance.lossQuantity", before: undefined, after: "0.2" },
  ]);
  assert.deepEqual(auditDiff(null, null), []);
});
