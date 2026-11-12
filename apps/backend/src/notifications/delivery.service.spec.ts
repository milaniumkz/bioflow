import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DeliveryService } from "./delivery.service";

describe("push delivery during a prolonged provider outage", () => {
  it("keeps retrying after more than ten failures and marks a recovered delivery sent", async () => {
    const directory = mkdtempSync(join(tmpdir(), "collection-push-spec-"));
    const previous = process.env.FCM_SERVICE_ACCOUNT_FILE;
    const collectionBefore = process.env.COLLECTION_ENABLED;
    process.env.COLLECTION_ENABLED = "true";
    const file = join(directory, "account.json");
    writeFileSync(
      file,
      JSON.stringify({
        project_id: "spec-project",
        client_email: "spec@example.test",
        private_key: "not-a-real-private-key",
      }),
    );
    process.env.FCM_SERVICE_ACCOUNT_FILE = file;
    const delivery = {
      id: "delivery",
      deviceId: "device",
      notificationId: "notice",
      attempts: 12,
    };
    const findMany = jest.fn(async ({ where }) =>
      where.attempts?.lt && delivery.attempts >= where.attempts.lt
        ? []
        : [delivery],
    );
    const update = jest.fn().mockResolvedValue({});
    const database = {
      pushDelivery: {
        findMany,
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update,
      },
      device: {
        findUnique: jest.fn().mockResolvedValue({
          id: "device",
          userId: "user",
          pushToken: "not-a-real-device-token",
        }),
      },
      notification: {
        findUnique: jest.fn().mockResolvedValue({
          id: "notice",
          userId: "user",
          title: "Arrival",
          body: "Confirm receipt",
          type: "COLLECTION_EVENT",
        }),
      },
      collectionNoticeLink: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new DeliveryService(database as any);
    (service as any).token = jest.fn().mockResolvedValue("fake-oauth-token");
    const fetch = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    try {
      await (service as any).deliver();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string)
          .message.android.priority,
      ).toBe("HIGH");
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "PENDING" }),
        }),
      );
      await (service as any).deliver();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "SENT", lastError: null }),
        }),
      );
    } finally {
      fetch.mockRestore();
      if (collectionBefore === undefined) delete process.env.COLLECTION_ENABLED;
      else process.env.COLLECTION_ENABLED = collectionBefore;
      if (previous === undefined) delete process.env.FCM_SERVICE_ACCOUNT_FILE;
      else process.env.FCM_SERVICE_ACCOUNT_FILE = previous;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Collection notification latency", () => {
  it("checks Collection delivery every second and stops polling after shutdown", async () => {
    jest.useFakeTimers();
    const previous = process.env.COLLECTION_ENABLED;
    process.env.COLLECTION_ENABLED = "true";
    const service = new DeliveryService({} as any);
    const tick = jest.spyOn(service, "tick").mockResolvedValue();
    try {
      service.onModuleInit();
      expect(tick).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1000);
      expect(tick).toHaveBeenCalledTimes(2);
      service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(3000);
      expect(tick).toHaveBeenCalledTimes(2);
    } finally {
      service.onModuleDestroy();
      if (previous === undefined) delete process.env.COLLECTION_ENABLED;
      else process.env.COLLECTION_ENABLED = previous;
      jest.useRealTimers();
    }
  });
  it("does not repeatedly scan reminders while sending urgent pushes", async () => {
    const service = new DeliveryService({} as any);
    const reminders = jest
      .spyOn(service as any, "reminders")
      .mockResolvedValue(undefined);
    await service.tick();
    await service.tick();
    expect(reminders).toHaveBeenCalledTimes(1);
  });
});
