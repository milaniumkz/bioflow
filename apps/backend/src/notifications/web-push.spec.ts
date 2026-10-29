import { parseWebSubscription } from "./web-push";
describe("browser push subscriptions", () => {
  const valid = {
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    keys: {
      p256dh: Buffer.alloc(65, 1).toString("base64url"),
      auth: Buffer.alloc(16, 2).toString("base64url"),
    },
  };
  it("accepts browser push endpoints and strips unrelated properties", () => {
    expect(parseWebSubscription({ ...valid, userId: "other-user" })).toEqual(
      valid,
    );
  });
  it("rejects internal addresses, userinfo, plaintext and unknown push services", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/send",
      "https://127.0.0.1/admin",
      "https://example.com/push",
      "https://user:pass@fcm.googleapis.com/send",
      "https://fcm.googleapis.com:1234/send",
    ]) {
      expect(() => parseWebSubscription({ ...valid, endpoint })).toThrow();
    }
  });
  it("rejects missing encryption keys", () => {
    expect(() => parseWebSubscription({ ...valid, keys: {} })).toThrow();
  });
});
