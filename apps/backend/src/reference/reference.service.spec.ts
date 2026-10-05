import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ReferenceService } from "./reference.service";

const user = { id: "u1", organizationId: "o1", permissions: [] };

describe("ReferenceService", () => {
  it("uses entity-specific search fields for reference lists", async () => {
    const vehicleFindMany = jest.fn().mockResolvedValue([]);
    const settingFindMany = jest.fn().mockResolvedValue([]);
    const service = new ReferenceService({
      $transaction: jest.fn((ops) => Promise.all(ops)),
      vehicle: { findMany: vehicleFindMany, count: jest.fn().mockResolvedValue(0) },
      systemSetting: { findMany: settingFindMany, count: jest.fn().mockResolvedValue(0) }
    } as any);

    await service.list("vehicles", { page: 1, pageSize: 20, search: "001" } as any, user);
    await service.list("settings", { page: 1, pageSize: 20, search: "acceptance" } as any, user);

    expect(vehicleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { plateNumber: { contains: "001", mode: "insensitive" } },
          { brand: { contains: "001", mode: "insensitive" } },
          { type: { contains: "001", mode: "insensitive" } }
        ]
      })
    }));
    expect(settingFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ key: { contains: "acceptance", mode: "insensitive" } }] })
    }));
  });

  it("uses whitelisted sort fields for reference lists", async () => {
    const vehicleFindMany = jest.fn().mockResolvedValue([]);
    const driverFindMany = jest.fn().mockResolvedValue([]);
    const service = new ReferenceService({
      $transaction: jest.fn((ops) => Promise.all(ops)),
      vehicle: { findMany: vehicleFindMany, count: jest.fn().mockResolvedValue(0) },
      driver: { findMany: driverFindMany, count: jest.fn().mockResolvedValue(0) }
    } as any);

    await service.list("vehicles", { page: 1, pageSize: 20, sortBy: "plateNumber", sortDir: "asc" } as any, user);
    await service.list("drivers", { page: 1, pageSize: 20, sortBy: "createdAt", sortDir: "asc" } as any, user);

    expect(vehicleFindMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { plateNumber: "asc" } }));
    expect(driverFindMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { fullName: "asc" } }));
  });

  it("maps unique constraint violations to conflict errors", async () => {
    const service = new ReferenceService({
      counterparty: {
        create: jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }))
      }
    } as any);

    await expect(service.create("counterparties", { name: "Demo" }, user)).rejects.toThrow(ConflictException);
  });

  it("does not allow reference updates to change organization ownership", async () => {
    const update = jest.fn().mockResolvedValue({ id: "c1", organizationId: "o1", name: "Next" });
    const service = new ReferenceService({
      counterparty: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", organizationId: "o1", name: "Old" }),
        update
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) }
    } as any);

    await service.update("counterparties", "c1", { name: "Next", organizationId: "foreign" }, "rename", user);

    expect(update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { name: "Next" } });
  });
});
