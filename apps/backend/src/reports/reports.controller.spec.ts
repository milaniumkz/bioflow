import { ReportsController } from "./reports.controller";

describe("ReportsController", () => {
  it("exports inventory report as csv", async () => {
    const controller = new ReportsController({
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([{ id: "1", state: "DIRTY", quantity: "100", warehouse: { name: "Main" } }])
      }
    } as any);
    const res = fakeResponse();

    await controller.export("inventory", "csv", {}, { id: "u1", organizationId: "o1", permissions: [] }, res as any);

    expect(String(res.body)).toContain("warehouse.name");
    expect(String(res.body)).toContain("\"Main\"");
  });

  it("builds discrepancy report from acceptances", async () => {
    const controller = new ReportsController({
      acceptance: {
        findMany: jest.fn().mockResolvedValue([{ id: "a1", reason: "Вес отличается", difference: "40" }])
      }
    } as any);
    const res = fakeResponse();

    await controller.export("discrepancies", "csv", {}, { id: "u1", organizationId: "o1", permissions: [] }, res as any);

    expect(String(res.body)).toContain("Вес отличается");
  });

  it("exports movement report with material and product names", async () => {
    const controller = new ReportsController({
      inventoryMovement: {
        findMany: jest.fn().mockResolvedValue([{
          id: "m1",
          type: "SHIPMENT",
          materialType: { name: "Ore" },
          productType: { name: "Pellet" },
          warehouse: { name: "Main" },
          waybill: { number: "WB-000001" }
        }])
      }
    } as any);
    const res = fakeResponse();

    await controller.export("movements", "csv", {}, { id: "u1", organizationId: "o1", permissions: [] }, res as any);

    expect(String(res.body)).toContain("materialType.name");
    expect(String(res.body)).toContain("\"Pellet\"");
    expect(String(res.body)).toContain("waybill.number");
  });

  it("exports transfer report with warehouse and item context", async () => {
    const controller = new ReportsController({
      warehouseTransfer: {
        findMany: jest.fn().mockResolvedValue([{
          id: "t1",
          status: "CONFIRMED",
          fromWarehouse: { name: "Dirty stock" },
          toWarehouse: { name: "Clean stock" },
          items: [{ quantity: "12.5", materialType: { name: "Ore" }, productType: null }]
        }])
      }
    } as any);
    const res = fakeResponse();

    await controller.export("transfers", "csv", {}, { id: "u1", organizationId: "o1", permissions: [] }, res as any);

    expect(String(res.body)).toContain("fromWarehouse.name");
    expect(String(res.body)).toContain("toWarehouse.name");
    expect(String(res.body)).toContain("\"Dirty stock\"");
    expect(String(res.body)).toContain("\"Ore:12.5\"");
  });

  it("rejects unknown report type", async () => {
    const controller = new ReportsController({} as any);
    const res = fakeResponse();

    await expect(controller.export("unknown", "csv", {}, { id: "u1", organizationId: "o1", permissions: [] }, res as any)).rejects.toThrow("Unknown report type");
  });
});

function fakeResponse() {
  return {
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    send(body: unknown) {
      this.body = body;
    }
  };
}
