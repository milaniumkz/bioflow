import { AuditController } from "./audit.controller";
describe("audit presentation", () => {
  it("keeps a scoped caller on their own records even when searching", async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        {
          oldValue: { passwordHash: "synthetic" },
          newValue: { mustChangePassword: true },
        },
      ]);
    const count = jest.fn().mockResolvedValue(1);
    const c = new AuditController({
      auditLog: { findMany, count },
      $transaction: (p: Promise<unknown>[]) => Promise.all(p),
    } as any);
    const result = await c.list(
      { page: 1, pageSize: 20, search: "user" } as any,
      { id: "u1", organizationId: "o1", permissions: ["audit.read"] },
    );
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: "o1",
      userId: "u1",
    });
    expect(result.data[0].oldValue).toEqual({ passwordHash: "[скрыто]" });
    expect(result.data[0].newValue).toEqual({ mustChangePassword: true });
  });
  it("resolves scope names only inside current organization and assigned objects", async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        {
          oldValue: { warehouseScopeIds: ["allowed", "other"] },
          newValue: { warehouseScopeIds: ["allowed"] },
        },
      ]);
    const warehouse = jest
      .fn()
      .mockResolvedValue([{ id: "allowed", name: "Мойка" }]);
    const c = new AuditController({
      auditLog: { findMany, count: jest.fn().mockResolvedValue(1) },
      warehouse: { findMany: warehouse },
      $transaction: (p: Promise<unknown>[]) => Promise.all(p),
    } as any);
    const result = await c.list({ page: 1, pageSize: 20 } as any, {
      id: "u",
      organizationId: "o",
      permissions: ["audit.read"],
      warehouseScopeIds: ["allowed"],
    });
    expect(warehouse.mock.calls[0][0].where).toEqual({
      organizationId: "o",
      id: { in: ["allowed"] },
    });
    expect(result.data[0].scopeNames.warehouseScopeIds).toEqual({
      allowed: "Мойка",
    });
  });
});
