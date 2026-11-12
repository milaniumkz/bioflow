export type GpsPoint = {
  sequence: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  recordedAt: string;
};
export type TripEvent = {
  requestId: string;
  type: "LOADED" | "DEPARTED" | "ARRIVED";
  recordedAt: string;
};
export type DriverSession = {
  token: string;
  number: string;
  destination: string;
  plate: string;
  phone: string;
  expiresAt: string;
  status: string;
  tracking: boolean;
  sequence: number;
  sent: number;
  offset: number;
  points: GpsPoint[];
  events: TripEvent[];
  stopRequested?: boolean;
  blocked?: boolean;
  latest?: GpsPoint;
  weightKg?: string;
  bagCount?: number;
};
export type DriverStore = {
  active: string | null;
  sessions: Record<string, DriverSession>;
  draft?: { qr: string; clientToken: string; plate: string; phone: string };
};
let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("collection-driver-web", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(
        Error(
          "Браузер не разрешает сохранять данные. Откройте обычную вкладку Chrome или Safari.",
        ),
      );
    };
  }));
}
export async function readDriver(): Promise<DriverStore> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readonly");
    const r = tx.objectStore("state").get("driver");
    r.onsuccess = () => resolve(r.result ?? { active: null, sessions: {} });
    r.onerror = () => reject(Error("Не удалось прочитать сохранённый рейс"));
  });
}
/** Read/modify/write occurs in one IndexedDB transaction, including across tabs. */
export async function updateDriver(
  change: (value: DriverStore) => void,
): Promise<DriverStore> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite"),
      store = tx.objectStore("state");
    let value: DriverStore;
    const request = store.get("driver");
    request.onsuccess = () => {
      try {
        value = request.result ?? { active: null, sessions: {} };
        change(value);
        store.put(value, "driver");
      } catch (e) {
        tx.abort();
        reject(e);
      }
    };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(Error("Не удалось сохранить данные на телефоне"));
    tx.onabort = () =>
      reject(Error("Сохранение прервано. Повторите действие."));
  });
}
