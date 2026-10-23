import { test } from "node:test";
import assert from "node:assert/strict";
import { referencePayload } from "./reference-payload.mjs";

test("editing clears nullable fields while preserving defaulted required fields", () => {
  assert.deepEqual(
    referencePayload(
      "counterparties",
      { name: "Поставщик", phone: "", bin: "", email: "", status: "" },
      true,
    ),
    {
      name: "Поставщик",
      phone: null,
      bin: null,
      email: null,
    },
  );
  assert.deepEqual(
    referencePayload(
      "warehouses",
      { capacity: "", address: "", warehouseType: "" },
      true,
    ),
    { capacity: null, address: null },
  );
});
test("creating omits empty optional values instead of overriding database defaults", () => {
  assert.deepEqual(
    referencePayload("vehicles", {
      plateNumber: "TEST",
      capacity: "",
      status: "",
    }),
    { plateNumber: "TEST" },
  );
});
test("reference weights accept a decimal comma without changing textual fields", () => {
  assert.deepEqual(
    referencePayload("vehicles", {
      capacity: " 20,500 ",
      tareWeight: "7.250",
      model: "Модель, версия 2",
    }),
    {
      capacity: "20.500",
      tareWeight: "7.250",
      model: "Модель, версия 2",
    },
  );
});
