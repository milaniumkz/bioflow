import test from "node:test";
import assert from "node:assert/strict";
import { visibleText, businessLabels, caption } from "../app/presentation.ts";
test("technical values have Russian labels and IDs are not exposed as record names", () => {
  assert.equal(visibleText("cm123456789012345678901234"), "Связанная запись");
  assert.equal(
    visibleText("cm123456789012345678901234-LOT-000015"),
    "Партия №15",
  );
  assert.equal(businessLabels["DRYING_OUTPUT"], "Выпуск завода");
  assert.equal(businessLabels["UNKNOWN_NEW_STATUS"], "Операция учёта");
  assert.equal(caption("internalUnsafeField"), "Сведения");
  assert.equal(visibleText("ООО Переработка"), "ООО Переработка");
  assert.equal(
    visibleText("Process cm123456789012345678901234"),
    "Обработка партии",
  );
});
test("user text cannot expose dictionary prototypes as labels", () => {
  assert.equal(visibleText("constructor"), "constructor");
  assert.equal(caption("constructor"), "Сведения");
});
