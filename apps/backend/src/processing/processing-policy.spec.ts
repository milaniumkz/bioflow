import { Prisma } from "@prisma/client";
import { lossPercent, normDeviation } from "./processing-policy";
import {
  distanceMetres,
  STOP_RADIUS_METRES,
} from "../collection/tracking-policy";
const d = (x: string) => new Prisma.Decimal(x);
describe("physical process thresholds", () => {
  test("36% is a loss: 10 t washed becomes 6.4 t product", () => {
    expect(lossPercent(d("10"), d("6.4")).toString()).toBe("36");
  });
  test("prewash lower/upper boundaries are both normal", () => {
    expect(normDeviation(d("21"), 21, 27)).toBe("NORMAL");
    expect(normDeviation(d("27"), 21, 27)).toBe("NORMAL");
    expect(normDeviation(d("20.999"), 21, 27)).toBe("BELOW");
    expect(normDeviation(d("27.001"), 21, 27)).toBe("ABOVE");
  });
  test("factory reports below and above the 36% norm", () => {
    expect(normDeviation(lossPercent(d("10"), d("6.5")), 36, 36)).toBe("BELOW");
    expect(normDeviation(lossPercent(d("10"), d("6.3")), 36, 36)).toBe("ABOVE");
  });
  test("stage losses compound and do not add as another write-off", () => {
    expect(
      lossPercent(d("10"), d("10").mul("0.75").mul("0.64")).toString(),
    ).toBe("52");
  });
  test("prewash compares physical receipt, not the mass after sediment", () => {
    expect(lossPercent(d("10"), d("7.35")).toString()).toBe("26.5");
    expect(lossPercent(d("9.8"), d("7.35")).toString()).toBe("25");
  });
  test("zero/negative bases are not reported as a valid zero percent", () => {
    expect(() => lossPercent(d("0"), d("0"))).toThrow();
    expect(() => lossPercent(d("-1"), d("0"))).toThrow();
  });
  test("GPS noise stays within a stop while travel exits its radius", () => {
    const point = { latitude: 43.2, longitude: 76.9 };
    expect(
      distanceMetres(point, { latitude: 43.20005, longitude: 76.90005 }),
    ).toBeLessThan(STOP_RADIUS_METRES);
    expect(
      distanceMetres(point, { latitude: 43.21, longitude: 76.91 }),
    ).toBeGreaterThan(1000);
  });
});
