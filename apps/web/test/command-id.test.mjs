import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createCommandId } from "../app/command-id.mjs";

test("secure context uses the native method with its receiver", () => {
  const provider = {
    randomUUID() {
      assert.equal(this, provider);
      return "native-uuid";
    },
  };
  assert.equal(createCommandId(provider), "native-uuid");
});

test("HTTP fallback sets UUID v4 version and variant bits", () => {
  assert.equal(
    createCommandId({ getRandomValues: (bytes) => bytes.fill(255) }),
    "ffffffff-ffff-4fff-bfff-ffffffffffff",
  );
  assert.equal(
    createCommandId({ getRandomValues: (bytes) => bytes.fill(0) }),
    "00000000-0000-4000-8000-000000000000",
  );
});

test("HTTP fallback uses real cryptographic random bytes without duplicates", () => {
  const provider = {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
  };
  const ids = Array.from({ length: 1000 }, () => createCommandId(provider));
  for (const id of ids)
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  assert.equal(new Set(ids).size, ids.length);
});

test("missing cryptographic APIs fails clearly instead of weakening randomness", () => {
  assert.throws(() => createCommandId({}), /Обновите браузер/);
});
