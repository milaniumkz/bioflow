import { displayTonnes, noticeInTonnes } from "./collection-weights";
describe("Collection tonne displays", () => {
  it("preserves tiny bag weights and never treats stored kg as tonnes", () => {
    expect(displayTonnes("20000")).toBe("20");
    expect(displayTonnes("20")).toBe("0,02");
    expect(displayTonnes("0.001")).toBe("0,000001");
  });
  it("renders historic kg notices in tonnes without changing bag counts or existing tonne values", () => {
    expect(
      noticeInTonnes("50 мешков, общий вес 20000 кг. Средний вес 400 кг."),
    ).toBe("50 мешков, общий вес 20 т. Средний вес 0,4 т.");
    expect(noticeInTonnes("Принято 20 т.")).toBe("Принято 20 т.");
  });
});
