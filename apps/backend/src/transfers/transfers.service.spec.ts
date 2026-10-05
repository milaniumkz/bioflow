import { TransfersService } from "./transfers.service";

const user = { id: "u1", organizationId: "o1", permissions: [] };

describe("TransfersService", () => {
  it("returns paginated transfers with status filtering", async () => {
    const prisma = {
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      warehouseTransfer: {
        findMany: jest.fn().mockResolvedValue([{ id: "t1" }]),
        count: jest.fn().mockResolvedValue(1)
      }
    };
    const service = new TransfersService(prisma as any);

    const result = await service.list({ page: 2, pageSize: 5, status: "DRAFT", sortBy: "status", sortDir: "asc" }, user);

    expect(result).toEqual({ data: [{ id: "t1" }], total: 1, page: 2, pageSize: 5 });
    expect(prisma.warehouseTransfer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "o1", status: "DRAFT" },
      skip: 5,
      take: 5,
      orderBy: { status: "asc" }
    }));
  });

  it("checks both warehouses before creating a transfer", async () => {
    const tx = {
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: "w1" }) },
      materialType: { findUnique: jest.fn().mockResolvedValue({ id: "m1" }) },
      productType: { findUnique: jest.fn().mockResolvedValue({ id: "p1" }) },
      warehouseTransfer: { create: jest.fn().mockResolvedValue({ id: "t1", items: [] }) }
    };
    const service = new TransfersService({ $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as any);

    await service.create({
      fromWarehouseId: "w1",
      toWarehouseId: "w2",
      items: [{ materialTypeId: "m1", state: "DIRTY", quantity: "10" }]
    }, user);

    expect(tx.warehouse.findFirst).toHaveBeenCalledWith({ where: { id: "w1", organizationId: "o1" } });
    expect(tx.warehouse.findFirst).toHaveBeenCalledWith({ where: { id: "w2", organizationId: "o1" } });
    expect(tx.warehouseTransfer.create).toHaveBeenCalled();
  });

  it("rejects transfer creation when a warehouse is outside organization scope", async () => {
    const tx = {
      warehouse: { findFirst: jest.fn().mockResolvedValueOnce({ id: "w1" }).mockResolvedValueOnce(null) },
      materialType: { findUnique: jest.fn() },
      productType: { findUnique: jest.fn() },
      warehouseTransfer: { create: jest.fn() }
    };
    const service = new TransfersService({ $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as any);

    await expect(service.create({
      fromWarehouseId: "w1",
      toWarehouseId: "foreign",
      items: [{ materialTypeId: "m1", state: "DIRTY", quantity: "10" }]
    }, user)).rejects.toThrow("Warehouse not found");
    expect(tx.warehouseTransfer.create).not.toHaveBeenCalled();
  });
});
