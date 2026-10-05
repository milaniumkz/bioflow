import { Prisma } from "@prisma/client";
import { WaybillsService } from "./waybills.service";

const user = { id: "u1", organizationId: "o1", permissions: [] };
const dto = {
  counterpartyId: "c1",
  extractionSiteId: "s1",
  vehicleId: "v1",
  driverId: "d1",
  destinationWarehouseId: "w1",
  materialTypeId: "m1",
  declaredWeight: "100"
};

describe("WaybillsService", () => {
  it("rejects create when a reference is outside organization scope", async () => {
    const tx = {
      counterparty: { findFirst: jest.fn().mockResolvedValue(null) },
      extractionSite: { findFirst: jest.fn().mockResolvedValue({ id: "s1" }) },
      vehicle: { findFirst: jest.fn().mockResolvedValue({ id: "v1" }) },
      driver: { findFirst: jest.fn().mockResolvedValue({ id: "d1" }) },
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: "w1" }) },
      materialType: { findUnique: jest.fn().mockResolvedValue({ id: "m1" }) },
      waybill: { create: jest.fn() }
    };
    const service = new WaybillsService({ $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as any);

    await expect(service.create(dto, user)).rejects.toThrow("Counterparty not found");
    expect(tx.counterparty.findFirst).toHaveBeenCalledWith({ where: { id: "c1", organizationId: "o1" } });
    expect(tx.waybill.create).not.toHaveBeenCalled();
  });

  it("accepts a waybill and writes movement plus balance atomically", async () => {
    const tx = {
      acceptance: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "a1", waybillId: "wb1" })
      },
      waybill: {
        findFirst: jest.fn().mockResolvedValue({ id: "wb1", declaredWeight: new Prisma.Decimal(100), materialTypeId: "m1", status: "ARRIVED" }),
        update: jest.fn().mockResolvedValue({})
      },
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: "w1" }) },
      systemSetting: { findUnique: jest.fn().mockResolvedValue({ value: 3 }) },
      inventoryMovement: { create: jest.fn().mockResolvedValue({ id: "mov1" }) },
      inventoryItem: { upsert: jest.fn().mockResolvedValue({ id: "item1" }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) }
    };
    const service = new WaybillsService({ $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as any);

    await service.accept("wb1", { warehouseId: "w1", actualWeight: "100", idempotencyKey: "idem1" }, user);

    expect(tx.acceptance.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ waybillId: "wb1", warehouseId: "w1", idempotencyKey: "idem1" })
    }));
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "RECEIPT", materialTypeId: "m1", waybillId: "wb1", warehouseId: "w1" })
    }));
    expect(tx.inventoryItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { skuKey: "w1:m1:DIRTY" },
      create: expect.objectContaining({ warehouseId: "w1", materialTypeId: "m1", state: "DIRTY" })
    }));
  });

  it("rejects reused idempotency key from another organization", async () => {
    const tx = {
      acceptance: {
        findUnique: jest.fn().mockResolvedValue({ id: "a1", waybill: { organizationId: "foreign" } }),
        create: jest.fn()
      },
      waybill: { findFirst: jest.fn() }
    };
    const service = new WaybillsService({ $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as any);

    await expect(service.accept("wb1", { warehouseId: "w1", actualWeight: "100", idempotencyKey: "idem1" }, user)).rejects.toThrow("Idempotency key already used");
    expect(tx.acceptance.findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: "idem1" }, include: { waybill: true } });
    expect(tx.acceptance.create).not.toHaveBeenCalled();
    expect(tx.waybill.findFirst).not.toHaveBeenCalled();
  });

  it("rejects acceptance before waybill arrival", async () => {
    const tx = {
      acceptance: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      waybill: {
        findFirst: jest.fn().mockResolvedValue({ id: "wb1", declaredWeight: new Prisma.Decimal(100), materialTypeId: "m1", status: "IN_TRANSIT" })
      },
      warehouse: { findFirst: jest.fn() }
    };
    const service = new WaybillsService({ $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as any);

    await expect(service.accept("wb1", { warehouseId: "w1", actualWeight: "100", idempotencyKey: "idem1" }, user)).rejects.toThrow("Waybill must be arrived before acceptance");
    expect(tx.acceptance.create).not.toHaveBeenCalled();
    expect(tx.warehouse.findFirst).not.toHaveBeenCalled();
  });
});
