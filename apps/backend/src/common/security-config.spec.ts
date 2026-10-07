import {
  assertProductionSecurityConfig,
  corsOriginConfig,
} from "./security-config";

describe("security config", () => {
  it("allows open CORS only outside production when WEB_ORIGIN is missing", () => {
    expect(corsOriginConfig("development", undefined)).toBe(true);
  });

  it("requires explicit WEB_ORIGIN in production", () => {
    expect(() => corsOriginConfig("production", undefined)).toThrow(
      "WEB_ORIGIN is required in production",
    );
  });

  it("parses comma-separated WEB_ORIGIN values", () => {
    expect(
      corsOriginConfig(
        "production",
        "https://app.example.com, https://admin.example.com",
      ),
    ).toEqual(["https://app.example.com", "https://admin.example.com"]);
  });

  it("rejects placeholder production secrets", () => {
    expect(() =>
      assertProductionSecurityConfig({
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: "change-me-access",
        JWT_REFRESH_SECRET: "strong-refresh",
        QR_SIGNING_SECRET: "strong-qr",
      }),
    ).toThrow("JWT_ACCESS_SECRET must be set");
  });

  it("accepts explicit production secrets", () => {
    expect(() =>
      assertProductionSecurityConfig({
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: "a".repeat(48),
        JWT_REFRESH_SECRET: "b".repeat(48),
        QR_SIGNING_SECRET: "c".repeat(48),
      }),
    ).not.toThrow();
  });
});
