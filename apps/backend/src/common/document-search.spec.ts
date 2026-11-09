import { documentSearch } from "./document-search";
test("visible Russian numbers find the original immutable stored documents", () => {
  expect(documentSearch("Партия №12")).toBe("LOT-000012");
  expect(documentSearch("рейс 3")).toBe("WB-000003");
  expect(documentSearch("Обработка №004")).toBe("PROC-000004");
  expect(documentSearch("ООО Склад")).toBe("ООО Склад");
  expect(documentSearch("LOT-000012")).toBe("LOT-000012");
});
