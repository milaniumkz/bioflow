import {
  BrowserAuthController,
  assertBrowserOrigin,
  browserRefreshCookie,
} from "./browser-auth.controller";
import { UnauthorizedException } from "@nestjs/common";
const request = (extra = {}) =>
  ({
    headers: {
      origin: "https://collection.example",
      host: "collection.example",
      ...extra,
    },
  }) as any;
function response() {
  return {
    setHeader: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as any;
}
test("browser login sets an HttpOnly cookie and never exposes refresh tokens in JSON", async () => {
  const auth = {
    login: jest.fn().mockResolvedValue({
      accessToken: "access",
      refreshToken: "secret-refresh",
    }),
  };
  const controller = new BrowserAuthController(auth as any),
    res = response();
  expect(
    await controller.login(
      { phone: "+77000000000", password: "test" },
      request(),
      res,
    ),
  ).toEqual({ accessToken: "access" });
  expect(res.cookie).toHaveBeenCalledWith(
    "bioflow_refresh",
    "secret-refresh",
    expect.objectContaining({
      httpOnly: true,
      sameSite: "strict",
      path: "/api/v1/auth",
      maxAge: 2592000000,
    }),
  );
});
test("cross-site requests and missing origins are rejected before session rotation", () => {
  expect(() =>
    assertBrowserOrigin(request({ origin: "https://attacker.example" })),
  ).toThrow();
  expect(() => assertBrowserOrigin(request({ origin: undefined }))).toThrow();
  expect(
    browserRefreshCookie(
      request({ cookie: "other=x; bioflow_refresh=abc%2D123" }),
    ),
  ).toBe("abc-123");
  expect(
    browserRefreshCookie(request({ cookie: "bioflow_refresh=%bad" })),
  ).toBeUndefined();
});
test("refresh rotates cookie; revoked sessions clear it; logout revokes the current token", async () => {
  const auth = {
    refresh: jest
      .fn()
      .mockResolvedValue({ accessToken: "access", refreshToken: "next" }),
    revokeRefresh: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new BrowserAuthController(auth as any),
    req = request({ cookie: "bioflow_refresh=old" }),
    res = response();
  expect(await controller.refresh(req, res)).toEqual({ accessToken: "access" });
  expect(auth.refresh).toHaveBeenCalledWith("old");
  auth.refresh.mockRejectedValue(new UnauthorizedException());
  await expect(controller.refresh(req, res)).rejects.toThrow();
  expect(res.clearCookie).toHaveBeenCalled();
  await controller.logout(req, res);
  expect(auth.revokeRefresh).toHaveBeenCalledWith("old");
});

test("production cookies require a secure origin and carry the Secure flag", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    expect(() =>
      assertBrowserOrigin(request({ origin: "http://collection.example" })),
    ).toThrow();
    const controller = new BrowserAuthController({
        login: async () => ({ accessToken: "access", refreshToken: "refresh" }),
      } as any),
      res = response();
    await controller.login(
      { phone: "+77000000000", password: "test" },
      request(),
      res,
    );
    expect(res.cookie.mock.calls[0][2].secure).toBe(true);
  } finally {
    process.env.NODE_ENV = previous;
  }
});
