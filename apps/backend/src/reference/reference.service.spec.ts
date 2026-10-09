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
      vehicle: {
        findMany: vehicleFindMany,
        count: jest.fn().mockResolvedValue(0),
      },
      systemSetting: {
        findMany: settingFindMany,
        count: jest.fn().mockResolvedValue(0),
      },
    } as any);

    await service.list(
      "vehicles",
      { page: 1, pageSize: 20, search: "001" } as any,
      user,
    );
    await service.list(
      "settings",
      { page: 1, pageSize: 20, search: "acceptance" } as any,
      { ...user, permissions: ["references.manage"] },
    );

    expect(vehicleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { plateNumber: { contains: "001", mode: "insensitive" } },
            { brand: { contains: "001", mode: "insensitive" } },
            { type: { contains: "001", mode: "insensitive" } },
          ],
        }),
      }),
    );
    expect(settingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ key: { contains: "acceptance", mode: "insensitive" } }],
        }),
      }),
    );
  });

  it("uses whitelisted sort fields for reference lists", async () => {
    const vehicleFindMany = jest.fn().mockResolvedValue([]);
    const driverFindMany = jest.fn().mockResolvedValue([]);
    const service = new ReferenceService({
      $transaction: jest.fn((ops) => Promise.all(ops)),
      vehicle: {
        findMany: vehicleFindMany,
        count: jest.fn().mockResolvedValue(0),
      },
      driver: {
        findMany: driverFindMany,
        count: jest.fn().mockResolvedValue(0),
      },
    } as any);

    await service.list(
      "vehicles",
      { page: 1, pageSize: 20, sortBy: "plateNumber", sortDir: "asc" } as any,
      user,
    );
    await service.list(
      "drivers",
      { page: 1, pageSize: 20, sortBy: "createdAt", sortDir: "asc" } as any,
      user,
    );

    expect(vehicleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { plateNumber: "asc" } }),
    );
    expect(driverFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { fullName: "asc" } }),
    );
  });

  it("maps unique constraint violations to conflict errors", async () => {
    const service = new ReferenceService({
      counterparty: {
        create: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError("duplicate", {
            code: "P2002",
            clientVersion: "test",
          }),
        ),
      },
    } as any);

    await expect(
      service.create("counterparties", { name: "Demo" }, user),
    ).rejects.toThrow(ConflictException);
  });

  it("does not allow reference updates to change organization ownership", async () => {
    const update = jest
      .fn()
      .mockResolvedValue({ id: "c1", organizationId: "o1", name: "Next" });
    const service = new ReferenceService({
      counterparty: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "c1", organizationId: "o1", name: "Old" }),
        update,
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as any);

    await expect(
      service.update(
        "counterparties",
        "c1",
        { name: "Next", organizationId: "foreign" },
        "rename",
        user,
      ),
    ).rejects.toThrow("Недопустимые поля");
    expect(update).not.toHaveBeenCalled();
    await service.update(
      "counterparties",
      "c1",
      { name: "Next" },
      "rename",
      user,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { name: "Next" },
    });
  });
});

describe("reference validation regressions", () => {
  it("rejects a blank counterparty before writing", async () => {
    const create = jest.fn();
    const service = new ReferenceService({ counterparty: { create } } as any);
    await expect(service.create("counterparties", {}, user)).rejects.toThrow(
      "обязательное поле",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("handles duplicate errors originating from another Prisma runtime", async () => {
    const error = Object.assign(new Error("unique violation"), {
      code: "P2002",
    });
    const service = new ReferenceService({
      vehicle: { create: jest.fn().mockRejectedValue(error) },
    } as any);
    await expect(
      service.create(
        "vehicles",
        { plateNumber: "TEST", brand: "MAN", type: "Грузовой" },
        user,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it.each([-1, 101, "3", null, Number.NaN])(
    "rejects invalid acceptance threshold %s without a write",
    async (value) => {
      const upsert = jest.fn();
      const service = new ReferenceService({
        systemSetting: { upsert },
      } as any);
      await expect(
        service.upsertSetting(
          { key: "acceptance.differenceThresholdPercent", value },
          user,
        ),
      ).rejects.toThrow();
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it("persists a valid acceptance threshold and its audit reason", async () => {
    const upsert = jest.fn().mockResolvedValue({ id: "s1", value: 4 });
    const audit = jest.fn().mockResolvedValue({});
    const service = new ReferenceService({
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue({ value: 3 }),
        upsert,
      },
      auditLog: { create: audit },
    } as any);
    await service.upsertSetting(
      {
        key: "acceptance.differenceThresholdPercent",
        value: 4,
        reason: "Review",
      },
      user,
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: 4 } }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: "Review" }),
      }),
    );
  });
});
