import test from "node:test";
import assert from "node:assert/strict";
import { processingNextStep } from "../app/processing-next-step.ts";
import { recordLabel, qrLabel } from "../app/record-label.ts";
const root = {
  batch: { stocks: [{ quantity: 8 }] },
  trip: { receivedWeight: 8 },
  analyses: [{}],
};
test("washing explains preparation and operator access, then advances to bag output", () => {
  const receiver = processingNextStep(root, ["processing.receive"]);
  assert.equal(receiver.title, "Взвесить перед мойкой");
  assert.equal(receiver.available, false);
  assert.equal(receiver.role, "Оператор мойки");
  const prepared = {
    ...root,
    preparedBatchId: "prepared",
    preparedAvailable: true,
  };
  assert.equal(
    processingNextStep(prepared, ["processing.wash"]).title,
    "Выход с мойки",
  );
  assert.equal(
    processingNextStep(prepared, ["processing.wash"]).available,
    true,
  );
  assert.equal(
    processingNextStep({ ...root, analyses: [] }, ["processing.wash"]).title,
    "Лабораторный анализ",
  );
  assert.match(
    processingNextStep({ ...prepared, preparedAvailable: false }, []).title,
    /завершена/,
  );
});
test("factory, warehouse, packing, sales and consumed bags have explicit next steps", () => {
  const bag = (extra) => ({
    ...root,
    batch: { stocks: [{ quantity: 4 }], bigBag: extra },
  });
  assert.equal(
    processingNextStep(bag({ stage: "WASHED" }), ["processing.dry"]).title,
    "Приём на завод",
  );
  assert.equal(
    processingNextStep(bag({ stage: "WASHED", factoryStartedAt: "now" }), [
      "processing.dry",
    ]).title,
    "Выход после завода",
  );
  assert.equal(
    processingNextStep(bag({ stage: "DRIED" }), ["processing.finished"]).title,
    "Склад готовой продукции",
  );
  assert.equal(
    processingNextStep(bag({ stage: "DRIED", receivedAt: "now" }), [
      "processing.pack",
    ]).title,
    "Упаковка",
  );
  assert.equal(
    processingNextStep(
      bag({ stage: "DRIED", receivedAt: "now", packedAt: "now" }),
      ["processing.sell"],
    ).title,
    "Отпуск готовой продукции",
  );
  assert.match(processingNextStep(bag({ soldAt: "now" }), []).title, /отпущен/);
  assert.match(
    processingNextStep(
      { batch: { stocks: [], bigBag: { stage: "WASHED" } } },
      [],
    ).title,
    /использован/,
  );
});
test("human labels preserve document identity and bag ordinal without internal organization IDs", () => {
  assert.equal(
    recordLabel("cm123456789012345678901234-LOT-000012"),
    "Партия №12",
  );
  assert.equal(recordLabel("WB-000003"), "Рейс №3");
  assert.equal(recordLabel("Invoice-123"), "Invoice-123");
  assert.equal(qrLabel({ number: "technical", ordinal: 1 }), "Биг-бэг №1");
  assert.equal(
    qrLabel({ number: "technical", bigBag: { ordinal: 2 } }),
    "Биг-бэг №2",
  );
});

test("a packer scanning raw or washed material cannot skip the warehouse stage", () => {
  const early = processingNextStep(root, ["processing.pack"], ["PACKER"]);
  assert.match(early.title, /ещё не дошла/);
  assert.equal(early.available, false);
  const waiting = {
    ...root,
    batch: { stocks: [{ quantity: 4 }], bigBag: { stage: "DRIED" } },
  };
  assert.equal(
    processingNextStep(waiting, ["processing.pack"], ["PACKER"]).available,
    false,
  );
  const ready = {
    ...waiting,
    batch: { ...waiting.batch, bigBag: { stage: "DRIED", receivedAt: "now" } },
  };
  assert.equal(
    processingNextStep(ready, ["processing.pack"], ["PACKER"]).available,
    true,
  );
  const packed = {
    ...ready,
    batch: {
      ...ready.batch,
      bigBag: { ...ready.batch.bigBag, packedAt: "now" },
    },
  };
  assert.match(
    processingNextStep(packed, ["processing.pack"], ["PACKER"]).title,
    /уже упакован/,
  );
});

test("a stage-only QR preview never offers actions or invents stock quantities", () => {
  const preview = {
    readOnly: true,
    stageLabel: "После мойки",
    batch: { id: "hidden", state: "WASHED", stocks: [] },
    analyses: [],
  };
  const next = processingNextStep(preview, ["processing.pack"], ["PACKER"]);
  assert.equal(next.available, false);
  assert.match(next.title, /не дошла/);
});

test("sales sees the allowed washed-sale branch and must wait for packing of finished material", () => {
  const washed = {
    ...root,
    batch: { stocks: [{ quantity: 4 }], bigBag: { stage: "WASHED" } },
  };
  assert.equal(
    processingNextStep(washed, ["processing.sell"]).title,
    "Продажа мытого материала",
  );
  const finished = {
    ...root,
    batch: {
      stocks: [{ quantity: 2.56 }],
      bigBag: { stage: "DRIED", receivedAt: "now" },
    },
  };
  assert.equal(
    processingNextStep(finished, ["processing.sell"]).available,
    false,
  );
  assert.equal(
    processingNextStep(finished, ["processing.sell"]).title,
    "Упаковка",
  );
  const packed = {
    ...finished,
    batch: {
      ...finished.batch,
      bigBag: { ...finished.batch.bigBag, packedAt: "now" },
    },
  };
  assert.equal(processingNextStep(packed, ["processing.sell"]).available, true);
});

test("washing offers dispatch or washed sales without giving factory work", () => {
  const item = {
    batch: { stocks: [{ quantity: 4 }], bigBag: { stage: "WASHED" } },
  };
  const next = processingNextStep(
    item,
    ["processing.wash", "processing.dispatch", "processing.sell.washed"],
    ["WASH_OPERATOR"],
  );
  assert.equal(next.title, "Отправить на завод или продать с мойки");
  assert.equal(next.available, true);
  const atFactory = processingNextStep(
    {
      batch: {
        ...item.batch,
        bigBag: { stage: "WASHED", factoryStartedAt: "now" },
      },
    },
    ["processing.wash", "processing.dispatch", "processing.sell.washed"],
    ["WASH_OPERATOR"],
  );
  assert.equal(atFactory.available, false);
});

test("a combined worker keeps the receiving step even with an old packer assignment", () => {
  const next = processingNextStep(
    { batch: { stocks: [{ quantity: 2 }], bigBag: { stage: "DRIED" } } },
    ["processing.finished", "processing.pack"],
    ["OPERATIONS_MANAGER", "PACKER"],
  );
  assert.equal(next.title, "Склад готовой продукции");
  assert.equal(next.available, true);
});
