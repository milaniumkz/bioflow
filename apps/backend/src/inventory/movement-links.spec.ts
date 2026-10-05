import { Prisma } from "@prisma/client";
import { InventoryService } from "./inventory.service";
import { ShipmentsService } from "../shipments/shipments.service";
import { WriteOffsService } from "../write-offs/write-offs.service";

const user = { id: "u1", organizationId: "o1", permissions: [] };

describe("inventory movement typed links", () => {
  it("stores product type on finished goods correction movements", async () => {
    const tx = txMock({
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: "w1" }) },
      materialType: { findUnique: jest.fn().mockResolvedValue({ id: "m1" }) },
      productType: { findUnique: jest.fn().mockResolvedValue({ id: "p1" }) },
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: "item1", quantity: new Prisma.Decimal(10) })
      },
      inventoryMovement: { create: jest.fn().mockResolvedValue({ id: "mov1" }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) }
    });
    const service = new InventoryService(prismaTx(tx) as any);

    await service.correct({ warehouseId: "w1", productTypeId: "p1", state: "FINISHED", quantityDelta: "10", reason: "Opening balance" }, user);

    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ productTypeId: "p1", materialTypeId: undefined })
    }));
  });

  it("stores material type on write-off movements", async () => {
    const tx = txMock({
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: "w1" }) },
      materialType: { findUnique: jest.fn().mockResolvedValue({ id: "m1" }) },
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue({ id: "item1", quantity: new Prisma.Decimal(100) }),
        update: jest.fn().mockResolvedValue({})
      },
      writeOff: { create: jest.fn().mockResolvedValue({ id: "wo1" }) },
      inventoryMovement: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) }
    });
    const service = new WriteOffsService(prismaTx(tx) as any);

    await service.create({ warehouseId: "w1", materialTypeId: "m1", state: "DIRTY", quantity: "5", reason: "Damage" }, user);

    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ materialTypeId: "m1", productTypeId: undefined })
    }));
  });

  it("stores product type on shipment movements", async () => {
    const tx = txMock({
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: "w1" }) },
      productType: { findUnique: jest.fn().mockResolvedValue({ id: "p1" }) },
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue({ id: "item1", quantity: new Prisma.Decimal(100) }),
        update: jest.fn().mockResolvedValue({})
      },
      shipment: { create: jest.fn().mockResolvedValue({ id: "ship1" }) },
      inventoryMovement: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) }
    });
    const service = new ShipmentsService(prismaTx(tx) as any);

    await service.create({ warehouseId: "w1", productTypeId: "p1", quantity: "5", recipient: "ACME" }, user);

    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ productTypeId: "p1" })
    }));
  });

  it("rejects correction when warehouse is outside organization scope", async () => {
    const tx = txMock({
      warehouse: { findFirst: jest.fn().mockResolvedValue(null) }
    });
    const service = new InventoryService(prismaTx(tx) as any);

    await expect(service.correct({ warehouseId: "foreign", materialTypeId: "m1", state: "DIRTY", quantityDelta: "1", reason: "Test" }, user)).rejects.toThrow("Warehouse not found");
  });

  it("rejects correction when material type does not exist", async () => {
    const tx = txMock({
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: "w1" }) },
      materialType: { findUnique: jest.fn().mockResolvedValue(null) },
      inventoryItem: { findUnique: jest.fn() }
    });
    const service = new InventoryService(prismaTx(tx) as any);

    await expect(service.correct({ warehouseId: "w1", materialTypeId: "missing", state: "DIRTY", quantityDelta: "1", reason: "Test" }, user)).rejects.toThrow("Material type not found");
    expect(tx.inventoryItem.findUnique).not.toHaveBeenCalled();
  });

  it("rejects write-off when material type does not exist", async () => {
    const tx = txMock({
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: "w1" }) },
      materialType: { findUnique: jest.fn().mockResolvedValue(null) },
      inventoryItem: { findUnique: jest.fn() }
    });
    const service = new WriteOffsService(prismaTx(tx) as any);

    await expect(service.create({ warehouseId: "w1", materialTypeId: "missing", state: "DIRTY", quantity: "1", reason: "Damage" }, user)).rejects.toThrow("Material type not found");
    expect(tx.inventoryItem.findUnique).not.toHaveBeenCalled();
  });

  it("rejects shipment when product type does not exist", async () => {
    const tx = txMock({
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: "w1" }) },
      productType: { findUnique: jest.fn().mockResolvedValue(null) },
      inventoryItem: { findUnique: jest.fn() }
    });
    const service = new ShipmentsService(prismaTx(tx) as any);

    await expect(service.create({ warehouseId: "w1", productTypeId: "missing", quantity: "5", recipient: "ACME" }, user)).rejects.toThrow("Product type not found");
    expect(tx.inventoryItem.findUnique).not.toHaveBeenCalled();
  });
});

function prismaTx(tx: Record<string, unknown>) {
  return { $transaction: (callback: (value: Record<string, unknown>) => unknown) => callback(tx) };
}

function txMock<T extends Record<string, unknown>>(tx: T): T {
  return tx;
}
