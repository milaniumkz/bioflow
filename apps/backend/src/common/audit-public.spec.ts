import { publicAuditValue } from "./audit-public";
describe("public audit values", () => {
  it("redacts nested secrets without modifying stored evidence", () => {
    const source = {
      passwordHash: "synthetic-hash",
      nested: {
        accessToken: "synthetic-token",
        refreshToken: "synthetic-refresh",
        qrToken: "synthetic-qr",
        apiKey: "synthetic-key",
      },
      mustChangePassword: true,
      lossQuantity: "0",
      accessAllObjects: false,
    };
    const result: any = publicAuditValue(source);
    expect(result.passwordHash).toBe("[скрыто]");
    expect(Object.values(result.nested)).toEqual(Array(4).fill("[скрыто]"));
    expect(result.mustChangePassword).toBe(true);
    expect(result.lossQuantity).toBe("0");
    expect(result.accessAllObjects).toBe(false);
    expect(source.passwordHash).toBe("synthetic-hash");
  });
  it("preserves nulls and structured nonsecret facts", () =>
    expect(
      publicAuditValue({
        before: null,
        after: [{ warehouseScopeIds: ["w1"] }],
      }),
    ).toEqual({ before: null, after: [{ warehouseScopeIds: ["w1"] }] }));
  it("covers common snake-case credentials without hiding role codes", () => {
    expect(
      publicAuditValue({
        api_key: "synthetic",
        private_key: "synthetic",
        reset_code: "synthetic",
        mustChangePassword: "synthetic",
        code: "AUDITOR",
      }),
    ).toEqual({
      api_key: "[скрыто]",
      private_key: "[скрыто]",
      reset_code: "[скрыто]",
      mustChangePassword: "[скрыто]",
      code: "AUDITOR",
    });
  });
});
