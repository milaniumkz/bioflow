"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import jsQR from "jsqr";
import { RouteCanvas, type Point } from "../trip-map";
import { driverApk } from "../apk-downloads";
import { kgAsTonnes } from "../weight-units";
import {
  readDriver,
  updateDriver,
  type DriverSession,
  type DriverStore,
  type GpsPoint,
  type TripEvent,
} from "./storage";
import "../collection.css";
import "./driver.css";
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function api(path: string, token?: string, body?: unknown) {
  const r = await fetch("/api/v1/collection-driver" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const m = data?.error?.message ?? data?.message;
    throw new ApiError(
      Array.isArray(m)
        ? m.join("; ")
        : (m ?? "Не удалось связаться с сервером"),
      r.status,
    );
  }
  return data;
}
function qrToken(value: string) {
  let token = value.trim();
  try {
    const u = new URL(token);
    token =
      u.searchParams.get("token") ??
      new URLSearchParams(u.hash.slice(1)).get("token") ??
      token;
  } catch {
    /* Plain QR tokens are the standard format. */
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token))
    throw Error(
      "Не удалось прочитать QR Collection. Выберите фото QR или отсканируйте его камерой.",
    );
  return token;
}
function normalizePhone(value: string) {
  let n = value.replace(/\D/g, "");
  if (n.length === 11 && n[0] === "8") n = "7" + n.slice(1);
  if (n.length === 10) n = "7" + n;
  if (!/^[1-9]\d{6,14}$/.test(n))
    throw Error(
      "Укажите номер телефона с кодом страны, например +7 701 123 4567",
    );
  return "+" + n;
}
const stages: Record<string, string> = {
  CREATED: "Рейс подключён",
  LOADED: "Загрузился",
  IN_TRANSIT: "В пути",
  ARRIVED: "Прибыл",
  STOPPED: "Отслеживание остановлено",
};
export default function WebDriver() {
  const [store, setStore] = useState<DriverStore>({
      active: null,
      sessions: {},
    }),
    [ready, setReady] = useState(false),
    [code, setCode] = useState(""),
    [plate, setPlate] = useState(""),
    [phone, setPhone] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [scanning, setScanning] = useState(false),
    [online, setOnline] = useState(true),
    [geoError, setGeoError] = useState(""),
    [geoRetry, setGeoRetry] = useState(0),
    [serverPoints, setServerPoints] = useState<Point[]>([]),
    [showMap, setShowMap] = useState(false);
  const [syncError, setSyncError] = useState("");
  const syncing = useRef(false),
    rerun = useRef(false),
    syncRef = useRef<() => Promise<void>>(async () => {}),
    lastPosition = useRef(0),
    file = useRef<HTMLInputElement>(null);
  const session = store.active ? store.sessions[store.active] : undefined;
  const apply = useCallback(async (change: (s: DriverStore) => void) => {
    const s = await updateDriver(change);
    setStore(s);
    return s;
  }, []);
  const sync = useCallback(async () => {
    if (syncing.current) {
      rerun.current = true;
      return;
    }
    syncing.current = true;
    let syncingToken: string | undefined;
    try {
      let current = await readDriver();
      for (const saved of Object.values(current.sessions)) {
        if (saved.blocked) continue;
        const token = saved.token;
        syncingToken = token;
        for (let count = 0; count < 4; count++) {
          current = await readDriver();
          const points = current.sessions[token]?.points.slice(0, 100) ?? [];
          if (!points.length) break;
          await api("/points", token, { points });
          const ids = new Set(points.map((p) => p.sequence));
          current = await apply((s) => {
            const trip = s.sessions[token];
            const before = trip.points.length;
            trip.points = trip.points.filter((p) => !ids.has(p.sequence));
            trip.sent += before - trip.points.length;
          });
        }
        current = await readDriver();
        if (current.sessions[token]?.points.length) continue;
        for (const event of current.sessions[token]?.events ?? []) {
          await api("/events", token, event);
          await apply((s) => {
            s.sessions[token].events = s.sessions[token].events.filter(
              (e) => e.requestId !== event.requestId,
            );
          });
        }
        current = await readDriver();
        if (current.sessions[token]?.stopRequested) {
          await api("/stop", token, {});
          await apply((s) => {
            s.sessions[token].stopRequested = false;
          });
        }
      }
      setSyncError("");
      setStore(await readDriver());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        const current = await readDriver();
        if (syncingToken && current.sessions[syncingToken])
          await apply((s) => {
            const t = s.sessions[syncingToken!];
            t.tracking = false;
            t.status = "STOPPED";
            t.blocked = true;
          });
        setSyncError(
          "Сеанс рейса завершён или отозван. Неотправленные данные сохранены на телефоне.",
        );
      } else
        setSyncError(
          e instanceof ApiError
            ? e.message
            : "Нет связи. Координаты и отметки сохраняются на этом телефоне и отправятся при подключении.",
        );
    } finally {
      syncing.current = false;
      if (rerun.current) {
        rerun.current = false;
        setTimeout(() => void syncRef.current(), 150);
      }
    }
  }, [apply]);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);
  useEffect(() => {
    let active = true;
    void readDriver()
      .then((s) => {
        if (!active) return;
        setStore(s);
        if (s.draft) {
          setCode(s.draft.qr);
          setPlate(s.draft.plate);
          setPhone(s.draft.phone);
        }
        setReady(true);
      })
      .catch((e) => setError(e.message));
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void syncRef.current();
    };
    setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const timer = setInterval(() => {
      void syncRef.current();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!ready || !session?.tracking) return;
    const token = session.token,
      expires = Date.parse(session.expiresAt),
      offset = session.offset;
    let watch: number | undefined,
      alive = true;
    setGeoError("");
    if (!navigator.geolocation) {
      setGeoError(
        "Геолокация недоступна в этом браузере. Откройте страницу в Chrome или Safari.",
      );
      return;
    }
    watch = navigator.geolocation.watchPosition(
      (position) => {
        if (!alive || Date.now() - lastPosition.current < 10000) return;
        const now = Date.now() + offset;
        if (now > expires) {
          void apply((s) => {
            const t = s.sessions[token];
            t.tracking = false;
            t.status = "STOPPED";
            t.stopRequested = true;
          });
          return;
        }
        const c = position.coords;
        if (
          !Number.isFinite(c.latitude) ||
          !Number.isFinite(c.longitude) ||
          !Number.isFinite(c.accuracy) ||
          c.accuracy > 100000
        ) {
          setGeoError(
            "Нужна более точная геолокация. Разрешите точное местоположение.",
          );
          return;
        }
        lastPosition.current = Date.now();
        void apply((s) => {
          const t = s.sessions[token];
          if (!t?.tracking || s.active !== token) return;
          const point: GpsPoint = {
            sequence: ++t.sequence,
            latitude: c.latitude,
            longitude: c.longitude,
            accuracy: Math.max(0, c.accuracy),
            recordedAt: new Date(now).toISOString(),
          };
          t.points.push(point);
          t.latest = point;
        })
          .then(() => {
            setGeoError("");
            void syncRef.current();
          })
          .catch((e) => setError(e.message));
      },
      (e) =>
        setGeoError(
          e.code === 1
            ? "Разрешите доступ к местоположению в настройках браузера и нажмите «Повторить GPS»."
            : "Нет сигнала GPS. Координаты появятся, когда телефон определит местоположение.",
        ),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => {
      alive = false;
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
    };
  }, [
    ready,
    session?.token,
    session?.tracking,
    session?.expiresAt,
    session?.offset,
    geoRetry,
    apply,
  ]);
  useEffect(() => {
    if (!session || !showMap) return;
    let active = true;
    const token = session.token;
    const load = async () => {
      try {
        let cursor: string | null = null;
        const points: Point[] = [];
        do {
          const page = await api(
            "/route" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
            token,
          );
          points.push(...page.points);
          cursor = page.nextCursor;
        } while (cursor);
        if (active) setServerPoints(points);
      } catch {
        /* Pending positions remain visible without internet. */
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session?.token, showMap]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let active = true;
    const warm = () => {
      if (!active) return;
      const urls = [
        location.pathname,
        ...Array.from(
          document.querySelectorAll<HTMLScriptElement>("script[src]"),
        ).map((s) => new URL(s.src).pathname),
        ...Array.from(
          document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
        ).map((s) => new URL(s.href).pathname),
        ...performance
          .getEntriesByType("resource")
          .map((s) => new URL(s.name).pathname),
        "/collection-icons/icon-192.png",
      ];
      navigator.serviceWorker.controller?.postMessage({
        type: "CACHE_DRIVER_SHELL",
        urls,
      });
    };
    navigator.serviceWorker.addEventListener("controllerchange", warm);
    void Promise.all([
      navigator.serviceWorker
        .register("/collection-sw.js", { scope: "/" })
        .then(() => navigator.serviceWorker.ready),
      import("leaflet"),
    ])
      .then(() => warm())
      .catch(() => {});
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener("controllerchange", warm);
    };
  }, []);
  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const token = qrToken(code),
        contact = normalizePhone(phone),
        number = plate.trim().toUpperCase();
      if (!consent)
        throw Error("Разрешите передачу местоположения во время рейса");
      const existing = await readDriver();
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const clientToken =
        existing.draft?.qr === token
          ? existing.draft.clientToken
          : Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      await apply((s) => {
        s.draft = { qr: token, clientToken, plate: number, phone: contact };
      });
      const result = await api("/claim", undefined, {
        token,
        clientToken,
        plateNumber: number,
        phone: contact,
      });
      await apply((s) => {
        if (!s.sessions[clientToken])
          s.sessions[clientToken] = {
            token: clientToken,
            number: result.waybillNumber,
            destination: result.warehouse,
            plate: result.plateNumber,
            phone: result.phone ?? contact,
            expiresAt: result.expiresAt,
            status: result.status,
            tracking: true,
            sequence: 0,
            sent: 0,
            offset: result.serverTime
              ? Date.parse(result.serverTime) - Date.now()
              : 0,
            points: [],
            events: [],
            weightKg: result.weightKg,
            bagCount: result.bagCount,
          };
        s.active = clientToken;
        delete s.draft;
      });
      setMessage(
        "Рейс подключён. Разрешите браузеру определять точное местоположение.",
      );
      void syncRef.current();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function event(type: TripEvent["type"]) {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const token = session.token;
      await apply((s) => {
        const t = s.sessions[token];
        const expected = {
          LOADED: "CREATED",
          DEPARTED: "LOADED",
          ARRIVED: "IN_TRANSIT",
        }[type];
        if (t.status !== expected)
          throw Error("Этап уже изменился. Обновите страницу.");
        t.events.push({
          requestId: crypto.randomUUID(),
          type,
          recordedAt: new Date(Date.now() + t.offset).toISOString(),
        });
        t.status = type === "DEPARTED" ? "IN_TRANSIT" : type;
        if (type === "ARRIVED") t.tracking = false;
      });
      setMessage("Отметка сохранена на телефоне и передаётся в систему.");
      void syncRef.current();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!session) return;
    await apply((s) => {
      const t = s.sessions[session.token];
      t.tracking = false;
      t.status = "STOPPED";
      t.stopRequested = true;
    });
    setMessage(
      "Геолокация остановлена. Накопленные данные отправятся при подключении.",
    );
    void syncRef.current();
  }
  async function photo(blob: File) {
    setError("");
    try {
      const image = new Image(),
        url = URL.createObjectURL(blob);
      try {
        image.src = url;
        await image.decode();
        const scale = Math.min(
          1,
          1800 / Math.max(image.naturalWidth, image.naturalHeight),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = jsQR(
          ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          canvas.width,
          canvas.height,
          { inversionAttempts: "attemptBoth" },
        );
        if (!result)
          throw Error(
            "QR не найден на фото. Выберите более чёткое изображение QR.",
          );
        setCode(qrToken(result.data));
        setMessage("QR прочитан. Укажите госномер и телефон.");
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const foundQr = useCallback((value: string) => {
    try {
      setCode(qrToken(value));
      setScanning(false);
      setMessage("QR прочитан. Укажите госномер и телефон.");
    } catch (e) {
      setError((e as Error).message);
      setScanning(false);
    }
  }, []);
  const pending = Object.values(store.sessions).reduce(
    (n, s) => n + s.points.length + s.events.length + (s.stopRequested ? 1 : 0),
    0,
  );
  const local = session
    ? [...session.points, ...(session.latest ? [session.latest] : [])]
    : [];
  const merged = new Map<string, Point>();
  for (const p of [
    ...serverPoints,
    ...local.map((p) => ({
      ...p,
      id: "local-" + p.sequence,
      receivedAt: p.recordedAt,
    })),
  ])
    merged.set(`${p.recordedAt}:${p.latitude}:${p.longitude}`, p);
  const route = [...merged.values()].sort(
    (a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt),
  );
  return (
    <main className="collection-app dw-page">
      <div className="dw-wrap">
        <header className="dw-header">
          <div>
            <img
              src="/collection-icons/icon-192.png"
              alt=""
              width={46}
              height={46}
            />
            <span>
              Collection <strong>Driver</strong>
              <small>Веб-версия водителя</small>
            </span>
          </div>
          <b className={online ? "dw-online" : "dw-offline"}>
            {online ? "Онлайн" : "Офлайн"}
          </b>
        </header>
        <div className="dw-browser-note">
          Держите страницу открытой для передачи GPS. При сворачивании или
          блокировке телефона браузер может остановить геолокацию. Для фонового
          режима используйте <a href={driverApk}>APK Driver</a>.
        </div>
        {(error || syncError) && (
          <p role="alert" className="c-error">
            {error || syncError}
          </p>
        )}
        {message && (
          <p role="status" className="dw-message">
            {message}
          </p>
        )}
        {!session ? (
          <section className="dw-card">
            <p className="eyebrow">БЕЗ РЕГИСТРАЦИИ</p>
            <h1>
              Подключитесь
              <br />к своему рейсу.
            </h1>
            <p className="c-muted">
              Отсканируйте QR отправки или выберите его фото.
            </p>
            <div className="dw-scan-buttons">
              <button type="button" onClick={() => setScanning(true)}>
                Сканировать QR
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => file.current?.click()}
              >
                Выбрать фото QR
              </button>
              <input
                ref={file}
                type="file"
                accept="image/*"
                hidden
                aria-label="Фото QR"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void photo(f);
                  e.target.value = "";
                }}
              />
            </div>
            <form onSubmit={connect}>
              <label>
                Код из QR
                <textarea
                  aria-label="Код из QR"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  rows={2}
                  placeholder="Заполнится после сканирования. Можно вставить код."
                />
              </label>
              <label>
                Госномер автомобиля
                <input
                  aria-label="Госномер автомобиля"
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                  required
                  minLength={3}
                  maxLength={20}
                  autoComplete="off"
                  placeholder="123 ABC 01"
                />
              </label>
              <label>
                Номер телефона
                <input
                  aria-label="Номер телефона"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  autoComplete="tel"
                  placeholder="+7 …"
                />
              </label>
              <label className="dw-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  required
                />
                Разрешаю передачу своего местоположения во время этого рейса, до
                24 часов. Отслеживание можно остановить.
              </label>
              <button className="dw-main-button" disabled={busy || !ready}>
                {busy ? "Подключаем…" : "Подключиться к рейсу"}
              </button>
            </form>
          </section>
        ) : (
          <>
            <section className="dw-card">
              <p className="eyebrow">МОЙ РЕЙС</p>
              <h1>{session.number}</h1>
              <p className="dw-destination">→ {session.destination}</p>
              <div className="dw-trip-meta">
                <span>{session.plate}</span>
                <span>{session.phone}</span>
                {session.weightKg && (
                  <span>
                    {kgAsTonnes(session.weightKg)} т · {session.bagCount}{" "}
                    мешков/бигбегов
                  </span>
                )}
              </div>
              <h2 className="dw-stage">
                {stages[session.status] ?? session.status}
              </h2>
              <div className="dw-step-buttons">
                {session.status === "CREATED" && (
                  <button disabled={busy} onClick={() => void event("LOADED")}>
                    Загрузился
                  </button>
                )}
                {session.status === "LOADED" && (
                  <button
                    disabled={busy}
                    onClick={() => void event("DEPARTED")}
                  >
                    Выехал
                  </button>
                )}
                {session.status === "IN_TRANSIT" && (
                  <button disabled={busy} onClick={() => void event("ARRIVED")}>
                    Прибыл
                  </button>
                )}
              </div>
              {session.tracking && (
                <>
                  <p className="dw-gps">
                    {geoError ||
                      (!session.latest
                        ? "Определяем местоположение…"
                        : `GPS: точность ±${Math.round(session.latest.accuracy)} м`)}
                  </p>
                  {geoError && (
                    <button
                      className="secondary"
                      onClick={() => setGeoRetry((n) => n + 1)}
                    >
                      Повторить GPS
                    </button>
                  )}
                  <button
                    className="dw-stop secondary"
                    onClick={() =>
                      void stop().catch((e) => setError(e.message))
                    }
                  >
                    Остановить отслеживание
                  </button>
                </>
              )}
              {["ARRIVED", "STOPPED"].includes(session.status) && (
                <button
                  className="secondary"
                  onClick={() =>
                    void apply((s) => {
                      s.active = null;
                    })
                      .then(() => {
                        setCode("");
                        setConsent(false);
                        setServerPoints([]);
                        setMessage("Отсканируйте QR следующей отправки.");
                      })
                      .catch((e) => setError(e.message))
                  }
                >
                  Новый рейс
                </button>
              )}
            </section>
            <section className="dw-card">
              <div className="dw-sync">
                <span>
                  Передано координат<strong>{session.sent}</strong>
                </span>
                <span>
                  Ожидает отправки<strong>{pending}</strong>
                </span>
              </div>
              <p className="c-muted">
                Без интернета координаты и этапы сохраняются на телефоне. Не
                очищайте данные браузера до их отправки.
              </p>
              <div className="dw-map-buttons">
                <button
                  className="secondary"
                  onClick={() => setShowMap((v) => !v)}
                >
                  {showMap ? "Скрыть карту" : "Маршрут на карте"}
                </button>
                <button
                  className="secondary"
                  onClick={() => void syncRef.current()}
                >
                  Отправить сейчас
                </button>
              </div>
              {showMap &&
                (route.length ? (
                  <RouteCanvas points={route} />
                ) : (
                  <p>
                    Ждём первую координату. Сохранённый маршрут загрузится при
                    подключении.
                  </p>
                ))}
            </section>
          </>
        )}
        <footer className="dw-footer">
          <a href={driverApk}>Скачать Collection Driver APK</a>
          <a href="/collection/help/driver">Видео для водителя</a>
        </footer>
      </div>
      {scanning && <Scanner close={() => setScanning(false)} found={foundQr} />}
    </main>
  );
}
function Scanner({
  close,
  found,
}: {
  close(): void;
  found(value: string): void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      stream: MediaStream | undefined,
      frame = 0,
      last = 0;
    const scan = (now: number) => {
      if (!alive) return;
      if (
        video.current?.readyState &&
        video.current.readyState >= 2 &&
        now - last > 250
      ) {
        last = now;
        const v = video.current,
          c = canvas.current!;
        const scale = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight));
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        if (c.width && c.height) {
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const result = jsQR(
            ctx.getImageData(0, 0, c.width, c.height).data,
            c.width,
            c.height,
            { inversionAttempts: "attemptBoth" },
          );
          if (result) {
            found(result.data);
            return;
          }
        }
      }
      frame = requestAnimationFrame(scan);
    };
    void navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      })
      .then(async (s) => {
        stream = s;
        if (!alive) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current!.srcObject = s;
        await video.current!.play();
        frame = requestAnimationFrame(scan);
      })
      .catch(() =>
        setError(
          "Не удалось открыть камеру. Разрешите доступ к камере или выберите фото QR.",
        ),
      );
    if (!navigator.mediaDevices)
      setError(
        "Камера недоступна. Откройте ссылку в Chrome или Safari либо выберите фото QR.",
      );
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [found]);
  return (
    <div
      className="dw-scanner"
      role="dialog"
      aria-label="Сканирование QR"
      aria-modal="true"
    >
      <div>
        <h2>Наведите камеру на QR</h2>
        <video ref={video} playsInline muted autoPlay />
        <canvas ref={canvas} hidden />
        {error && <p role="alert">{error}</p>}
        <button onClick={close}>Закрыть камеру</button>
      </div>
    </div>
  );
}
