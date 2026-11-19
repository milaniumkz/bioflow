import { collectorReportPeriod } from "./collection-collector-reports";
import { ownerDashboardTotals } from "./collection-owner-dashboard";
describe("Owner reporting periods and exact aggregates", () => {
  it("includes the entire selected local day in UTC+5", () => {
    const p = collectorReportPeriod({ from: "2026-11-19", to: "2026-11-19" });
    expect(p.start!.toISOString()).toBe("2026-11-18T19:00:00.000Z");
    expect(p.end!.toISOString()).toBe("2026-11-19T19:00:00.000Z");
  });
  it("rejects reversed and nonexistent dates", () => {
    expect(() =>
      collectorReportPeriod({ from: "2026-11-20", to: "2026-11-19" }),
    ).toThrow();
    expect(() => collectorReportPeriod({ from: "2026-02-30" })).toThrow();
    expect(() => collectorReportPeriod({ to: "bad" })).toThrow();
  });
  it("separates gross, lab loss, credit, pending and cancelled mass without rounding drift", () => {
    const s = ownerDashboardTotals([
      {
        kind: "RAW",
        status: "ACCEPTED",
        weightKg: "20000",
        acceptedWeightKg: "19000",
        laboratory: {},
        deliveredAt: new Date(),
      },
      {
        kind: "RAW",
        status: "ARRIVED",
        weightKg: "5000",
        deliveredAt: new Date(),
      },
      {
        kind: "RAW",
        status: "ACCEPTED",
        weightKg: "0.001",
        acceptedWeightKg: null,
        deliveredAt: new Date(),
      },
      {
        kind: "RAW",
        status: "CANCELLED",
        weightKg: "100000",
        acceptedWeightKg: "90000",
      },
    ]);
    expect(s.rawDeliveredKg).toBe("25000.001");
    expect(s.rawAcceptedKg).toBe("19000.001");
    expect(s.rawDeductionKg).toBe("1000");
    expect(s.rawPendingLabKg).toBe("5000");
    expect(s.rawLegacyCount).toBe(1);
    expect(s.cancelledCount).toBe(1);
  });
  it("does not count audit movements as additional driver trips or add raw / GP mass together", () => {
    const s = ownerDashboardTotals([
      {
        kind: "RAW",
        status: "ACCEPTED",
        weightKg: "20000",
        acceptedWeightKg: "19000",
        driverPhone: "123",
        deliveredAt: new Date(),
      },
      { kind: "GP", status: "IN_TRANSIT", weightKg: "500", driverPhone: "123" },
      {
        kind: "OTHER",
        status: "COMPLETED",
        weightKg: "50",
        driverPhone: "123",
        deliveredAt: new Date(),
      },
    ]);
    expect(s.driverTrips).toBe(2);
    expect(s.driverDelivered).toBe(1);
    expect(s.driverActive).toBe(1);
    expect(s.rawAcceptedKg).toBe("19000");
    expect(s.gpSentKg).toBe("500");
  });
});
