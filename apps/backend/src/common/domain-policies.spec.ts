import { BadRequestException } from "@nestjs/common";
import { classifyAcceptance, validateProductionFormula, validateWashingFormula } from "./domain-policies";

describe("domain policies", () => {
  it("accepts weight inside threshold without reason status", () => {
    const result = classifyAcceptance("1000", "1020");
    expect(result.status).toBe("ACCEPTED");
    expect(result.difference.toString()).toBe("20");
  });

  it("marks acceptance with difference over threshold", () => {
    const result = classifyAcceptance("1000", "1040");
    expect(result.status).toBe("ACCEPTED_WITH_DIFFERENCE");
  });

  it("uses custom acceptance threshold", () => {
    const result = classifyAcceptance("1000", "1040", 5);
    expect(result.status).toBe("ACCEPTED");
  });

  it("rejects invalid washing balance", () => {
    expect(() => validateWashingFormula("1000", "900", "40", "20")).toThrow(BadRequestException);
  });

  it("allows exact washing balance", () => {
    const result = validateWashingFormula("1000", "900", "60", "40");
    expect(result.outputWeight.toString()).toBe("900");
  });

  it("rejects production output above input", () => {
    expect(() => validateProductionFormula("100", "90", "8", "5")).toThrow(BadRequestException);
  });
});
