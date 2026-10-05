import { checkRedis } from "./redis-health";

describe("checkRedis", () => {
  it("reports unconfigured when REDIS_URL is missing", async () => {
    await expect(checkRedis(undefined)).resolves.toEqual({ configured: false, ok: false });
  });
});
