"use client";

import { collectionApk, driverApk } from "./apk-downloads";
import { useEffect, useRef, useState } from "react";

type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [ios, setIos] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [error, setError] = useState("");
  const installEvent = useRef<InstallEvent | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (
      new URLSearchParams(location.search).get("mobile") === "1" ||
      "BioflowMobile" in window
    )
      return;
    const standalone =
      matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone;
    if (standalone) return;
    setEnabled(true);
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIos(isIos);
    try {
      if (
        (isIos || /Android/.test(navigator.userAgent)) &&
        !localStorage.getItem("collection-install-seen")
      )
        setVisible(true);
    } catch {
      /* Installation help still works when storage is unavailable. */
    }
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/collection-sw.js", { scope: "/" })
        .catch(() => {});
    const available = (event: Event) => {
      event.preventDefault();
      installEvent.current = event as InstallEvent;
      setCanInstall(true);
    };
    const installed = () => {
      setEnabled(false);
      setVisible(false);
    };
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  useEffect(() => {
    if (visible && !dialog.current?.open) dialog.current?.showModal();
    if (!visible && dialog.current?.open) dialog.current?.close();
  }, [visible]);

  function close() {
    setVisible(false);
    try {
      localStorage.setItem("collection-install-seen", "1");
    } catch {
      /* Optional preference. */
    }
  }

  async function install() {
    const event = installEvent.current;
    if (!event) return;
    try {
      await event.prompt();
      const result = await event.userChoice;
      installEvent.current = null;
      setCanInstall(false);
      if (result.outcome === "accepted") close();
    } catch {
      setError(
        "Откройте меню браузера и выберите «Добавить на главный экран».",
      );
    }
  }

  if (!enabled) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setVisible(true)}
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 1000,
          borderRadius: 24,
          padding: "10px 18px",
          background: "#13795b",
          color: "white",
          border: 0,
          boxShadow: "0 2px 10px #0003",
        }}
      >
        Установить Collection
      </button>
      <dialog
        ref={dialog}
        onCancel={close}
        onClose={() => setVisible(false)}
        aria-labelledby="install-title"
        style={{
          maxWidth: 440,
          width: "calc(100% - 48px)",
          border: 0,
          borderRadius: 20,
          padding: 24,
          lineHeight: 1.6,
        }}
      >
        <h2 id="install-title">Collection на главном экране</h2>
        {ios ? (
          <p>
            Откройте эту страницу в Safari. Нажмите «Поделиться» (квадрат со
            стрелкой вверх) → «На экран “Домой”» → «Добавить».
          </p>
        ) : (
          <p>
            Добавьте Collection на главный экран телефона. В Chrome нажмите
            «Установить приложение» или откройте меню ⋮ → «Добавить на главный
            экран».
          </p>
        )}
        {canInstall && (
          <button type="button" onClick={() => void install()}>
            Добавить веб-версию на главный экран
          </button>
        )}
        {error && <p role="status">{error}</p>}
        {!ios && (
          <div>
            <p>
              <a href={collectionApk}>Скачать Collection APK</a> ·{" "}
              <a href={driverApk}>Скачать Collection Driver APK</a>
            </p>
            <p>
              Откройте скачанный файл в «Загрузках» → разрешите установку, если
              телефон спросит → «Установить».
            </p>
          </div>
        )}
        <button type="button" onClick={close}>
          Понятно
        </button>
      </dialog>
    </>
  );
}
