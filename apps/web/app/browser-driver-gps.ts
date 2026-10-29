import { webRequest } from "./session.ts";
import { createCommandId } from "./command-id.mjs";
type Point = {
  id: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracy: number;
};
let watch: number | undefined,
  timer: ReturnType<typeof setInterval> | undefined;
let identity = "",
  trip = "",
  key = "",
  generation = 0,
  sending = false;
let pending: Point[] = [];
let state = {
  running: false,
  tripId: "",
  message: "Геолокация не включена",
  pending: 0,
};
export const gpsState = () => state;
function notify(message: string) {
  state = {
    running: watch !== undefined,
    tripId: trip,
    message,
    pending: pending.length,
  };
  window.dispatchEvent(new Event("collection:gps"));
}
export function browserPosition(): Promise<GeolocationPosition> {
  if (!window.isSecureContext || !navigator.geolocation)
    return Promise.reject(
      Error("Для геолокации откройте Collection по защищённому адресу HTTPS."),
    );
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      resolve,
      (e) =>
        reject(
          Error(
            e.code === 1
              ? "Разрешите точное местоположение в настройках браузера и повторите действие."
              : "Не удалось получить местоположение. Включите GPS, проверьте разрешение и повторите попытку.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 },
    ),
  );
}
function save() {
  localStorage.setItem(key, JSON.stringify(pending));
}
export async function flushBrowserGps(token: string) {
  if (sending || !trip) return;
  sending = true;
  const current = generation;
  try {
    const server = await webRequest<{
      status: string;
      arrivedAt?: string;
      acceptedAt?: string;
    }>(`/tracking/trips/${trip}/state`, token);
    if (current !== generation) return;
    const closed = server.status !== "IN_TRANSIT";
    if (closed) {
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      watch = undefined;
      const cutoff = Date.parse(server.arrivedAt ?? server.acceptedAt ?? "");
      pending = pending.filter(
        (point) =>
          Number.isFinite(cutoff) && Date.parse(point.recordedAt) <= cutoff,
      );
      save();
    }
    if (!pending.length) {
      if (closed) stopBrowserGps();
      return;
    }
    const batch = pending.slice(0, 100);
    await webRequest(`/tracking/trips/${trip}/points`, token, {
      method: "POST",
      body: JSON.stringify({ points: batch }),
    });
    if (current !== generation) return;
    const ids = new Set(batch.map((p) => p.id));
    pending = pending.filter((p) => !ids.has(p.id));
    save();
    if (closed && !pending.length) stopBrowserGps();
    else
      notify(
        `Координаты отправлены · ${new Date().toLocaleTimeString("ru-RU")}`,
      );
  } catch {
    if (current === generation)
      notify(
        "Нет связи с сервером. Точки сохранены на этом телефоне и будут отправлены при восстановлении связи.",
      );
  } finally {
    sending = false;
  }
}
export function stopBrowserGps() {
  generation++;
  if (watch !== undefined) navigator.geolocation.clearWatch(watch);
  clearInterval(timer);
  watch = undefined;
  timer = undefined;
  identity = "";
  trip = "";
  key = "";
  pending = [];
  notify("Передача местоположения остановлена");
}
export function startBrowserGps(
  userId: string,
  tripId: string,
  token: string,
  first: GeolocationPosition,
) {
  if (watch !== undefined && (identity !== userId || trip !== tripId))
    throw Error("Сначала остановите отслеживание другого рейса.");
  if (watch !== undefined) stopBrowserGps();
  identity = userId;
  trip = tripId;
  key = `collection:gps:${userId}:${tripId}`;
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "[]");
    pending = Array.isArray(stored) ? stored.slice(-1000) : [];
  } catch {
    pending = [];
  }
  const current = ++generation;
  let last = 0;
  const sample = (position: GeolocationPosition) => {
    if (current !== generation) return;
    if (position.coords.accuracy > 50) {
      notify(
        "Ожидаем точную геопозицию до 50 м. Включите точное местоположение и GPS.",
      );
      return;
    }
    if (Date.now() - last < 25000 || pending.length >= 1000) return;
    last = Date.now();
    pending.push({
      id: createCommandId(),
      recordedAt: new Date(position.timestamp).toISOString(),
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });
    try {
      save();
      notify("Геолокация включена. Не закрывайте и не сворачивайте браузер.");
      void flushBrowserGps(token);
    } catch {
      notify(
        "Не удалось сохранить точку на телефоне. Проверьте свободное место.",
      );
    }
  };
  watch = navigator.geolocation.watchPosition(
    sample,
    () => notify("Геопозиция недоступна. Проверьте GPS и разрешение браузера."),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 },
  );
  window.removeEventListener("bioflow:expired", stopBrowserGps);
  window.addEventListener("bioflow:expired", stopBrowserGps);
  timer = setInterval(() => void flushBrowserGps(token), 30000);
  notify("Геолокация включена. Не закрывайте и не сворачивайте браузер.");
  sample(first);
}
