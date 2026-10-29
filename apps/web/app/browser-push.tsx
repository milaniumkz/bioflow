"use client";
import { useState } from "react";
import { webRequest } from "./session";
export function BrowserPush({ token }: { token: string }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function enable() {
    setBusy(true);
    setMessage("");
    try {
      if (
        !window.isSecureContext ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      )
        throw Error(
          "Уведомления браузера требуют HTTPS и поддерживаемый браузер. На iPhone добавьте Collection на главный экран и откройте оттуда.",
        );
      if ((await Notification.requestPermission()) !== "granted")
        throw Error(
          "Уведомления не разрешены. Разрешите их в настройках этого сайта и повторите попытку.",
        );
      const config = await webRequest<{
        available: boolean;
        publicKey: string | null;
      }>("/notifications/browser-push-key", token);
      if (!config.available || !config.publicKey)
        throw Error(
          "Сервер уведомлений ещё не настроен. Уведомления доступны внутри приложения.",
        );
      const registration = await navigator.serviceWorker.register(
        "/collection-push-sw.js",
        { scope: "/" },
      );
      await navigator.serviceWorker.ready;
      const raw = atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/"));
      const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }));
      await webRequest("/notifications/browser-push", token, {
        method: "POST",
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      setMessage("Уведомления браузера включены для вашего аккаунта.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Уведомления браузера</h2>
      <p>
        События рейсов и рабочих объектов будут приходить после вашего
        разрешения. Содержание зависит от роли и доступов.
      </p>
      <button className="button" disabled={busy} onClick={() => void enable()}>
        {busy ? "Подключаем…" : "Включить уведомления браузера"}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
