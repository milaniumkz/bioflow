"use client";
import { useEffect, useRef, useState } from "react";
import { RecordDrawer } from "./design-system";

export function QrScanner({
  onScan,
  onClose,
}: {
  onScan: (code: string) => Promise<void>;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef<number>(0);
  const lastDecode = useRef(0);
  const cameraVersion = useRef(0);
  const alive = useRef(true),
    reading = useRef(false),
    accepted = useRef(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  function stop() {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  useEffect(() => {
    alive.current = true;
    void start();
    return () => {
      alive.current = false;
      cameraVersion.current++;
      stop();
    };
  }, []);
  async function accept(value: string) {
    if (!alive.current || accepted.current || !value.trim()) return;
    accepted.current = true;
    stop();
    setCamera(false);
    setBusy(true);
    setError("");
    try {
      await onScan(value.trim());
      if (alive.current) onClose();
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        accepted.current = false;
        setBusy(false);
        setCamera(false);
      }
    }
  }
  async function decode(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import("jsqr");
    return jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: "attemptBoth",
    })?.data;
  }
  async function start() {
    const generation = ++cameraVersion.current;
    stop();
    setError("");
    setCamera(false);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "Для сканирования откройте защищённый адрес сайта (HTTPS) и разрешите доступ к камере.",
      );
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!alive.current || generation !== cameraVersion.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      if (!video.current) {
        stop();
        return;
      }
      video.current.srcObject = media;
      await video.current.play();
      setCamera(true);
      const canvas = document.createElement("canvas");
      const scan = async () => {
        if (
          !alive.current ||
          generation !== cameraVersion.current ||
          !stream.current ||
          accepted.current
        )
          return;
        if (
          !reading.current &&
          Date.now() - lastDecode.current >= 150 &&
          video.current &&
          video.current.readyState >= 2
        ) {
          reading.current = true;
          lastDecode.current = Date.now();
          try {
            const scale = Math.min(1, 800 / video.current.videoWidth);
            canvas.width = Math.round(video.current.videoWidth * scale);
            canvas.height = Math.round(video.current.videoHeight * scale);
            canvas
              .getContext("2d")
              ?.drawImage(video.current, 0, 0, canvas.width, canvas.height);
            const result =
              canvas.width && canvas.height ? await decode(canvas) : null;
            if (
              result &&
              alive.current &&
              generation === cameraVersion.current
            ) {
              await accept(result);
              return;
            }
          } catch {
            /* A frame may disappear when closing the camera. */
          } finally {
            reading.current = false;
          }
        }
        frame.current = requestAnimationFrame(() => void scan());
      };
      void scan();
    } catch (e) {
      if (generation !== cameraVersion.current) return;
      stop();
      if (alive.current)
        setError(
          (e as Error).name === "NotAllowedError"
            ? "Разрешите доступ к камере в настройках браузера и повторите сканирование."
            : "Камера недоступна. Закройте другие приложения камеры и повторите сканирование.",
        );
    }
  }
  return (
    <RecordDrawer
      title="Сканировать QR"
      onClose={() => {
        stop();
        onClose();
      }}
    >
      <p>
        Наведите камеру на QR партии или биг-бэга. После распознавания откроется
        доступная вам карточка.
      </p>
      <video
        ref={video}
        muted
        playsInline
        aria-label="Камера QR-сканера"
        className="qr-camera"
        hidden={!camera}
      />
      {!camera && !error && !busy && <p role="status">Включаем камеру…</p>}
      {error && (
        <button className="button" disabled={busy} onClick={() => void start()}>
          Сканировать ещё раз
        </button>
      )}
      {busy && <p role="status">Открываем партию…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </RecordDrawer>
  );
}
