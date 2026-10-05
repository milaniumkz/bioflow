import { HealthController } from "./health.controller";

jest.mock("./common/redis-health", () => ({
  checkRedis: jest.fn().mockResolvedValue({ configured: true, ok: true })
}));

describe("HealthController", () => {
  it("returns database and redis checks", async () => {
    const controller = new HealthController({ $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]) } as any);

    const result = await controller.health();

    expect(result.status).toBe("ok");
    expect(result.checks.database).toBe(true);
    expect(result.checks.redis).toEqual({ configured: true, ok: true });
  });
});
