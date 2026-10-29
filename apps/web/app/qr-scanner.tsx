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
  const alive = useRef(true),
    reading = useRef(false),
    accepted = useRef(false);
  const [error, setError] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  function stop() {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
    };
  }, []);
  async function accept(value: string) {
    if (!alive.current || accepted.current || !value.trim()) return;
    accepted.current = true;
    stop();
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
    stop();
    setError("");
    setCamera(false);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "Для живого сканера откройте защищённый адрес HTTPS. Можно также сфотографировать QR или выбрать фото ниже.",
      );
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!alive.current) {
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
        if (!alive.current || !stream.current || accepted.current) return;
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
            if (result) {
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
      stop();
      if (alive.current)
        setError(
          (e as Error).name === "NotAllowedError"
            ? "Разрешите доступ к камере в настройках браузера или выберите фото QR."
            : "Камера недоступна. Закройте другие приложения камеры и повторите попытку или выберите фото QR.",
        );
    }
  }
  async function photo(file?: File) {
    if (!file || busy) return;
    stop();
    setCamera(false);
    setBusy(true);
    setError("");
    try {
      if (file.size > 20 * 1024 * 1024)
        throw Error("Выберите фото размером до 20 МБ.");
      const bitmap = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas
          .getContext("2d")
          ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const result = await decode(canvas);
        if (!result)
          throw Error(
            "QR не найден на фото. Снимите код целиком, без бликов, или введите его вручную.",
          );
        await accept(result);
      } finally {
        bitmap.close();
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current && !accepted.current) setBusy(false);
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
      <div className="toolbar">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void start()}
        >
          Включить камеру
        </button>
      </div>
      <label className="button secondary">
        Сфотографировать QR
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={busy}
          onChange={(e) => {
            void photo(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <label>
        Выбрать фото QR
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => {
            void photo(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <form
        data-transient-form
        onSubmit={(e) => {
          e.preventDefault();
          void accept(code);
        }}
      >
        <label>
          QR-код
          <input
            value={code}
            maxLength={512}
            required
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <button className="button secondary" disabled={busy || !code.trim()}>
          Открыть партию
        </button>
      </form>
      {busy && <p role="status">Открываем партию…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </RecordDrawer>
  );
}
