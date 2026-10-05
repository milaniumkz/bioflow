import { BadRequestException } from "@nestjs/common";
import { createdAtRange } from "./date-range";

describe("createdAtRange", () => {
  it("uses the full UTC day for date-only dateTo", () => {
    expect(createdAtRange({ dateFrom: "2026-09-29", dateTo: "2026-09-29" })).toEqual({
      createdAt: {
        gte: new Date("2026-09-29T00:00:00.000Z"),
        lte: new Date("2026-09-29T23:59:59.999Z")
      }
    });
  });

  it("rejects an inverted range", () => {
    expect(() => createdAtRange({ dateFrom: "2026-09-30", dateTo: "2026-09-29" })).toThrow(BadRequestException);
  });
});
