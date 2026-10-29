import { RbacGuard } from "./rbac.guard";
import { PERMISSIONS_KEY } from "./permissions.decorator";
describe("scoped browser notification routes", () => {
  const guard = new RbacGuard({
    getAllAndOverride: (key: string) =>
      key === PERMISSIONS_KEY ? ["notifications.read"] : false,
  } as any);
  function context(path: string, permissions = ["notifications.read"]) {
    return {
      getHandler: () => () => {},
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({
          originalUrl: "/api/v1" + path,
          method: path.endsWith("-key") ? "GET" : "POST",
          user: { id: "employee", accessAllObjects: false, permissions },
        }),
      }),
    } as any;
  }
  it("allows scoped staff to request the public key and register their browser", () => {
    expect(guard.canActivate(context("/notifications/browser-push-key"))).toBe(
      true,
    );
    expect(guard.canActivate(context("/notifications/browser-push"))).toBe(
      true,
    );
  });
  it("still requires notification permission", () => {
    expect(() =>
      guard.canActivate(context("/notifications/browser-push", [])),
    ).toThrow("Insufficient permissions");
  });
  it("does not open unrelated administrative routes", () => {
    expect(() => guard.canActivate(context("/notifications/admin"))).toThrow(
      "Маршрут недоступен",
    );
  });
});
