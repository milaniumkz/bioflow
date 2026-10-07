import { checkRedis } from "./redis-health";

describe("checkRedis", () => {
  const originalValue = process.env.REDIS_URL;
  beforeEach(() => {
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (originalValue === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalValue;
  });

  it("reports unconfigured when REDIS_URL is missing", async () => {
    await expect(checkRedis(undefined)).resolves.toEqual({
      configured: false,
      ok: false,
    });
  });
});
