import * as webPush from "web-push";
import { BadRequestException } from "@nestjs/common";

export function parseWebSubscription(raw: unknown): webPush.PushSubscription {
  const value = raw as webPush.PushSubscription;
  let endpoint: URL;
  try {
    endpoint = new URL(value?.endpoint);
  } catch {
    throw new BadRequestException("Некорректная подписка браузера");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    (endpoint.port && endpoint.port !== "443") ||
    (![
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
    ].includes(endpoint.hostname) &&
      !endpoint.hostname.endsWith(".notify.windows.com")) ||
    value.endpoint.length > 4096 ||
    !/^[A-Za-z0-9_-]{40,200}$/.test(value.keys?.p256dh ?? "") ||
    !/^[A-Za-z0-9_-]{16,100}$/.test(value.keys?.auth ?? "")
  ) {
    throw new BadRequestException("Некорректная подписка браузера");
  }
  return {
    endpoint: endpoint.href,
    keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
  };
}
export function webPushReady() {
  return Boolean(
    process.env.WEB_PUSH_PUBLIC_KEY &&
    process.env.WEB_PUSH_PRIVATE_KEY &&
    process.env.WEB_PUSH_SUBJECT,
  );
}
export async function sendBrowserPush(subscription: string, payload: object) {
  if (!webPushReady()) throw Error("Browser push not configured");
  return webPush.sendNotification(
    parseWebSubscription(JSON.parse(subscription)),
    JSON.stringify(payload),
    {
      TTL: 3600,
      timeout: 15000,
      vapidDetails: {
        subject: process.env.WEB_PUSH_SUBJECT!,
        publicKey: process.env.WEB_PUSH_PUBLIC_KEY!,
        privateKey: process.env.WEB_PUSH_PRIVATE_KEY!,
      },
    },
  );
}
