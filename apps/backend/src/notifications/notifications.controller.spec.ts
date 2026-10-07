import { NotificationsController } from "./notifications.controller";

describe("NotificationsController", () => {
  it("returns paginated notifications scoped to user and organization", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "n1" }]);
    const count = jest.fn().mockResolvedValue(1);
    const controller = new NotificationsController({
      $transaction: jest.fn((ops) => Promise.all(ops)),
      notification: { findMany, count },
    } as any);

    await expect(
      controller.list({ page: 2, pageSize: 10 } as any, {
        id: "u1",
        organizationId: "o1",
        permissions: [],
      }),
    ).resolves.toEqual({
      data: [{ id: "n1" }],
      total: 1,
      page: 2,
      pageSize: 10,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "o1", OR: [{ userId: "u1" }] },
      }),
    );
  });
});
