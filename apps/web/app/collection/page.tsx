"use client";
import { tonnesToKg, kgAsTonnes, formatTonnes } from "./weight-units";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { webRequest, setSession, clearSession } from "../session";
import { createCommandId } from "../command-id.mjs";
import { mobileNotify, printQr, saveBlob } from "../mobile-bridge";
import "./collection.css";
import { TripMap } from "./trip-map";
import { TutorialPanel } from "./tutorial-panel";
type Row = Record<string, any>;
const labels: Record<string, string> = {
  RAW: "Немытое",
  WASHED: "Мытое",
  FINISHED: "Готовая продукция",
  REJECT: "Некондиция",
  CREATED: "QR создан",
  LOADED: "Загрузился",
  IN_TRANSIT: "В пути",
  ARRIVED: "Прибыл",
  WEIGHT_CORRECTION: "Исправление веса",
  ACCEPTED: "Подтверждено",
  PENDING: "Ожидает подтверждения",
  OWNER: "Владелец",
  ADMIN: "Администратор",
  COLLECTOR: "Сборщик",
  WAREHOUSE_MANAGER: "Ответственный склада",
  FACTORY_MANAGER: "Ответственный завода",
  WASH: "Мойка",
  PRODUCTION: "Производство",
  RAW_RECEIPT: "Приход сырья",
  FACTORY_SHIPMENT: "Отправка на завод",
  FACTORY_RECEIPT: "Приход на завод",
  GP_SHIPMENT: "Отправка ГП",
  OPENING: "Начальные остатки",
  DRIVER_CLAIM: "Водитель подключился",
};
const tonnes = kgAsTonnes;
const weight = kgAsTonnes;
const date = (value: string) => new Date(value).toLocaleString("ru-RU");
const toneToKg = tonnesToKg;
export default function CollectionPage() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Portal />
    </QueryClientProvider>
  );
}
function Portal() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const client = useQueryClient();
  const [token, setToken] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState("");
  const [noticePage, setNoticePage] = useState(1);
  const [focusId, setFocusId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [qr, setQr] = useState<Row | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(new Map<string, string>());
  const scrollHandled = useRef("");
  const call = <T,>(path: string, body?: unknown) =>
    webRequest<T>(
      path,
      token,
      body === undefined
        ? undefined
        : { method: "POST", body: JSON.stringify(body) },
    );
  useEffect(() => {
    pending.current.clear();
  }, [token]);
  useEffect(() => {
    const receive = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (typeof data?.accessToken !== "string") return;
      client.clear();
      setSession(data);
      setToken(data.accessToken);
      if (data.notification) {
        setTab(
          data.notification.collectionSection ??
            data.notification.section ??
            "notifications",
        );
        setFocusId(data.notification.entityId ?? "");
      }
    };
    const expired = () => {
      setToken("");
      client.clear();
    };
    window.addEventListener("bioflow:mobile-login", receive);
    window.addEventListener("bioflow:expired", expired);
    const open = (event: Event) => {
      const target = (event as CustomEvent).detail;
      setTab(target.collectionSection ?? target.section ?? "notifications");
      scrollHandled.current = "";
      setFocusId(target.entityId ?? "");
      void client.invalidateQueries({ queryKey: ["collection-state"] });
    };
    window.addEventListener("collection:open", open);
    const query = new URLSearchParams(window.location.search);
    if (query.get("section")) setTab(query.get("section")!);
    if (query.get("entity")) setFocusId(query.get("entity")!);
    mobileNotify({ action: "ready" });
    return () => {
      window.removeEventListener("collection:open", open);
      window.removeEventListener("bioflow:mobile-login", receive);
      window.removeEventListener("bioflow:expired", expired);
    };
  }, [client]);
  const me = useQuery({
    queryKey: ["collection-me", token],
    queryFn: () => call<Row>("/auth/me"),
    enabled: !!token,
  });
  const state = useQuery({
    queryKey: ["collection-state", token],
    queryFn: () => call<Row>("/collection/state"),
    enabled: !!me.data && !me.data.mustChangePassword,
    refetchInterval: 5000,
  });
  const inbox = useQuery({
    queryKey: ["collection-inbox", token, noticePage],
    queryFn: () => call<Row>(`/notifications?pageSize=100&page=${noticePage}`),
    enabled: !!me.data,
    refetchInterval: 5000,
  });
  const unreadQuery = useQuery({
    queryKey: ["collection-unread", token],
    queryFn: () => call<{ unread: number }>("/notifications/unread-count"),
    enabled: !!me.data,
    refetchInterval: 5000,
  });
  const delivery = useQuery({
    queryKey: ["collection-push", token],
    queryFn: () => call<Row>("/notifications/delivery-status"),
    enabled: !!me.data,
    staleTime: 60000,
  });
  useEffect(() => {
    if (me.data)
      mobileNotify({
        action: "profileReady",
        userId: me.data.id,
        sections: [{ id: "collection", title: "Collection" }],
      });
  }, [me.data]);
  useEffect(() => {
    if (qr && !dialog.current?.open) dialog.current?.showModal();
  }, [qr]);
  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await webRequest<Row>("/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({
          ...(login.includes("@")
            ? { email: login.trim() }
            : { phone: login.trim() }),
          password,
          platform: "web",
        }),
      });
      setSession(data as { accessToken: string; refreshToken: string });
      setToken(data.accessToken);
      setPassword("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(
    path: string,
    body: Row = {},
    success = "Операция сохранена",
  ) {
    const signature = path + JSON.stringify(body);
    let key = pending.current.get(signature);
    if (!key) {
      key = createCommandId();
      pending.current.set(signature, key);
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await call<Row>(path, { ...body, idempotencyKey: key });
      pending.current.delete(signature);
      if (result.qrImage) setQr(result);
      await client.invalidateQueries({ queryKey: ["collection-state", token] });
      await client.invalidateQueries({ queryKey: ["collection-inbox", token] });
      setMessage(success);
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function showQr(id: string) {
    setError("");
    try {
      setQr(await call<Row>(`/collection/trips/${id}/qr`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function shareQr() {
    if (!qr) return;
    try {
      if (
        mobileNotify({
          action: "shareQr",
          image: qr.qrImage,
          filename: `${qr.number}.png`,
        })
      )
        return;
      const blob = await (await fetch(qr.qrImage)).blob();
      const file = new File([blob], `${qr.number}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] }))
        await navigator.share({ title: qr.number, files: [file] });
      else await saveBlob(blob, `${qr.number}.png`);
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setError("Не удалось отправить QR. Попробуйте сохранить PNG.");
    }
  }
  const profile = me.data;
  const roles: string[] = profile?.roles ?? [];
  const owner = roles.some((role) => ["OWNER", "ADMIN"].includes(role));
  const collector = roles.includes("COLLECTOR");
  const warehouse = roles.includes("WAREHOUSE_MANAGER");
  const factory = roles.includes("FACTORY_MANAGER");
  const tabs = [
    ...(owner
      ? [
          ["overview", "Обзор"],
          ["trips", "Перевозки"],
          ["stock", "Склады и заводы"],
          ["people", "Люди"],
          ["shipments", "Отправки на завод"],
          ["production", "Производство"],
          ["gp", "Доставка ГП"],
          ["journal", "Движение"],
        ]
      : []),
    ...(!owner && collector ? [["trips", "Мои отправки"]] : []),
    ...(!owner && warehouse
      ? [
          ["inbound", "Приход сырья"],
          ["stock", "Остатки и мойка"],
          ["shipments", "На завод"],
        ]
      : []),
    ...(!owner && factory
      ? [
          ["factory-inbound", "Приход на завод"],
          ["stock", "Остатки"],
          ["production", "Производство"],
          ["gp", "Доставка ГП"],
        ]
      : []),
    ["notifications", "Уведомления"],
    ["help", "Видеоинструкции"],
  ];
  const targetTab =
    tab === "inbound" && (owner || collector)
      ? "trips"
      : tab === "factory-inbound" && (owner || warehouse)
        ? "shipments"
        : tab;
  const selected = tabs.some(([id]) => id === targetTab)
    ? targetTab
    : tabs[0][0];
  const data = state.data ?? {};
  const locations: Row[] = data.locations ?? [];
  const trips: Row[] = data.trips ?? [];
  const shipments: Row[] = data.shipments ?? [];
  const batches: Row[] = data.batches ?? [];
  const stock: Row[] = data.stock ?? [];
  const users: Row[] = data.users ?? [];
  const assigned: string[] = data.assignedLocationIds ?? [];
  const editable = (kind: string) =>
    locations.filter(
      (location) =>
        location.kind === kind && (owner || assigned.includes(location.id)),
    );
  const names = Object.fromEntries(
    locations.map((location) => [location.id, location.name]),
  );
  const usernames = Object.fromEntries(
    users.map((user) => [user.id, user.fullName]),
  );
  useEffect(() => {
    if (
      !focusId ||
      !state.data ||
      scrollHandled.current === `${selected}:${focusId}`
    )
      return;
    const timer = window.setTimeout(() => {
      const card = document.getElementById(`c-item-${focusId}`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.focus({ preventScroll: true });
      if (card) scrollHandled.current = `${selected}:${focusId}`;
    }, 100);
    return () => clearTimeout(timer);
  }, [focusId, selected, state.dataUpdatedAt]);
  const unread = unreadQuery.data?.unread ?? 0;
  const total = (kind: string) =>
    stock
      .filter((row) => row.state === kind)
      .reduce((sum, row) => sum + Number(row._sum.remainingKg ?? 0), 0);
  const totalBag = (kind: string) =>
    batches
      .filter((row) => row.state === kind)
      .reduce(
        (sum, row) =>
          sum +
          (row.bags ?? []).filter((bag: Row) => bag.status === "AVAILABLE")
            .length,
        0,
      );
  if (!token)
    return (
      <main className="collection-login">
        <div className="collection-wordmark">
          collection<span>операционный учёт</span>
        </div>
        <form onSubmit={authenticate}>
          <p className="eyebrow">РАБОЧИЙ КОНТУР</p>
          <h1>
            Всё движение.
            <br />В одном месте.
          </h1>
          <p>
            Сбор, склады, производство и доставка — с подтверждением каждого
            этапа.
          </p>
          <label>
            Телефон или email
            <input
              autoComplete="username"
              disabled={!hydrated}
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              required
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              disabled={!hydrated}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button disabled={busy || !hydrated}>
            {busy ? "Входим…" : "Войти в Collection →"}
          </button>
          {error ? (
            <p role="alert" className="c-error">
              {error}
            </p>
          ) : null}
          <small>
            Для водителя — отдельное приложение Collection Driver. Здесь входят
            сборщики, ответственные складов, заводы и владелец.
          </small>
          <div className="c-downloads">
            <a href="/downloads/Collection.apk">
              Скачать Collection для Android
            </a>
            <a href="/downloads/Collection-Driver.apk">
              Скачать Collection Driver
            </a>
          </div>
        </form>
      </main>
    );
  if (me.isPending)
    return (
      <main className="collection-login">
        <p role="status">Загрузка кабинета…</p>
      </main>
    );
  if (me.isError)
    return (
      <main className="collection-login">
        <p role="alert">{me.error.message}</p>
        <button
          onClick={() => {
            clearSession();
            setToken("");
          }}
        >
          Вернуться ко входу
        </button>
      </main>
    );
  if (profile?.mustChangePassword)
    return (
      <PasswordChange
        token={token}
        onDone={() => {
          clearSession();
          setToken("");
        }}
      />
    );
  return (
    <div className="collection-app">
      <aside className="c-sidebar">
        <div className="collection-wordmark">
          collection<span>рабочий контур</span>
        </div>
        <nav>
          {tabs.map(([id, title]) => (
            <button
              key={id}
              className={selected === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setError("");
                setMessage("");
              }}
            >
              <span>{title}</span>
              {id === "notifications" && unread ? <b>{unread}</b> : null}
            </button>
          ))}
        </nav>
        <div className="c-account">
          <strong>{profile?.fullName}</strong>
          <small>{roles.map((role) => labels[role] ?? role).join(" · ")}</small>
          <button
            onClick={async () => {
              await call("/auth/logout-all", {}).catch(() => {});
              clearSession();
              client.clear();
              setToken("");
              mobileNotify({ action: "signedOut" });
            }}
          >
            Выйти ↗
          </button>
        </div>
      </aside>
      <main className="c-main">
        <header className="c-top">
          <div>
            <p className="eyebrow">
              COLLECTION / {owner ? "ВСЯ СЕТЬ" : "МОЙ КАБИНЕТ"}
            </p>
            <h1>{tabs.find(([id]) => id === selected)?.[1]}</h1>
          </div>
          <div className="c-live">
            <i />{" "}
            {state.isFetching
              ? "Обновляем…"
              : state.isError
                ? "Нет связи"
                : "Данные обновляются"}
            <small>каждые 5 секунд</small>
          </div>
        </header>
        {error || state.isError ? (
          <div role="alert" className="c-error">
            {error || state.error?.message}
          </div>
        ) : null}
        {message ? (
          <div role="status" className="c-success">
            {message}
          </div>
        ) : null}
        {state.isPending ? <p role="status">Загрузка данных…</p> : null}
        {!owner && (warehouse || factory) && !assigned.length ? (
          <div className="c-note">
            Вам ещё не назначен склад или завод. После назначения объекта здесь
            появятся его операции.
          </div>
        ) : null}
        {selected === "overview" || selected === "stock" ? (
          <>
            <div className="c-stats">
              {[
                ["RAW", "Немытое сырьё"],
                ["WASHED", "Мытое сырьё"],
                ["FINISHED", "Готовая продукция"],
                ["REJECT", "Некондиция"],
              ].map(([kind, title]) => (
                <article key={kind}>
                  <span>{title}</span>
                  <strong>
                    {tonnes(total(kind))}
                    <small> т</small>
                  </strong>
                  <p>
                    {kind === "FINISHED" || kind === "REJECT"
                      ? `${totalBag(kind)} доступных бигбегов`
                      : "Подтверждённый остаток"}
                  </p>
                </article>
              ))}
            </div>
            <section className="c-section">
              <div className="c-heading">
                <h2>{owner ? "Все объекты" : "Мои объекты"}</h2>
                <span>Приход попадает в остатки после подтверждения</span>
              </div>
              <div className="c-location-grid">
                {locations
                  .filter((location) => owner || assigned.includes(location.id))
                  .map((location) => (
                    <article
                      className="c-card"
                      key={location.id}
                      id={`c-item-${location.id}`}
                      tabIndex={-1}
                    >
                      <div className="c-heading">
                        <h3>{location.name}</h3>
                        <span className="c-tag">
                          {location.kind === "WAREHOUSE" ? "Склад" : "Завод"}
                        </span>
                      </div>
                      {["RAW", "WASHED", "FINISHED", "REJECT"]
                        .filter((kind) =>
                          location.kind === "WAREHOUSE"
                            ? ["RAW", "WASHED"].includes(kind)
                            : kind !== "RAW",
                        )
                        .map((kind) => (
                          <div className="c-stock-line" key={kind}>
                            <span>{labels[kind]}</span>
                            <strong>
                              {tonnes(
                                stock.find(
                                  (row) =>
                                    row.locationId === location.id &&
                                    row.state === kind,
                                )?._sum.remainingKg,
                              )}{" "}
                              т
                            </strong>
                          </div>
                        ))}
                      {location.kind === "WAREHOUSE" && (owner || warehouse) ? (
                        <WashForm
                          location={location}
                          busy={busy}
                          onSubmit={(value) => {
                            try {
                              void submit(
                                "/collection/wash",
                                {
                                  locationId: location.id,
                                  weightKg: toneToKg(value),
                                },
                                "Немытое сырьё переведено в мытое",
                              );
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        />
                      ) : null}
                    </article>
                  ))}
              </div>
            </section>
            {owner ? (
              <section className="c-section">
                <h2>В движении сейчас</h2>
                <div className="c-stats">
                  <article>
                    <span>Рейсы в пути</span>
                    <strong>
                      {
                        trips.filter((trip) => trip.status === "IN_TRANSIT")
                          .length
                      }
                    </strong>
                  </article>
                  <article>
                    <span>Ожидает приёмки склада</span>
                    <strong>
                      {
                        trips.filter(
                          (trip) =>
                            trip.kind === "RAW" && trip.status === "ARRIVED",
                        ).length
                      }
                    </strong>
                  </article>
                  <article>
                    <span>Мытое на пути к заводу</span>
                    <strong>
                      {tonnes(
                        shipments
                          .filter(
                            (shipment) => shipment.status === "IN_TRANSIT",
                          )
                          .reduce(
                            (sum, shipment) => sum + Number(shipment.weightKg),
                            0,
                          ),
                      )}
                      <small> т</small>
                    </strong>
                  </article>
                  <article>
                    <span>Всего отправлено сборщиками</span>
                    <strong>
                      {tonnes(
                        trips
                          .filter((trip) => trip.kind === "RAW")
                          .reduce(
                            (sum, trip) => sum + Number(trip.weightKg),
                            0,
                          ),
                      )}
                      <small> т</small>
                    </strong>
                  </article>
                </div>
                <FactoryForm
                  busy={busy}
                  onSubmit={(name) =>
                    void submit(
                      "/collection/factories",
                      { name },
                      "Завод добавлен в список",
                    )
                  }
                />
              </section>
            ) : null}
          </>
        ) : null}
        {selected === "trips" ? (
          <>
            <div className="c-columns">
              {collector || owner ? (
                <TripForm
                  locations={locations.filter(
                    (location) => location.kind === "WAREHOUSE",
                  )}
                  busy={busy}
                  onSubmit={(values) =>
                    void submit(
                      "/collection/trips",
                      values,
                      "Отправка создана — QR готов",
                    )
                  }
                />
              ) : null}
              <div className="c-note">
                <h3>Один QR на весь рейс</h3>
                <p>
                  Водитель сам вводит госномер и телефон, отмечает загрузку,
                  выезд и прибытие. Его позиция обновляется в поездке.
                </p>
                <p>
                  Сохраните QR как фото, отправьте водителю или распечатайте.
                </p>
              </div>
            </div>
            <TripList
              token={token}
              trips={trips}
              names={names}
              usernames={usernames}
              busy={busy}
              canQr={(trip) => owner || trip.createdById === profile?.id}
              onQr={showQr}
            />
          </>
        ) : null}
        {selected === "inbound" ? (
          <TripList
            token={token}
            trips={trips.filter((trip) => trip.kind === "RAW")}
            names={names}
            usernames={usernames}
            busy={busy}
            onConfirm={(id) =>
              void submit(
                `/collection/trips/${id}/confirm`,
                {},
                "Приход подтверждён. Сырьё добавлено в немытое",
              )
            }
          />
        ) : null}
        {selected === "shipments" || selected === "factory-inbound" ? (
          <>
            <div className="c-columns">
              {selected === "shipments" ? (
                <ShipmentForm
                  locations={editable("WAREHOUSE")}
                  factories={locations.filter(
                    (location) => location.kind === "FACTORY",
                  )}
                  busy={busy}
                  onSubmit={(values) =>
                    void submit(
                      "/collection/shipments",
                      values,
                      "Мытое сырьё отправлено на завод",
                    )
                  }
                />
              ) : (
                <div className="c-note">
                  <h3>Подтвердите фактическое получение</h3>
                  <p>
                    После подтверждения мытое сырьё станет доступно для
                    производства.
                  </p>
                </div>
              )}
            </div>
            <div className="c-list">
              {shipments.map((shipment) => (
                <article
                  className="c-card"
                  key={shipment.id}
                  id={`c-item-${shipment.id}`}
                  tabIndex={-1}
                >
                  <div className="c-heading">
                    <h3>
                      {names[shipment.fromLocationId] ?? "Склад"} →{" "}
                      {names[shipment.toLocationId] ?? "Завод"}
                    </h3>
                    <span className="c-tag">{labels[shipment.status]}</span>
                  </div>
                  <p>{shipment.number}</p>
                  <div className="c-details">
                    <span>
                      <b>{shipment.bagCount}</b> бигбегов
                    </span>
                    <span>
                      <b>{tonnes(shipment.weightKg)}</b> т всего
                    </span>
                    <span>
                      <b>{weight(shipment.averageBagKg)}</b> т в среднем
                    </span>
                  </div>
                  {(selected === "factory-inbound" || owner) &&
                  shipment.status === "IN_TRANSIT" ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void submit(
                          `/collection/shipments/${shipment.id}/confirm`,
                          {},
                          "Приход на завод подтверждён",
                        )
                      }
                    >
                      Подтвердить приход
                    </button>
                  ) : null}
                </article>
              ))}
              {!shipments.length ? (
                <Empty>Отправок на завод пока нет.</Empty>
              ) : null}
            </div>
          </>
        ) : null}
        {selected === "production" ? (
          <>
            <ProductionForm
              locations={editable("FACTORY")}
              busy={busy}
              onSubmit={(values) =>
                void submit(
                  "/collection/production",
                  values,
                  "ГП и некондиция созданы; сырьё списано по весу",
                )
              }
            />
            <section className="c-section">
              <h2>Выпущенные партии</h2>
              <BatchList
                batches={batches.filter((batch) =>
                  ["FINISHED", "REJECT"].includes(batch.state),
                )}
                names={names}
              />
            </section>
          </>
        ) : null}
        {selected === "gp" ? (
          <>
            <GpForm
              locations={editable("FACTORY")}
              batches={batches}
              busy={busy}
              onSubmit={(values) =>
                void submit(
                  "/collection/gp-trips",
                  values,
                  "Доставка ГП создана — QR готов",
                )
              }
            />
            <TripList
              token={token}
              trips={trips.filter((trip) => trip.kind === "GP")}
              names={names}
              usernames={usernames}
              busy={busy}
              canQr={(trip) => owner || trip.createdById === profile?.id}
              onQr={showQr}
            />
          </>
        ) : null}
        {selected === "people" ? (
          <>
            <section className="c-section">
              <h2>Сборщики</h2>
              <div className="c-location-grid">
                {users
                  .filter((user) =>
                    user.userRoles.some(
                      (entry: Row) => entry.role.code === "COLLECTOR",
                    ),
                  )
                  .map((user) => (
                    <article className="c-card" key={user.id}>
                      <h3>{user.fullName}</h3>
                      <p>{user.phone ?? "Телефон не указан"}</p>
                      <strong>
                        {
                          trips.filter((trip) => trip.createdById === user.id)
                            .length
                        }{" "}
                        отправок ·{" "}
                        {tonnes(
                          trips
                            .filter((trip) => trip.createdById === user.id)
                            .reduce(
                              (sum, trip) => sum + Number(trip.weightKg),
                              0,
                            ),
                        )}{" "}
                        т
                      </strong>
                    </article>
                  ))}
              </div>
            </section>
            <section className="c-section">
              <h2>Водители и доставки</h2>
              <TripList
                token={token}
                trips={trips.filter((trip) => trip.driver)}
                names={names}
                usernames={usernames}
                busy={busy}
              />
            </section>
          </>
        ) : null}
        {selected === "journal" ? (
          <>
            <div className="c-table">
              <table>
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Объект</th>
                    <th>Операция</th>
                    <th>Вес</th>
                    <th>Ответственный</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.actions ?? []).map((action: Row) => (
                    <tr key={action.id}>
                      <td>{date(action.createdAt)}</td>
                      <td>{names[action.locationId]}</td>
                      <td>{labels[action.kind] ?? action.kind}</td>
                      <td>{tonnes(action.quantityKg)} т</td>
                      <td>{usernames[action.createdById] ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="c-muted">
              Последние 200 операций. Остатки рассчитываются по всем
              подтверждённым партиям.
            </p>
            <BatchList batches={batches} names={names} />
          </>
        ) : null}
        {selected === "help" ? (
          <TutorialPanel token={token} roles={roles} />
        ) : null}
        {selected === "notifications" ? (
          <>
            <div className="c-note">
              {delivery.data?.pushProviderConfigured
                ? "Firebase подключён к серверу. Для уведомлений на телефоне разрешите их в приложении."
                : "Push на телефон пока не подключён. Уведомления ниже обновляются автоматически."}
            </div>
            <div className="c-list">
              {(inbox.data?.data ?? []).map((notice: Row) => (
                <article className="c-card" key={notice.id}>
                  <div className="c-heading">
                    <h3>{notice.title}</h3>
                    <span className="c-tag">
                      {notice.readAt ? "Прочитано" : "Новое"}
                    </span>
                  </div>
                  <p>{notice.body}</p>
                  {notice.action ? (
                    <button
                      onClick={() => {
                        scrollHandled.current = "";
                        setTab(notice.action.section);
                        setFocusId(notice.action.entityId);
                        void client.invalidateQueries({
                          queryKey: ["collection-state", token],
                        });
                      }}
                    >
                      Открыть{" "}
                      {notice.type.includes("ARRIVED") ||
                      notice.type.includes("SHIPMENT")
                        ? "приход / отправку"
                        : "операцию"}{" "}
                      →
                    </button>
                  ) : null}
                  <small>{date(notice.createdAt)}</small>
                  {!notice.readAt ? (
                    <button
                      className="secondary"
                      onClick={async () => {
                        try {
                          await call(`/notifications/${notice.id}/read`, {});
                          await client.invalidateQueries({
                            queryKey: ["collection-inbox", token],
                          });
                          await client.invalidateQueries({
                            queryKey: ["collection-unread", token],
                          });
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Прочитано
                    </button>
                  ) : null}
                </article>
              ))}
              {!inbox.data?.data?.length ? (
                <Empty>Новых событий пока нет.</Empty>
              ) : null}
              <div className="c-actions">
                <button
                  className="secondary"
                  disabled={noticePage === 1}
                  onClick={() => setNoticePage((page) => page - 1)}
                >
                  Назад
                </button>
                <span>
                  Страница {noticePage} · всего {inbox.data?.total ?? 0}
                </span>
                <button
                  className="secondary"
                  disabled={noticePage * 100 >= (inbox.data?.total ?? 0)}
                  onClick={() => setNoticePage((page) => page + 1)}
                >
                  Далее
                </button>
              </div>
            </div>
          </>
        ) : null}
        {qr ? (
          <dialog
            ref={dialog}
            className="c-qr-dialog"
            onCancel={() => setQr(null)}
          >
            <div className="c-qr-sheet">
              <p className="eyebrow">COLLECTION · ОТПРАВКА</p>
              <h2>{qr.number}</h2>
              <p>{qr.warehouse}</p>
              <img
                src={qr.qrImage}
                width={360}
                height={360}
                alt={`QR перевозки ${qr.number}`}
              />
              <p>
                <b>{qr.bagCount}</b> мешков / бигбегов ·{" "}
                <b>{weight(qr.weightKg)}</b> т
              </p>
              <small>Сканируйте в приложении Collection Driver</small>
            </div>
            <div className="c-qr-actions">
              <button onClick={() => void shareQr()}>Отправить как фото</button>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await saveBlob(
                      await (await fetch(qr.qrImage)).blob(),
                      `${qr.number}.png`,
                    );
                  } catch {
                    setError("Не удалось сохранить QR");
                  }
                }}
              >
                Сохранить PNG
              </button>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(qr.qrToken);
                    setMessage("Код QR скопирован");
                  } catch {
                    setError("Не удалось скопировать код QR");
                  }
                }}
              >
                Скопировать код QR
              </button>
              <button className="secondary" onClick={() => printQr(qr.qrImage)}>
                Распечатать
              </button>
              <button
                className="secondary"
                onClick={() => {
                  dialog.current?.close();
                  setQr(null);
                }}
              >
                Закрыть
              </button>
            </div>
          </dialog>
        ) : null}
      </main>
    </div>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="c-empty">{children}</div>;
}
function Select({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: Row[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Выберите…</option>
        {items.map((item) => (
          <option value={item.id} key={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}
function TripForm({
  locations,
  busy,
  onSubmit,
}: {
  locations: Row[];
  busy: boolean;
  onSubmit: (values: Row) => void;
}) {
  const [warehouseId, setWarehouse] = useState("");
  const [bags, setBags] = useState("");
  const [total, setTotal] = useState("");
  return (
    <form
      className="c-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          warehouseId,
          bagCount: Number(bags),
          weightKg: tonnesToKg(total),
        });
      }}
    >
      <p className="eyebrow">СБОРЩИК</p>
      <h2>Новая отправка</h2>
      <Select
        label="На какой склад"
        items={locations}
        value={warehouseId}
        onChange={setWarehouse}
      />
      <label>
        Количество мешков
        <input
          type="number"
          min="1"
          max="100000"
          step="1"
          required
          value={bags}
          onChange={(event) => setBags(event.target.value)}
        />
      </label>
      <label>
        Общий вес всех мешков, тонн
        <input
          type="number"
          min="0.000001"
          step="0.000001"
          required
          value={total}
          onChange={(event) => setTotal(event.target.value)}
        />
      </label>
      <p className="c-note">Вес указывается в тоннах: 20 означает 20 тонн.</p>
      <button disabled={busy}>
        {busy ? "Создаём…" : "Создать отправку и QR"}
      </button>
    </form>
  );
}
function WashForm({
  location,
  busy,
  onSubmit,
}: {
  location: Row;
  busy: boolean;
  onSubmit: (value: string) => void;
}) {
  const [amount, setAmount] = useState("");
  return (
    <form
      className="c-wash"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(amount);
      }}
    >
      <label>
        Создать мытое, тонн
        <input
          aria-label={`Создать мытое на ${location.name}, тонн`}
          type="number"
          min="0.000001"
          step="0.000001"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <button disabled={busy} className="secondary">
        Перевести в мытое
      </button>
    </form>
  );
}
function FactoryForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="c-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(name);
      }}
    >
      <h3>Добавить завод</h3>
      <label>
        Название завода
        <input
          required
          minLength={2}
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button disabled={busy}>Добавить завод</button>
    </form>
  );
}
function ShipmentForm({
  locations,
  factories,
  busy,
  onSubmit,
}: {
  locations: Row[];
  factories: Row[];
  busy: boolean;
  onSubmit: (values: Row) => void;
}) {
  const [locationId, setLocation] = useState("");
  const [factoryId, setFactory] = useState("");
  const [bags, setBags] = useState("");
  const [total, setTotal] = useState("");
  return (
    <form
      className="c-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          locationId,
          factoryId,
          bagCount: Number(bags),
          weightKg: tonnesToKg(total),
        });
      }}
    >
      <h2>Отправить мытое на завод</h2>
      <Select
        label="Со склада"
        items={locations}
        value={locationId}
        onChange={setLocation}
      />
      <Select
        label="На завод"
        items={factories}
        value={factoryId}
        onChange={setFactory}
      />
      {!factories.length ? (
        <p>Владелец должен добавить завод в список.</p>
      ) : null}
      <label>
        Количество бигбегов
        <input
          type="number"
          min="1"
          max="100000"
          step="1"
          required
          value={bags}
          onChange={(event) => setBags(event.target.value)}
        />
      </label>
      <label>
        Общий вес, тонн
        <input
          type="number"
          min="0.000001"
          step="0.000001"
          required
          value={total}
          onChange={(event) => setTotal(event.target.value)}
        />
      </label>
      <div className="c-note">
        Средний вес одного бигбега:{" "}
        <b>
          {Number(bags) > 0 ? formatTonnes(Number(total) / Number(bags)) : "—"}{" "}
          т
        </b>
      </div>
      <button disabled={busy || !factories.length}>Отправить на завод</button>
    </form>
  );
}
function BagInputs({
  title,
  values,
  onChange,
  presets = false,
}: {
  title: string;
  values: string[];
  onChange: (values: string[]) => void;
  presets?: boolean;
}) {
  const [count, setCount] = useState(String(values.length));
  return (
    <fieldset>
      <legend>{title}</legend>
      <label>
        Количество бигбегов
        <input
          type="number"
          min="0"
          max="1000"
          step="1"
          required
          value={count}
          onFocus={(event) => event.target.select()}
          onChange={(event) => {
            const raw = event.target.value;
            setCount(raw);
            if (raw === "") return;
            const number = Number(raw);
            if (!Number.isInteger(number) || number < 0 || number > 1000)
              return;
            onChange(
              Array.from(
                { length: number },
                (_, index) => values[index] ?? (presets ? "0.8" : ""),
              ),
            );
          }}
        />
      </label>
      <div className="c-bag-inputs">
        {values.map((value, index) => (
          <label key={index}>
            Бигбег {index + 1}
            {presets ? ", вес" : ", тонн"}
            {presets ? (
              <select
                aria-label={`Бигбег ${index + 1}, вес`}
                required
                value={value || "0.8"}
                onChange={(event) =>
                  onChange(
                    values.map((entry, i) =>
                      i === index ? event.target.value : entry,
                    ),
                  )
                }
              >
                <option value="0.8">0,8 т — 800 кг</option>
                <option value="0.825">0,825 т — 825 кг</option>
              </select>
            ) : (
              <input
                type="number"
                min="0.000001"
                step="0.000001"
                required
                value={value}
                onChange={(event) =>
                  onChange(
                    values.map((entry, i) =>
                      i === index ? event.target.value : entry,
                    ),
                  )
                }
              />
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function ProductionForm({
  locations,
  busy,
  onSubmit,
}: {
  locations: Row[];
  busy: boolean;
  onSubmit: (values: Row) => void;
}) {
  const [locationId, setLocation] = useState("");
  const [finished, setFinished] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const total = [...finished, ...rejected].reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  return (
    <form
      className="c-form c-wide"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          locationId,
          finished: finished.map((value) => ({ weightKg: tonnesToKg(value) })),
          rejected: rejected.map((value) => ({ weightKg: tonnesToKg(value) })),
        });
      }}
    >
      <h2>Создать ГП и некондицию</h2>
      <Select
        label="Завод"
        items={locations}
        value={locationId}
        onChange={setLocation}
      />
      <div className="c-columns">
        <BagInputs
          title="Готовая продукция"
          presets
          values={finished}
          onChange={setFinished}
        />
        <BagInputs
          title="Некондиция"
          values={rejected}
          onChange={setRejected}
        />
      </div>
      <p>
        Из мытого сырья будет списано: <b>{formatTonnes(total)} т</b>. Вес
        выпуска и некондиции должен укладываться в доступное сырьё.
      </p>
      <button disabled={busy || total <= 0}>Подтвердить выпуск</button>
    </form>
  );
}
function GpForm({
  locations,
  batches,
  busy,
  onSubmit,
}: {
  locations: Row[];
  batches: Row[];
  busy: boolean;
  onSubmit: (values: Row) => void;
}) {
  const [locationId, setLocation] = useState("");
  const [recipientName, setName] = useState("");
  const [recipientAddress, setAddress] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const bags = batches
    .filter(
      (batch) => batch.state === "FINISHED" && batch.locationId === locationId,
    )
    .flatMap((batch) =>
      (batch.bags ?? [])
        .filter((bag: Row) => bag.status === "AVAILABLE")
        .map((bag: Row) => ({ ...bag, batchId: batch.id })),
    );
  const chosen = bags.filter((bag: Row) => selected.includes(bag.id));
  return (
    <form
      className="c-form c-wide"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          locationId,
          recipientName,
          recipientAddress,
          bagIds: chosen.map((bag: Row) => bag.id),
        });
      }}
    >
      <h2>Доставка готовой продукции</h2>
      <Select
        label="С завода"
        items={locations}
        value={locationId}
        onChange={(value) => {
          setLocation(value);
          setSelected([]);
        }}
      />
      <div className="c-columns">
        <label>
          Получатель
          <input
            required
            minLength={2}
            maxLength={120}
            value={recipientName}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Адрес доставки
          <input
            required
            minLength={3}
            maxLength={300}
            value={recipientAddress}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
      </div>
      <fieldset>
        <legend>Выберите бигбеги ГП</legend>
        <div className="c-bag-inputs">
          {bags.map((bag: Row) => (
            <label key={bag.id} className="c-check">
              <input
                type="checkbox"
                checked={selected.includes(bag.id)}
                onChange={(event) =>
                  setSelected((previous) =>
                    event.target.checked
                      ? [...previous, bag.id]
                      : previous.filter((id) => id !== bag.id),
                  )
                }
              />
              Бигбег {bag.index} · {weight(bag.weightKg)} т
            </label>
          ))}
        </div>
        {!bags.length ? (
          <p>На этом заводе пока нет доступных бигбегов ГП.</p>
        ) : null}
      </fieldset>
      <p>
        Выбрано: <b>{chosen.length}</b> бигбегов ·{" "}
        <b>
          {weight(
            chosen.reduce(
              (sum: number, bag: Row) => sum + Number(bag.weightKg),
              0,
            ),
          )}{" "}
          т
        </b>
      </p>
      <button disabled={busy || !chosen.length}>
        Создать доставку ГП и QR
      </button>
    </form>
  );
}
function TripList({
  token,
  trips,
  names,
  usernames,
  busy,
  canQr,
  onQr,
  onConfirm,
}: {
  token: string;
  trips: Row[];
  names: Row;
  usernames: Row;
  busy: boolean;
  canQr?: (trip: Row) => boolean;
  onQr?: (id: string) => void;
  onConfirm?: (id: string) => void;
}) {
  return (
    <section className="c-section">
      <div className="c-list">
        {trips.map((trip) => (
          <article
            className="c-card"
            key={trip.id}
            id={`c-item-${trip.id}`}
            tabIndex={-1}
          >
            <div className="c-heading">
              <div>
                <p className="eyebrow">
                  {trip.kind === "GP" ? "ДОСТАВКА ГП" : "СЫРЬЁ"} · {trip.number}
                </p>
                <h3>
                  {trip.kind === "GP"
                    ? `${names[trip.fromLocationId] ?? "Завод"} → ${trip.recipientName}`
                    : (names[trip.warehouseId] ?? "Склад")}
                </h3>
              </div>
              <span
                className={`c-tag ${trip.status === "ACCEPTED" ? "done" : ""}`}
              >
                {trip.kind === "GP" && trip.status === "ARRIVED"
                  ? "Доставлено"
                  : labels[trip.status]}
              </span>
            </div>
            {trip.recipientAddress ? <p>{trip.recipientAddress}</p> : null}
            <div className="c-details">
              <span>
                <b>{trip.bagCount}</b>{" "}
                {trip.kind === "GP" ? "бигбегов" : "мешков"}
              </span>
              <span>
                <b>{tonnes(trip.weightKg)}</b> т
              </span>
              <span>{usernames[trip.createdById] ?? "Сборщик"}</span>
              <span>{date(trip.createdAt)}</span>
            </div>
            <div className="c-progress">
              {[
                ["loadedAt", "Загрузился"],
                ["departedAt", "Выехал"],
                ["arrivedAt", "Прибыл"],
              ].map(([key, title]) => (
                <span className={trip[key] ? "complete" : ""} key={key}>
                  <i />
                  {title}
                  {trip[key] ? <small>{date(trip[key])}</small> : null}
                </span>
              ))}
            </div>
            {trip.driver ? (
              <div className="c-driver">
                <strong>{trip.driver.driverPlate}</strong>
                <a href={`tel:${trip.driver.driverPhone}`}>
                  {trip.driver.driverPhone}
                </a>
                {trip.driver.point ? (
                  <>
                    <span>
                      {date(trip.driver.point.recordedAt)} · ±
                      {Math.round(trip.driver.point.accuracy)} м
                    </span>
                    {!trip.driver.stoppedAt &&
                    Date.now() -
                      new Date(trip.driver.point.recordedAt).getTime() >
                      120000 ? (
                      <small>Координаты устарели</small>
                    ) : null}
                  </>
                ) : (
                  <span>Ожидаем первую координату</span>
                )}
              </div>
            ) : (
              <p className="c-muted">Водитель ещё не отсканировал QR</p>
            )}
            {trip.driver ? <TripMap id={trip.id} token={token} /> : null}
            <div className="c-actions">
              {canQr?.(trip) && onQr ? (
                <button className="secondary" onClick={() => onQr(trip.id)}>
                  Открыть QR
                </button>
              ) : null}
              {onConfirm && trip.status === "ARRIVED" ? (
                <button disabled={busy} onClick={() => onConfirm(trip.id)}>
                  Подтвердить приход
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {!trips.length ? (
          <Empty>
            Перевозок пока нет. Здесь будут их статусы и местоположение
            водителей.
          </Empty>
        ) : null}
      </div>
    </section>
  );
}
function BatchList({ batches, names }: { batches: Row[]; names: Row }) {
  return (
    <div className="c-table">
      <table>
        <thead>
          <tr>
            <th>Партия</th>
            <th>Объект</th>
            <th>Состояние</th>
            <th>Всего</th>
            <th>Остаток</th>
            <th>Бигбеги</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id} id={`c-item-${batch.id}`} tabIndex={-1}>
              <td>
                {batch.id.slice(-8)}
                <small>{date(batch.createdAt)}</small>
              </td>
              <td>{names[batch.locationId]}</td>
              <td>
                {labels[batch.state]}
                {batch.status === "PENDING" ? " · ожидает приёмки" : ""}
              </td>
              <td>{tonnes(batch.totalKg)} т</td>
              <td>{tonnes(batch.remainingKg)} т</td>
              <td>
                {batch.bagCount ?? "—"}
                {batch.bagWeights ? (
                  <details>
                    <summary>Вес каждого</summary>
                    {batch.bagWeights.map((value: string, index: number) => (
                      <p key={index}>
                        №{index + 1}: {weight(value)} т
                      </p>
                    ))}
                  </details>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!batches.length ? <Empty>Подтверждённых партий пока нет.</Empty> : null}
    </div>
  );
}
function PasswordChange({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="collection-login">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await webRequest("/auth/change-password", token, {
              method: "POST",
              body: JSON.stringify({
                currentPassword: current,
                newPassword: next,
              }),
            });
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Смените временный пароль</h1>
        <label>
          Текущий пароль
          <input
            type="password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </label>
        <label>
          Новый пароль
          <input
            type="password"
            minLength={8}
            required
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
        <button disabled={busy}>Сохранить пароль</button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
