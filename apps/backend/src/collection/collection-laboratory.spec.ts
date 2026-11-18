import { calculateCollectionLaboratory as calculate } from "@bioflow/shared-types";
const lab = (
  sedimentPercent = "5",
  moisturePercent = "35",
  colorPercent = "40",
) => ({ sedimentPercent, moisturePercent, colorPercent });
describe("Collection laboratory acceptance", () => {
  it("deducts nothing below or exactly at each limit", () => {
    expect(calculate("20000", lab()).acceptedWeightKg).toBe("20000");
    expect(calculate("20000", lab("0", "0", "0")).totalDeductionPercent).toBe(
      "0",
    );
  });
  it("doubles only sediment excess, never the entire sediment value", () => {
    const result = calculate("20000", lab("6"));
    expect(result.sedimentDeductionPercent).toBe("2");
    expect(result.acceptedWeightKg).toBe("19600");
  });
  it("uses the corrected 35% moisture limit and only color excess over 40%", () => {
    expect(calculate("20000", lab("5", "30")).acceptedWeightKg).toBe("20000");
    expect(calculate("20000", lab("5", "38")).acceptedWeightKg).toBe("19400");
    expect(calculate("20000", lab("5", "35", "45")).acceptedWeightKg).toBe(
      "19000",
    );
  });
  it("adds the three excess deductions against the original mass", () => {
    const result = calculate("20000", lab("6", "37", "41"));
    expect(result.totalDeductionPercent).toBe("5");
    expect(result.acceptedWeightKg).toBe("19000");
    expect(result.deductionWeightKg).toBe("1000");
  });
  it("rounds to one gram and preserves exact mass balance", () => {
    expect(calculate("1.001", lab("5.01")).acceptedWeightKg).toBe("1.001");
    expect(calculate("1.001", lab("6")).acceptedWeightKg).toBe("0.981");
  });
  it("rejects invalid percentages and deductions over 100%, permits a fully rejected mass", () => {
    for (const value of ["-1", "101", "NaN", "5.123"])
      expect(() => calculate("20000", lab(value))).toThrow();
    expect(() => calculate("20000", lab("100", "100", "100"))).toThrow(/100%/);
    expect(calculate("20000", lab("55")).acceptedWeightKg).toBe("0");
  });
});

import { assessDryingIntake, assessDryingOutput } from "@bioflow/shared-types";
const intake = {
  sedimentPercent: "3",
  moisturePercent: "35",
  conductivity: "400",
  waterTransparent: true,
  colorCompliant: true,
  packagingCompliant: true,
};
const dry = {
  sedimentPercent: "5",
  moisturePercent: "0.5",
  conductivity: "400",
  waterTransparent: true,
  colorCompliant: true,
  bulkDensity: "450",
};
describe("Laboratory before and after drying", () => {
  it("uses 3% sediment / 35% moisture on intake and doubles only sediment excess", () => {
    const r = assessDryingIntake("20000", {
      ...intake,
      sedimentPercent: "4",
      moisturePercent: "38",
    });
    expect(r.acceptedWeightKg).toBe("19000");
    expect(r.sedimentDeductionPercent).toBe("2");
    expect(r.moistureDeductionPercent).toBe("3");
  });
  it("returns full gross mass for conductivity above 400 or any failed yes/no check", () => {
    for (const invalid of [
      { conductivity: "400.001" },
      { waterTransparent: false },
      { colorCompliant: false },
      { packagingCompliant: false },
    ]) {
      const r = assessDryingIntake("20000", { ...intake, ...invalid });
      expect(r.disposition).toBe("REWORK");
      expect(r.returnedWeightKg).toBe("20000");
      expect(r.acceptedWeightKg).toBe("0");
    }
  });
  it("accepts boundary values after drying", () =>
    expect(assessDryingOutput(dry).state).toBe("FINISHED"));
  it("sends excess moisture alone to repeat drying", () =>
    expect(assessDryingOutput({ ...dry, moisturePercent: "0.51" }).state).toBe(
      "REDRY",
    ));
  it("sends sediment, conductivity, density or failed color/transparency to reject even with excess moisture", () => {
    for (const invalid of [
      { sedimentPercent: "5.01" },
      { conductivity: "400.001" },
      { bulkDensity: "450.001" },
      { waterTransparent: false },
      { colorCompliant: false },
    ])
      expect(
        assessDryingOutput({ ...dry, ...invalid, moisturePercent: "2" }).state,
      ).toBe("REJECT");
  });
});
