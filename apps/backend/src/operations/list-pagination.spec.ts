import { OperationsController } from "./operations.controller";
import { ShipmentsService } from "../shipments/shipments.service";
import { WriteOffsService } from "../write-offs/write-offs.service";

const user = { id: "u1", organizationId: "o1", permissions: [] };

describe("operation list pagination", () => {
  it("returns paginated washing batches with whitelisted sorting", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "wash1" }]);
    const count = jest.fn().mockResolvedValue(1);
    const controller = new OperationsController({} as any, {
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      washingBatch: { findMany, count }
    } as any);

    const result = await controller.listWashing({ page: 2, pageSize: 10, sortBy: "inputWeight", sortDir: "asc", status: "CONFIRMED" }, user);

    expect(result).toEqual({ data: [{ id: "wash1" }], total: 1, page: 2, pageSize: 10 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "o1", status: "CONFIRMED" },
      skip: 10,
      take: 10,
      orderBy: { inputWeight: "asc" }
    }));
  });

  it("falls back to createdAt when shipment sort is not allowed", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "ship1" }]);
    const count = jest.fn().mockResolvedValue(1);
    const service = new ShipmentsService({
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      shipment: { findMany, count }
    } as any);

    const result = await service.list({ page: 1, pageSize: 20, search: "ACME", sortBy: "warehouseId", sortDir: "asc" }, user);

    expect(result.total).toBe(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "o1", recipient: { contains: "ACME", mode: "insensitive" } },
      orderBy: { createdAt: "asc" }
    }));
  });

  it("filters write-offs by state and status", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "wo1" }]);
    const count = jest.fn().mockResolvedValue(1);
    const service = new WriteOffsService({
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      writeOff: { findMany, count }
    } as any);

    const result = await service.list({ page: 3, pageSize: 5, status: "CONFIRMED", state: "DIRTY", sortBy: "quantity", sortDir: "desc" }, user);

    expect(result).toEqual({ data: [{ id: "wo1" }], total: 1, page: 3, pageSize: 5 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "o1", status: "CONFIRMED", state: "DIRTY" },
      skip: 10,
      take: 5,
      orderBy: { quantity: "desc" }
    }));
  });
});
