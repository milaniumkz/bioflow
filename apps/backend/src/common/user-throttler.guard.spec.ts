import { JwtService } from "@nestjs/jwt";
import { throttleIdentity, UserThrottlerGuard } from "./user-throttler.guard";
import { Reflector } from "@nestjs/core";
import { ExecutionContext } from "@nestjs/common";
test("verified employees sharing one address have independent quotas; public login remains IP limited", () => {
  const jwt = new JwtService();
  const secret = process.env.JWT_ACCESS_SECRET ?? "dev-access";
  const header = (sub: string) =>
    `Bearer ${jwt.sign({ sub }, { secret, expiresIn: "1m" })}`;
  expect(throttleIdentity(header("first"), "same-ip", false)).toBe(
    "user:first",
  );
  expect(throttleIdentity(header("second"), "same-ip", false)).toBe(
    "user:second",
  );
  expect(throttleIdentity(header("first"), "same-ip", true)).toBe("same-ip");
  expect(throttleIdentity(undefined, "same-ip", false)).toBe("same-ip");
  expect(
    throttleIdentity(
      `Bearer ${jwt.sign({ sub: "forged" }, { secret: "wrong" })}`,
      "same-ip",
      false,
    ),
  ).toBe("same-ip");
  expect(
    throttleIdentity(
      `Bearer ${jwt.sign({ sub: "expired" }, { secret, expiresIn: -1 })}`,
      "same-ip",
      false,
    ),
  ).toBe("same-ip");
});
test("route aliases have separate read budgets while IDs and query strings cannot bypass a route's quota", () => {
  class Guard extends UserThrottlerGuard {
    key(path: string, id: string, query: string) {
      class Routes {}
      function list() {}
      return this.generateKey(
        {
          getClass: () => Routes,
          getHandler: () => list,
          switchToHttp: () => ({
            getRequest: () => ({
              headers: {},
              route: { path },
              params: { id },
              originalUrl: path + query,
            }),
          }),
        } as unknown as ExecutionContext,
        "same-ip",
        "default",
      );
    }
  }
  const guard = new Guard([], { increment: jest.fn() }, new Reflector());
  expect(guard.key("/warehouses", "", "")).not.toBe(
    guard.key("/vehicles", "", ""),
  );
  expect(guard.key("/batches/:id", "first", "?search=one")).toBe(
    guard.key("/batches/:id", "second", "?search=two"),
  );
});
