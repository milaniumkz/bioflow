import { localizeReport, reportValue } from "./report-labels";
import { toCsv, toXlsx, toPdf } from "./reports.controller";
import JSZip from "jszip";
test("human exports preserve business values, hide identifiers, and keep masked secrets masked", () => {
  const rows = localizeReport([
    {
      id: "cm123456789012345678901234",
      number: "cm123456789012345678901234-LOT-000012",
      state: "FINISHED",
      quantity: "2.560",
      warehouseName: "Склад №2",
      passwordHash: "[скрыто]",
    },
  ]);
  expect(rows[0]["Партия"] ?? rows[0]["Номер"] ?? rows[0]["Документ"]).toBe(
    "Партия №12",
  );
  expect(Object.values(rows[0])).toContain("Готовая продукция");
  expect(Object.values(rows[0])).toContain("2.560");
  expect(Object.values(rows[0])).toContain("[скрыто]");
  expect(JSON.stringify(rows)).not.toContain("cm123");
  expect(reportValue("ООО Склад")).toBe("ООО Склад");
});
test("ten repeated CSV, spreadsheet and PDF exports keep Cyrillic labels and valid document formats", async () => {
  for (let i = 0; i < 10; i++) {
    const rows = [
      {
        number: "LOT-000012",
        quantity: "2.560",
        state: "FINISHED",
        warehouse: { name: "Склад №2" },
      },
    ];
    const csv = toCsv(rows);
    expect(csv).toContain("Партия №12");
    expect(csv).toContain("Готовая продукция");
    expect(csv).not.toContain("warehouse.name");
    const zip = await JSZip.loadAsync(await toXlsx(rows));
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toContain("Склад");
    expect(sheet).toContain("Партия №12");
    const pdf = await toPdf({
      type: "inventory",
      generatedAt: "2026-11-09T00:00:00Z",
      userId: "hidden",
      filters: {},
      rows,
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  }
});
