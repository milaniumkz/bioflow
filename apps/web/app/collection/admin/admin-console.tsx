"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  Warehouse,
  Package,
  Truck,
  Factory,
  Bell,
  History,
  Settings,
  LogOut,
  Plus,
  RefreshCw,
  Download,
  ArrowUpRight,
  Search,
  X,
} from "lucide-react";
import {
  webRequest,
  setSession,
  clearSession,
  currentSessionId,
  restoreBrowserSession,
  endBrowserSession,
  downloadReport,
} from "../../session";
import { createCommandId } from "../../command-id.mjs";
import { printQr, saveBlob } from "../../mobile-bridge";
import { TripMap } from "../trip-map";
import { kgAsTonnes, tonnesToKg } from "../weight-units";
import {
  Field,
  Reason,
  Weight,
  UserForm,
  LocationForm,
  StockForm,
  ProductionForm,
  AddBagsForm,
  GpForm,
  OperationForm,
  TripForm,
  SiteSelect,
} from "./admin-forms";
import {
  roleLabels,
  stateLabels,
  statusLabels,
  actionLabels,
  stockKg,
  stamp,
  type Row,
} from "./admin-types";
import "../collection.css";
import "./admin.css";
const tabs = [
  ["overview", "Обзор", LayoutDashboard],
  ["users", "Пользователи и доступы", Users],
  ["locations", "Склады и заводы", Warehouse],
  ["stock", "Остатки и бигбеги", Package],
  ["trips", "Рейсы и водители", Truck],
  ["shipments", "Отправки на завод", ArrowUpRight],
  ["operations", "Мойка и производство", Factory],
  ["notifications", "Уведомления", Bell],
  ["audit", "Журнал изменений", History],
  ["settings", "Настройки", Settings],
] as const;
type Modal = {
  key: string;
  title: string;
  description?: string;
  body: ReactNode;
  button?: string;
  danger?: boolean;
  submit(data: FormData): Promise<unknown>;
};
const text = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();
const listWeights = (form: FormData, name: string) =>
  form.getAll(name).map((v) => ({ weightKg: tonnesToKg(String(v)) }));
const idPath = (id: string) => encodeURIComponent(id);
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`ca-badge ${["FAILED", "CANCELLED", "WRITTEN_OFF"].includes(value) ? "ca-bad" : ["PENDING", "IN_TRANSIT", "CREATED", "PROCESSING"].includes(value) ? "ca-wait" : "ca-good"}`}
    >
      {statusLabels[value] ?? value}
    </span>
  );
}
function Empty({ children = "Пока нет данных" }: { children?: ReactNode }) {
  return (
    <div className="ca-empty">
      <Package size={28} />
      <p>{children}</p>
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <article className="ca-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}
function Dialog({
  modal,
  close,
  finish,
}: {
  modal: Modal;
  close(): void;
  finish(): Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await modal.submit(data);
      await finish();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="ca-dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else close();
      }}
      aria-labelledby="ca-dialog-title"
    >
      <div className="ca-dialog-head">
        <div>
          <h2 id="ca-dialog-title">{modal.title}</h2>
          {modal.description && <p>{modal.description}</p>}
        </div>
        <button
          type="button"
          className="ca-icon"
          onClick={close}
          disabled={busy}
          aria-label="Закрыть"
        >
          <X size={20} />
        </button>
      </div>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="ca-unset">
          {modal.body}
        </fieldset>
        {error && (
          <p role="alert" className="ca-error">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="ca-secondary"
            onClick={close}
            disabled={busy}
          >
            Закрыть
          </button>
          <button
            type="submit"
            className={modal.danger ? "ca-danger" : "ca-primary"}
            disabled={busy}
          >
            {busy ? "Сохраняем…" : (modal.button ?? "Сохранить")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
export default function AdminConsole() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Console />
    </QueryClientProvider>
  );
}
function Console() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [restoringLogin, setRestoringLogin] = useState(true);
  const [me, setMe] = useState<Row | null>(null);
  const [data, setData] = useState<Row | null>(null);
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [ledger, setLedger] = useState<Row>({ data: [], total: 0 });
  const loadVersion = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [audit, setAudit] = useState<Row>({ data: [], total: 0 });
  const [notifications, setNotifications] = useState<Row>({
    data: [],
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [qr, setQr] = useState<Row | null>(null);
  const pending = useRef(new Map<string, string>());
  const qrDialog = useRef<HTMLDialogElement>(null);
  const logout = useCallback(() => {
    loadVersion.current++;
    clearSession();
    setToken("");
    setMe(null);
    setData(null);
    setModal(null);
    setQr(null);
    setAudit({ data: [], total: 0 });
    setLedger({ data: [], total: 0 });
    setNotifications({ data: [], total: 0 });
    pending.current.clear();
    queryClient.clear();
    setNotice("");
    setSearch("");
    setQuery("");
    setTab("overview");
    setPage(1);
  }, [queryClient]);
  useEffect(() => {
    const expired = () => {
      logout();
      setError("Сессия завершена. Войдите снова.");
    };
    window.addEventListener("bioflow:expired", expired);
    return () => window.removeEventListener("bioflow:expired", expired);
  }, [logout]);
  useEffect(() => {
    let active = true;
    void restoreBrowserSession()
      .then(async (value) => {
        if (!value || !active) return;
        const profile = await webRequest<Row>("/auth/me", value);
        if (!active) return;
        if (profile.roles.some((r: string) => ["OWNER", "ADMIN"].includes(r))) {
          setMe(profile);
          setToken(value);
        } else setError("Админка доступна только владельцу и администратору.");
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setRestoringLogin(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!token) return;
    const version = ++loadVersion.current;
    let term = query;
    if (tab === "operations" && query) {
      const keys = Object.entries(actionLabels).filter(([, label]) =>
        label.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru")),
      );
      if (keys.length === 1) term = keys[0][0];
    }
    const path =
      tab === "audit"
        ? "audit"
        : tab === "notifications"
          ? "notifications"
          : tab === "operations"
            ? "operations"
            : "";
    const [snapshot, details] = await Promise.all([
      webRequest<Row>("/collection/admin/state", token),
      path
        ? webRequest<Row>(
            `/collection/admin/${path}?page=${page}&pageSize=30${term ? "&search=" + encodeURIComponent(term) : ""}`,
            token,
          )
        : Promise.resolve(null),
    ]);
    if (version !== loadVersion.current) return;
    setData(snapshot);
    setUpdated(new Date().toLocaleTimeString("ru-RU"));
    if (details) {
      if (tab === "audit") setAudit(details);
      if (tab === "notifications") setNotifications(details);
      if (tab === "operations") setLedger(details);
    }
  }, [token, tab, page, query]);
  useEffect(() => {
    if (!token) return;
    let active = true;
    let inFlight = false;
    const run = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await refresh();
        if (active) setError("");
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void run();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token, refresh]);
  useEffect(() => {
    if (qr && !qrDialog.current?.open) qrDialog.current?.showModal();
  }, [qr]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const auth = await webRequest<Row>("/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({
          phone: text(form, "phone"),
          password: String(form.get("password")),
          platform: "web",
        }),
      });
      setSession(auth as { accessToken: string; refreshToken: string });
      const profile = await webRequest<Row>("/auth/me", auth.accessToken);
      if (!profile.roles.some((r: string) => ["OWNER", "ADMIN"].includes(r))) {
        clearSession();
        throw Error("Админка доступна только владельцу и администратору.");
      }
      setMe(profile);
      setToken(auth.accessToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function command(path: string, body: Row) {
    const signature = path + JSON.stringify(body);
    let key = pending.current.get(signature);
    if (!key) {
      key = createCommandId();
      pending.current.set(signature, key);
    }
    const result = await webRequest<Row>(path, token, {
      method: "POST",
      body: JSON.stringify({ ...body, idempotencyKey: key }),
    });
    pending.current.delete(signature);
    setNotice("Изменения сохранены");
    return result;
  }
  function open(
    title: string,
    body: ReactNode,
    submit: Modal["submit"],
    extra: Partial<Modal> = {},
  ) {
    setModal({ key: createCommandId(), title, body, submit, ...extra });
  }
  function reasonCommand(
    title: string,
    path: string,
    description: string,
    fields: Row = {},
    danger = false,
  ) {
    open(
      title,
      <Reason label="Причина" />,
      (f) => command(path, { ...fields, reason: text(f, "reason") }),
      { description, button: title, danger },
    );
  }
  const s = data;
  const canOwn = me?.roles.includes("OWNER") ?? false;
  const sites = s?.locations ?? [];
  const users = s?.users ?? [];
  const siteName = (id: string) =>
    sites.find((l: Row) => l.id === id)?.name ?? "—";
  const userName = (id: string) =>
    users.find((u: Row) => u.id === id)?.fullName ??
    (id === "SYSTEM_OPENING" ? "Начальные остатки" : "—");
  const filtered = (rows: Row[]) =>
    rows.filter(
      (r) =>
        !search ||
        JSON.stringify(r)
          .toLocaleLowerCase("ru")
          .includes(search.toLocaleLowerCase("ru")),
    );
  function editUser(user?: Row) {
    if (!s) return;
    open(
      user ? "Изменить пользователя" : "Создать пользователя",
      <UserForm data={s} user={user} owner={canOwn} />,
      (f) =>
        command(
          "/collection/admin/users" + (user ? "/" + idPath(user.id) : ""),
          {
            fullName: text(f, "fullName"),
            phone: text(f, "phone"),
            role: text(f, "role"),
            locationIds: f.getAll("locationIds").map(String),
            ...(!user ? { password: String(f.get("password")) } : {}),
            reason: text(f, "reason"),
          },
        ),
    );
  }
  function editLocation(location?: Row) {
    open(
      location ? "Изменить объект" : "Добавить склад или завод",
      <LocationForm location={location} />,
      (f) =>
        command(
          "/collection/admin/locations" +
            (location ? "/" + idPath(location.id) : ""),
          {
            name: text(f, "name"),
            kind: text(f, "kind"),
            active: f.get("active") === "on",
            reason: text(f, "reason"),
          },
        ),
    );
  }
  function editStock(locationId = "", state = "RAW") {
    if (!s) return;
    open(
      "Корректировка остатка",
      <StockForm data={s} initialLocation={locationId} initialState={state} />,
      (f) =>
        command("/collection/admin/stock", {
          locationId: text(f, "locationId"),
          state: text(f, "state"),
          expectedKg: text(f, "expectedKg"),
          targetKg: tonnesToKg(text(f, "target")),
          reason: text(f, "reason"),
        }),
      {
        description:
          "Укажите фактический остаток в тоннах и причину изменения.",
      },
    );
  }
  function operation(kind: string) {
    if (!s) return;
    if (kind === "production") {
      open(
        "Создать готовую продукцию",
        <ProductionForm data={s} />,
        (f) =>
          command("/collection/production", {
            locationId: text(f, "locationId"),
            finished: listWeights(f, "finished"),
            rejected: listWeights(f, "rejected"),
          }),
        { button: "Создать продукцию" },
      );
    } else if (kind === "gp") {
      open(
        "Отправить готовую продукцию",
        <GpForm data={s} />,
        async (f) => {
          const ids = f.getAll("bagIds").map(String);
          if (!ids.length) throw Error("Выберите хотя бы один бигбег");
          const result = await command("/collection/gp-trips", {
            locationId: text(f, "locationId"),
            recipientName: text(f, "recipientName"),
            recipientAddress: text(f, "recipientAddress"),
            bagIds: ids,
          });
          setQr(result);
          return result;
        },
        { button: "Создать отправку и QR" },
      );
    } else {
      const title =
        kind === "trip"
          ? "Создать отправку сырья"
          : kind === "wash"
            ? "Перевести сырьё в мытое"
            : "Отправить сырьё на завод";
      open(
        title,
        <OperationForm data={s} kind={kind} />,
        async (f) => {
          const body = {
            weightKg: tonnesToKg(text(f, "weight")),
            ...(kind === "trip"
              ? {
                  warehouseId: text(f, "locationId"),
                  bagCount: Number(f.get("bagCount")),
                }
              : { locationId: text(f, "locationId") }),
            ...(kind === "shipment"
              ? {
                  factoryId: text(f, "factoryId"),
                  bagCount: Number(f.get("bagCount")),
                }
              : {}),
          };
          const result = await command(
            kind === "trip"
              ? "/collection/trips"
              : kind === "wash"
                ? "/collection/wash"
                : "/collection/shipments",
            body,
          );
          if (kind === "trip") setQr(result);
          return result;
        },
        {
          button:
            kind === "trip" ? "Создать отправку и QR" : "Сохранить операцию",
        },
      );
    }
  }
  async function openQr(trip: Row) {
    setError("");
    try {
      setQr(
        await webRequest<Row>(`/collection/trips/${idPath(trip.id)}/qr`, token),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function downloadQr() {
    try {
      const response = await fetch(qr!.qrImage);
      await saveBlob(await response.blob(), `Collection-${qr!.number}.png`);
    } catch {
      setError("Не удалось сохранить QR");
    }
  }
  async function exportData() {
    try {
      const blob = await downloadReport("/collection/admin/export", token);
      await saveBlob(
        blob,
        `Collection-${new Date().toISOString().slice(0, 10)}.json`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function signOut() {
    const id = currentSessionId();
    if (id)
      await webRequest(
        `/auth/sessions/${encodeURIComponent(id)}/revoke`,
        token,
        { method: "POST", body: "{}" },
      ).catch(() => {});
    await endBrowserSession().catch(() => {});
    logout();
  }
  if (!token && restoringLogin)
    return (
      <main className="ca-root ca-login">
        <section className="ca-login-card">
          <p role="status">Восстанавливаем вход…</p>
        </section>
      </main>
    );
  if (!token)
    return (
      <main className="ca-root ca-login">
        <section className="ca-login-card">
          <img
            src="/collection-icons/icon-192.png"
            width={62}
            height={62}
            alt="Collection"
          />
          <p className="ca-kicker">COLLECTION · АДМИНИСТРИРОВАНИЕ</p>
          <h1>
            Полный контроль
            <br />в одном кабинете.
          </h1>
          <p className="ca-muted">
            Пользователи, объекты, запасы и все операции рабочего контура.
          </p>
          <form onSubmit={login}>
            <Field label="Телефон">
              <input
                aria-label="Телефон"
                type="tel"
                name="phone"
                autoComplete="username"
                placeholder="+7 …"
                required
              />
            </Field>
            <Field label="Пароль">
              <input
                aria-label="Пароль"
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </Field>
            {error && (
              <p role="alert" className="ca-error">
                {error}
              </p>
            )}
            <button className="ca-primary ca-full" disabled={busy}>
              {busy ? "Входим…" : "Войти в админку"}
            </button>
          </form>
          <a href="/collection" className="ca-back">
            Рабочие кабинеты →
          </a>
        </section>
        <aside className="ca-login-aside">
          <span>Collection Admin</span>
          <h2>
            Всё движение.
            <br />
            Все объекты.
            <br />
            Все решения.
          </h2>
          <p>
            От первого мешка до готовой продукции — с понятной историей каждого
            изменения.
          </p>
          <div>Сбор → Мойка → Завод → Доставка</div>
        </aside>
      </main>
    );
  const title = tabs.find((t) => t[0] === tab)?.[1] ?? "Обзор";
  const totals = (state: string) =>
    (s?.stock ?? [])
      .filter((r: Row) => r.state === state)
      .reduce(
        (sum: number, r: Row) => sum + Number(r._sum.remainingKg ?? 0),
        0,
      );
  const awaiting =
    (s?.trips ?? []).filter(
      (t: Row) => t.status === "ARRIVED" && t.kind === "RAW",
    ).length +
    (s?.shipments ?? []).filter((t: Row) => t.status === "IN_TRANSIT").length;
  return (
    <div className="ca-root ca-shell">
      <aside className="ca-sidebar">
        <a href="/collection/admin" className="ca-brand">
          <img
            src="/collection-icons/icon-192.png"
            alt=""
            width={40}
            height={40}
          />
          <span>
            collection<small>ADMIN CONSOLE</small>
          </span>
        </a>
        <nav aria-label="Разделы админки">
          {tabs.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setSearch("");
                setPage(1);
              }}
              className={tab === key ? "ca-nav-active" : ""}
              aria-current={tab === key ? "page" : undefined}
            >
              <Icon size={18} />
              {label}
              {key === "notifications" && !!s?.failedPushes && (
                <b>{s.failedPushes}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="ca-sidebar-bottom">
          <a href="/collection">
            Рабочий кабинет <ArrowUpRight size={15} />
          </a>
          <div className="ca-profile">
            <span className="ca-avatar">
              {String(me?.fullName ?? "A").slice(0, 1)}
            </span>
            <span>
              {me?.fullName}
              <small>
                {me?.roles.map((r: string) => roleLabels[r] ?? r).join(", ")}
              </small>
            </span>
            <button
              className="ca-icon"
              onClick={() => void signOut()}
              aria-label="Выйти"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <main className="ca-main">
        <header className="ca-topbar">
          <div>
            <p className="ca-kicker">РАБОЧИЙ КОНТУР / УПРАВЛЕНИЕ</p>
            <h1>{title}</h1>
          </div>
          <div className="ca-top-actions">
            <span className="ca-live">
              <i />
              {updated ? `Обновлено ${updated}` : "Подключаемся…"}
            </span>
            <button
              className="ca-icon"
              aria-label="Обновить данные"
              onClick={() => void refresh().catch((e) => setError(e.message))}
            >
              <RefreshCw size={18} />
            </button>
            <button
              className="ca-secondary"
              onClick={() => void exportData()}
              disabled={!s}
            >
              <Download size={16} />
              Выгрузить
            </button>
          </div>
        </header>
        {error && (
          <p role="alert" className="ca-error">
            {error}
          </p>
        )}
        {notice && (
          <div role="status" className="ca-success">
            {notice}
            <button aria-label="Скрыть сообщение" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {!s ? (
          <Empty>Загружаем данные…</Empty>
        ) : (
          <>
            {tab !== "overview" && tab !== "settings" && (
              <div className="ca-toolbar">
                <label className="ca-search">
                  <Search size={17} />
                  <input
                    aria-label="Поиск"
                    placeholder="Поиск по разделу…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
                {tab === "users" && (
                  <button className="ca-primary" onClick={() => editUser()}>
                    <Plus size={16} />
                    Добавить пользователя
                  </button>
                )}
                {tab === "locations" && (
                  <button className="ca-primary" onClick={() => editLocation()}>
                    <Plus size={16} />
                    Добавить объект
                  </button>
                )}
                {tab === "stock" && (
                  <div className="ca-row-actions">
                    <button className="ca-primary" onClick={() => editStock()}>
                      Скорректировать остаток
                    </button>
                    <button
                      className="ca-secondary"
                      onClick={() =>
                        open(
                          "Добавить бигбеги корректировкой",
                          <AddBagsForm data={s} />,
                          (f) =>
                            command("/collection/admin/bags", {
                              locationId: text(f, "locationId"),
                              state: text(f, "state"),
                              bags: listWeights(f, "weights"),
                              reason: text(f, "reason"),
                            }),
                        )
                      }
                    >
                      Добавить бигбеги
                    </button>
                  </div>
                )}
                {tab === "trips" && (
                  <div className="ca-row-actions">
                    <button
                      className="ca-primary"
                      onClick={() => operation("trip")}
                    >
                      Отправить сырьё
                    </button>
                    <button
                      className="ca-secondary"
                      onClick={() => operation("gp")}
                    >
                      Отправить ГП
                    </button>
                  </div>
                )}
                {tab === "shipments" && (
                  <button
                    className="ca-primary"
                    onClick={() => operation("shipment")}
                  >
                    Отправить на завод
                  </button>
                )}
                {tab === "operations" && (
                  <div className="ca-row-actions">
                    <button
                      className="ca-primary"
                      onClick={() => operation("wash")}
                    >
                      Создать мытое
                    </button>
                    <button
                      className="ca-secondary"
                      onClick={() => operation("production")}
                    >
                      Создать ГП
                    </button>
                  </div>
                )}
                {tab === "notifications" && (
                  <button
                    className="ca-primary"
                    onClick={() =>
                      open(
                        "Отправить уведомление",
                        <NoticeForm data={s} />,
                        (f) =>
                          command("/collection/admin/notifications", {
                            title: text(f, "title"),
                            body: text(f, "body"),
                            target: text(f, "target"),
                            ...(text(f, "targetId")
                              ? { targetId: text(f, "targetId") }
                              : {}),
                            reason: text(f, "reason"),
                          }),
                        { button: "Отправить" },
                      )
                    }
                  >
                    <Plus size={16} />
                    Отправить уведомление
                  </button>
                )}
              </div>
            )}
            {tab === "overview" && (
              <>
                <section className="ca-hero">
                  <div>
                    <p className="ca-kicker">ВСЯ СИСТЕМА В РЕАЛЬНОМ ВРЕМЕНИ</p>
                    <h2>
                      Управление всей сетью
                      <br />в одном кабинете.
                    </h2>
                    <p>
                      {
                        sites.filter(
                          (l: Row) => l.active && l.kind === "WAREHOUSE",
                        ).length
                      }{" "}
                      склада / мойки ·{" "}
                      {
                        sites.filter(
                          (l: Row) => l.active && l.kind === "FACTORY",
                        ).length
                      }{" "}
                      завода · {users.filter((u: Row) => !u.isBlocked).length}{" "}
                      активных пользователей
                    </p>
                  </div>
                  <button
                    className="ca-light"
                    onClick={() => operation("trip")}
                  >
                    <Plus size={17} />
                    Новая отправка
                  </button>
                </section>
                <section className="ca-metrics">
                  {Object.entries(stateLabels).map(([key, label]) => (
                    <Metric
                      key={key}
                      label={label}
                      value={
                        <>
                          {kgAsTonnes(totals(key))}
                          <em> т</em>
                        </>
                      }
                      detail="Доступно на всех объектах"
                    />
                  ))}
                </section>
                <section className="ca-grid-two">
                  <article className="ca-card">
                    <div className="ca-card-title">
                      <h2>Требует внимания</h2>
                      <span className="ca-pill">{awaiting}</span>
                    </div>
                    <button
                      className="ca-attention"
                      onClick={() => setTab("trips")}
                    >
                      <Truck size={20} />
                      <span>
                        Приход сырья
                        <strong>
                          {
                            s.trips.filter(
                              (t: Row) =>
                                t.kind === "RAW" && t.status === "ARRIVED",
                            ).length
                          }{" "}
                          ожидает подтверждения
                        </strong>
                      </span>
                      <ArrowUpRight size={18} />
                    </button>
                    <button
                      className="ca-attention"
                      onClick={() => setTab("shipments")}
                    >
                      <Factory size={20} />
                      <span>
                        Поставки на завод
                        <strong>
                          {
                            s.shipments.filter(
                              (t: Row) => t.status === "IN_TRANSIT",
                            ).length
                          }{" "}
                          в пути
                        </strong>
                      </span>
                      <ArrowUpRight size={18} />
                    </button>
                    <button
                      className="ca-attention"
                      onClick={() => setTab("notifications")}
                    >
                      <Bell size={20} />
                      <span>
                        Уведомления
                        <strong>{s.failedPushes} ошибок доставки</strong>
                      </span>
                      <ArrowUpRight size={18} />
                    </button>
                  </article>
                  <article className="ca-card">
                    <div className="ca-card-title">
                      <h2>Быстрые действия</h2>
                    </div>
                    <div className="ca-quick">
                      <button onClick={() => editUser()}>
                        <Users size={20} />
                        Добавить пользователя
                      </button>
                      <button onClick={() => editStock()}>
                        <Package size={20} />
                        Корректировка остатков
                      </button>
                      <button onClick={() => operation("wash")}>
                        <Warehouse size={20} />
                        Оформить мойку
                      </button>
                      <button onClick={() => operation("production")}>
                        <Factory size={20} />
                        Выпустить ГП
                      </button>
                    </div>
                  </article>
                </section>
                <StockTable data={s} siteName={siteName} edit={editStock} />
                <RecentActions
                  actions={s.actions.slice(0, 8)}
                  siteName={siteName}
                  userName={userName}
                />
              </>
            )}
            {tab === "users" && (
              <section className="ca-card">
                <div className="ca-card-title">
                  <h2>Учётные записи</h2>
                  <span className="ca-muted">{users.length} пользователей</span>
                </div>
                <div className="ca-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Пользователь</th>
                        <th>Роль</th>
                        <th>Объекты</th>
                        <th>Доступ</th>
                        <th>Управление</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered(users).map((user) => (
                        <tr key={user.id}>
                          <td>
                            <strong>{user.fullName}</strong>
                            <small>{user.phone ?? user.email}</small>
                          </td>
                          <td>
                            {user.userRoles
                              .map(
                                (r: Row) =>
                                  roleLabels[r.role.code] ?? r.role.name,
                              )
                              .join(", ")}
                          </td>
                          <td>
                            {user.userRoles.some((r: Row) =>
                              ["OWNER", "ADMIN"].includes(r.role.code),
                            )
                              ? "Все объекты"
                              : s.memberships
                                  .filter((m: Row) => m.userId === user.id)
                                  .map((m: Row) => siteName(m.locationId))
                                  .join(", ") || "—"}
                          </td>
                          <td>
                            <span
                              className={`ca-badge ${user.isBlocked ? "ca-bad" : "ca-good"}`}
                            >
                              {user.isBlocked ? "Заблокирован" : "Активен"}
                            </span>
                          </td>
                          <td>
                            <div className="ca-row-actions">
                              <button onClick={() => editUser(user)}>
                                Изменить
                              </button>
                              <button
                                onClick={() =>
                                  open(
                                    "Установить новый пароль",
                                    <>
                                      <Field label="Новый пароль">
                                        <input
                                          aria-label="Новый пароль"
                                          name="password"
                                          type="password"
                                          minLength={6}
                                          maxLength={128}
                                          autoComplete="new-password"
                                          required
                                        />
                                      </Field>
                                      <Reason value="Смена пароля администратором" />
                                    </>,
                                    (f) =>
                                      command(
                                        `/collection/admin/users/${idPath(user.id)}/password`,
                                        {
                                          password: String(f.get("password")),
                                          reason: text(f, "reason"),
                                        },
                                      ),
                                    {
                                      description: `${user.fullName}. Действующие сеансы завершатся, обязательной смены пароля не будет.`,
                                    },
                                  )
                                }
                              >
                                Пароль
                              </button>
                              {user.id !== me?.id && (
                                <button
                                  className={
                                    user.isBlocked ? "" : "ca-text-danger"
                                  }
                                  onClick={() =>
                                    reasonCommand(
                                      user.isBlocked
                                        ? "Восстановить доступ"
                                        : "Заблокировать",
                                      `/collection/admin/users/${idPath(user.id)}/block`,
                                      user.fullName,
                                      { blocked: !user.isBlocked },
                                      !user.isBlocked,
                                    )
                                  }
                                >
                                  {user.isBlocked
                                    ? "Разблокировать"
                                    : "Блокировать"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {tab === "locations" && (
              <section className="ca-location-grid">
                {filtered(sites).map((location) => (
                  <article className="ca-card ca-location" key={location.id}>
                    <div className="ca-location-head">
                      <span className="ca-site-icon">
                        {location.kind === "FACTORY" ? (
                          <Factory size={23} />
                        ) : (
                          <Warehouse size={23} />
                        )}
                      </span>
                      <span
                        className={`ca-badge ${location.active ? "ca-good" : "ca-wait"}`}
                      >
                        {location.active ? "Активен" : "В архиве"}
                      </span>
                    </div>
                    <h2>{location.name}</h2>
                    <p className="ca-muted">
                      {location.kind === "FACTORY" ? "Завод" : "Мойка / склад"}
                    </p>
                    <div className="ca-site-stock">
                      {(location.kind === "FACTORY"
                        ? ["WASHED", "FINISHED", "REJECT"]
                        : ["RAW", "WASHED"]
                      ).map((state) => (
                        <span key={state}>
                          {stateLabels[state]}
                          <strong>
                            {kgAsTonnes(stockKg(s, location.id, state))} т
                          </strong>
                        </span>
                      ))}
                    </div>
                    <p className="ca-muted">
                      Ответственные:{" "}
                      {s.memberships
                        .filter((m: Row) => m.locationId === location.id)
                        .map((m: Row) => userName(m.userId))
                        .join(", ") || "Не назначены"}
                    </p>
                    <button
                      className="ca-secondary"
                      onClick={() => editLocation(location)}
                    >
                      Изменить / архивировать
                    </button>
                  </article>
                ))}
              </section>
            )}
            {tab === "stock" && (
              <>
                <StockTable
                  data={{ ...s, locations: filtered(sites) }}
                  siteName={siteName}
                  edit={editStock}
                />
                <section className="ca-card">
                  <div className="ca-card-title">
                    <h2>Бигбеги ГП и некондиции</h2>
                  </div>
                  <div className="ca-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Партия / бигбег</th>
                          <th>Завод</th>
                          <th>Продукция</th>
                          <th>Вес, т</th>
                          <th>Состояние</th>
                          <th>Действие</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered(
                          s.batches.filter((b: Row) =>
                            ["FINISHED", "REJECT"].includes(b.state),
                          ),
                        ).flatMap((batch) =>
                          batch.bags.map((bag: Row) => (
                            <tr key={bag.id}>
                              <td>
                                <strong>Бигбег {bag.index}</strong>
                                <small>{stamp(batch.createdAt)}</small>
                              </td>
                              <td>{siteName(batch.locationId)}</td>
                              <td>{stateLabels[batch.state]}</td>
                              <td>{kgAsTonnes(bag.weightKg)}</td>
                              <td>
                                <Badge value={bag.status} />
                              </td>
                              <td>
                                {["AVAILABLE", "WRITTEN_OFF"].includes(
                                  bag.status,
                                ) &&
                                  batch.status === "ACTIVE" && (
                                    <button
                                      className={
                                        bag.status === "AVAILABLE"
                                          ? "ca-text-danger"
                                          : ""
                                      }
                                      onClick={() =>
                                        reasonCommand(
                                          bag.status === "AVAILABLE"
                                            ? "Списать бигбег"
                                            : "Восстановить бигбег",
                                          `/collection/admin/bags/${idPath(bag.id)}`,
                                          `${siteName(batch.locationId)} · ${kgAsTonnes(bag.weightKg)} т`,
                                          {
                                            available:
                                              bag.status === "WRITTEN_OFF",
                                          },
                                          bag.status === "AVAILABLE",
                                        )
                                      }
                                    >
                                      {bag.status === "AVAILABLE"
                                        ? "Списать"
                                        : "Восстановить"}
                                    </button>
                                  )}
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                  {!s.batches.some((b: Row) => b.bags.length) && (
                    <Empty>
                      Готовая продукция появится после производства или
                      корректировки.
                    </Empty>
                  )}
                </section>
              </>
            )}
            {tab === "trips" && (
              <section className="ca-trip-grid">
                {filtered(s.trips).map((trip) => (
                  <article className="ca-card ca-trip" key={trip.id}>
                    <div className="ca-card-title">
                      <span className="ca-kicker">
                        {trip.kind === "GP" ? "ДОСТАВКА ГП" : "СЫРЬЁ НА СКЛАД"}
                      </span>
                      <Badge value={trip.status} />
                    </div>
                    <h2>{trip.number}</h2>
                    <p className="ca-muted">
                      {trip.kind === "GP"
                        ? `${siteName(trip.fromLocationId)} → ${trip.recipientName}`
                        : `${userName(trip.createdById)} → ${siteName(trip.warehouseId)}`}
                    </p>
                    <div className="ca-trip-weight">
                      <strong>
                        {kgAsTonnes(trip.weightKg)}
                        <em> т</em>
                      </strong>
                      <span>
                        {trip.bagCount}{" "}
                        {trip.kind === "GP" ? "бигбегов" : "мешков"}
                      </span>
                    </div>
                    <p>
                      {trip.driver
                        ? `${trip.driver.driverPlate} · ${trip.driver.driverPhone}`
                        : "Водитель ещё не подключён"}
                    </p>
                    <small className="ca-muted">{stamp(trip.createdAt)}</small>
                    <div className="ca-row-actions ca-trip-actions">
                      {trip.status !== "CANCELLED" && (
                        <>
                          <button onClick={() => void openQr(trip)}>
                            QR-код
                          </button>
                          <button
                            onClick={() =>
                              open(
                                "Изменить рейс",
                                <TripForm trip={trip} data={s} />,
                                (f) =>
                                  command(
                                    `/collection/admin/trips/${idPath(trip.id)}`,
                                    {
                                      ...(trip.kind === "RAW"
                                        ? {
                                            bagCount: Number(f.get("bagCount")),
                                            ...(text(f, "warehouseId")
                                              ? {
                                                  warehouseId: text(
                                                    f,
                                                    "warehouseId",
                                                  ),
                                                }
                                              : {}),
                                          }
                                        : {
                                            recipientName: text(
                                              f,
                                              "recipientName",
                                            ),
                                            recipientAddress: text(
                                              f,
                                              "recipientAddress",
                                            ),
                                          }),
                                      ...(trip.driver
                                        ? {
                                            driverPlate: text(f, "driverPlate"),
                                            driverPhone: text(f, "driverPhone"),
                                          }
                                        : {}),
                                      reason: text(f, "reason"),
                                    },
                                  ),
                              )
                            }
                          >
                            Реквизиты
                          </button>
                          {trip.kind === "RAW" && (
                            <button
                              onClick={() =>
                                open(
                                  "Исправить вес отправки",
                                  <>
                                    <p>
                                      Сейчас: {kgAsTonnes(trip.weightKg)} т.
                                    </p>
                                    <Weight
                                      label="Правильный вес, тонн"
                                      value={String(
                                        Number(trip.weightKg) / 1000,
                                      )}
                                    />
                                    <Reason
                                      label="Причина исправления"
                                      minLength={10}
                                    />
                                  </>,
                                  (f) =>
                                    command(
                                      `/collection/trips/${idPath(trip.id)}/weight`,
                                      {
                                        expectedWeightKg: String(trip.weightKg),
                                        weightKg: tonnesToKg(text(f, "weight")),
                                        reason: text(f, "reason"),
                                      },
                                    ),
                                  {
                                    description:
                                      "Вес исправится в отправке и связанном приходе. История сохранится.",
                                  },
                                )
                              }
                            >
                              Вес
                            </button>
                          )}
                          {["CREATED", "LOADED", "IN_TRANSIT"].includes(
                            trip.status,
                          ) && (
                            <button
                              onClick={() =>
                                open(
                                  "Изменить этап рейса",
                                  <>
                                    <Field label="Новый этап">
                                      <select
                                        aria-label="Новый этап"
                                        name="status"
                                      >
                                        {["LOADED", "IN_TRANSIT", "ARRIVED"]
                                          .filter(
                                            (status) =>
                                              [
                                                "CREATED",
                                                "LOADED",
                                                "IN_TRANSIT",
                                                "ARRIVED",
                                              ].indexOf(status) >
                                              [
                                                "CREATED",
                                                "LOADED",
                                                "IN_TRANSIT",
                                                "ARRIVED",
                                              ].indexOf(trip.status),
                                          )
                                          .map((status) => (
                                            <option key={status} value={status}>
                                              {statusLabels[status]}
                                            </option>
                                          ))}
                                      </select>
                                    </Field>
                                    <Reason label="Причина" />
                                  </>,
                                  (f) =>
                                    command(
                                      `/collection/admin/trips/${idPath(trip.id)}/stage`,
                                      {
                                        status: text(f, "status"),
                                        reason: text(f, "reason"),
                                      },
                                    ),
                                  {
                                    description:
                                      "При отметке прибытия создастся приход. Действие запишется от имени администратора.",
                                  },
                                )
                              }
                            >
                              Этап
                            </button>
                          )}
                          {trip.kind === "RAW" && trip.status === "ARRIVED" && (
                            <button
                              className="ca-primary"
                              onClick={() =>
                                open(
                                  "Подтвердить приход",
                                  <p>
                                    {siteName(trip.warehouseId)} ·{" "}
                                    {kgAsTonnes(trip.weightKg)} т ·{" "}
                                    {trip.bagCount} мешков.
                                  </p>,
                                  () =>
                                    command(
                                      `/collection/trips/${idPath(trip.id)}/confirm`,
                                      {},
                                    ),
                                  { button: "Подтвердить приход" },
                                )
                              }
                            >
                              Принять
                            </button>
                          )}
                          <button
                            className="ca-text-danger"
                            onClick={() =>
                              reasonCommand(
                                "Отменить рейс",
                                `/collection/admin/trips/${idPath(trip.id)}/cancel`,
                                `${trip.number}. Неиспользованный приход будет отменён; бигбеги ГП вернутся на завод.`,
                                {},
                                true,
                              )
                            }
                          >
                            Отменить
                          </button>
                          {trip.driver && !trip.driver.stoppedAt && (
                            <button
                              className="ca-text-danger"
                              onClick={() =>
                                reasonCommand(
                                  "Остановить отслеживание",
                                  `/collection/admin/trips/${idPath(trip.id)}/stop`,
                                  "Доступ водителя к рейсу будет отозван при следующем подключении. Ещё не переданные координаты останутся на его телефоне.",
                                  {},
                                  true,
                                )
                              }
                            >
                              Остановить GPS
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {trip.driver && <TripMap id={trip.id} token={token} />}
                  </article>
                ))}
                {!filtered(s.trips).length && (
                  <Empty>Рейсы появятся после создания отправки.</Empty>
                )}
              </section>
            )}
            {tab === "shipments" && (
              <section className="ca-card">
                <div className="ca-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Отправка</th>
                        <th>Откуда → куда</th>
                        <th>Количество</th>
                        <th>Вес, т</th>
                        <th>Средний вес, т</th>
                        <th>Статус</th>
                        <th>Управление</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered(s.shipments).map((shipment) => (
                        <tr key={shipment.id}>
                          <td>
                            <strong>{shipment.number}</strong>
                            <small>{stamp(shipment.createdAt)}</small>
                          </td>
                          <td>
                            {siteName(shipment.fromLocationId)} →{" "}
                            {siteName(shipment.toLocationId)}
                          </td>
                          <td>{shipment.bagCount}</td>
                          <td>{kgAsTonnes(shipment.weightKg)}</td>
                          <td>{kgAsTonnes(shipment.averageBagKg)}</td>
                          <td>
                            <Badge value={shipment.status} />
                          </td>
                          <td>
                            <div className="ca-row-actions">
                              {shipment.status === "IN_TRANSIT" && (
                                <button
                                  onClick={() =>
                                    open(
                                      "Подтвердить приход на завод",
                                      <p>
                                        {siteName(shipment.toLocationId)} ·{" "}
                                        {shipment.bagCount} бигбегов ·{" "}
                                        {kgAsTonnes(shipment.weightKg)} т.
                                      </p>,
                                      () =>
                                        command(
                                          `/collection/shipments/${idPath(shipment.id)}/confirm`,
                                          {},
                                        ),
                                      { button: "Подтвердить приход" },
                                    )
                                  }
                                >
                                  Принять
                                </button>
                              )}
                              {shipment.status !== "CANCELLED" && (
                                <button
                                  className="ca-text-danger"
                                  onClick={() =>
                                    reasonCommand(
                                      "Отменить отправку",
                                      `/collection/admin/shipments/${idPath(shipment.id)}/cancel`,
                                      `${shipment.number}. Сырьё вернётся в исходные партии склада, если на заводе оно ещё не использовано.`,
                                      {},
                                      true,
                                    )
                                  }
                                >
                                  Отменить
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!s.shipments.length && (
                  <Empty>Отправок на завод пока нет.</Empty>
                )}
              </section>
            )}
            {tab === "operations" && (
              <section className="ca-card">
                <div className="ca-card-title">
                  <h2>Движение материалов</h2>
                  <span className="ca-muted">{ledger.total} операций</span>
                </div>
                <div className="ca-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Операция</th>
                        <th>Объект</th>
                        <th>Количество, т</th>
                        <th>Кто выполнил</th>
                        <th>Дата</th>
                        <th>Управление</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.data.map((action: Row) => (
                        <tr key={action.id}>
                          <td>
                            <strong>
                              {actionLabels[action.kind] ?? action.kind}
                            </strong>
                            {action.details?.reason && (
                              <small>{action.details.reason}</small>
                            )}
                          </td>
                          <td>{siteName(action.locationId)}</td>
                          <td>{kgAsTonnes(action.quantityKg)}</td>
                          <td>{userName(action.createdById)}</td>
                          <td>{stamp(action.createdAt)}</td>
                          <td>
                            {[
                              "WASH",
                              "PRODUCTION",
                              "STOCK_ADJUSTMENT",
                              "BAGS_ADJUSTMENT",
                            ].includes(action.kind) &&
                              !action.reversed && (
                                <button
                                  className="ca-text-danger"
                                  onClick={() =>
                                    reasonCommand(
                                      "Отменить операцию",
                                      `/collection/admin/operations/${idPath(action.id)}/reverse`,
                                      `${actionLabels[action.kind]} · ${kgAsTonnes(action.quantityKg)} т. Если результат ещё не использован, исходные остатки восстановятся.`,
                                      {},
                                      true,
                                    )
                                  }
                                >
                                  Отменить
                                </button>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={page} total={ledger.total} setPage={setPage} />
              </section>
            )}
            {tab === "notifications" && (
              <section className="ca-card">
                <div className="ca-card-title">
                  <h2>Все уведомления</h2>
                  <span className="ca-muted">{notifications.total}</span>
                </div>
                <div className="ca-notices">
                  {notifications.data.map((n: Row) => (
                    <article key={n.id}>
                      <div>
                        <h3>{n.title}</h3>
                        <p>{n.body}</p>
                        <small>
                          {userName(n.userId)} · {stamp(n.createdAt)} ·{" "}
                          {n.readAt ? "Прочитано" : "Не прочитано"}
                        </small>
                      </div>
                      <div className="ca-notice-status">
                        {n.deliveries.length ? (
                          n.deliveries.map((d: Row) => (
                            <div key={d.id}>
                              <Badge value={d.status} />
                              <small>
                                {d.attempts} попыток
                                {d.lastError ? ` · ${d.lastError}` : ""}
                              </small>
                            </div>
                          ))
                        ) : (
                          <span className="ca-muted">
                            Внутри кабинета · push-устройство не подключено
                          </span>
                        )}
                        {n.deliveries.some(
                          (d: Row) => d.status === "FAILED",
                        ) && (
                          <button
                            onClick={() =>
                              open(
                                "Повторить доставку",
                                <Reason value="Повторная доставка уведомления" />,
                                (f) =>
                                  command(
                                    `/collection/admin/notifications/${idPath(n.id)}/retry`,
                                    { reason: text(f, "reason") },
                                  ),
                                { description: n.title },
                              )
                            }
                          >
                            Повторить push
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                {!notifications.data.length && (
                  <Empty>Уведомлений пока нет.</Empty>
                )}
                <Pager
                  page={page}
                  total={notifications.total}
                  setPage={setPage}
                />
              </section>
            )}
            {tab === "audit" && (
              <section className="ca-card">
                <div className="ca-card-title">
                  <h2>История административных изменений</h2>
                  <span className="ca-muted">{audit.total} записей</span>
                </div>
                {audit.data.map((entry: Row) => (
                  <details className="ca-audit" key={entry.id}>
                    <summary>
                      <span>
                        <strong>{auditTitle(entry.action)}</strong>
                        <small>
                          {userName(entry.userId)} · {stamp(entry.createdAt)}
                        </small>
                      </span>
                      <span>{entry.reason || "Без комментария"}</span>
                    </summary>
                    <div className="ca-audit-details">
                      <p>
                        {entry.entity} · {entry.entityId}
                      </p>
                      <div className="ca-grid-two">
                        <div>
                          <h4>До изменения</h4>
                          <pre>{JSON.stringify(entry.oldValue, null, 2)}</pre>
                        </div>
                        <div>
                          <h4>После изменения</h4>
                          <pre>{JSON.stringify(entry.newValue, null, 2)}</pre>
                        </div>
                      </div>
                    </div>
                  </details>
                ))}
                {!audit.data.length && (
                  <Empty>Изменения будут появляться здесь.</Empty>
                )}
                <Pager page={page} total={audit.total} setPage={setPage} />
              </section>
            )}
            {tab === "settings" && (
              <section className="ca-grid-two">
                <article className="ca-card">
                  <h2>Самостоятельная регистрация</h2>
                  <p className="ca-muted">
                    Сборщики, мойки и заводы могут создавать учётные записи без
                    согласования. Владелец и администратор создаются только
                    здесь.
                  </p>
                  <span
                    className={`ca-badge ${s.settings.registrationEnabled ? "ca-good" : "ca-wait"}`}
                  >
                    {s.settings.registrationEnabled
                      ? "Регистрация открыта"
                      : "Регистрация закрыта"}
                  </span>
                  <button
                    className="ca-secondary ca-spaced"
                    onClick={() =>
                      open(
                        s.settings.registrationEnabled
                          ? "Закрыть регистрацию"
                          : "Открыть регистрацию",
                        <Reason value="Изменение доступа к регистрации" />,
                        (f) =>
                          command("/collection/admin/settings", {
                            registrationEnabled:
                              !s.settings.registrationEnabled,
                            reason: text(f, "reason"),
                          }),
                      )
                    }
                  >
                    {s.settings.registrationEnabled
                      ? "Закрыть регистрацию"
                      : "Открыть регистрацию"}
                  </button>
                </article>
                <article className="ca-card">
                  <h2>Выгрузка данных</h2>
                  <p className="ca-muted">
                    Пользователи, объекты, остатки, партии, рейсы и движения в
                    одном файле. Пароли, ключи и токены в выгрузку не
                    включаются.
                  </p>
                  <button
                    className="ca-secondary"
                    onClick={() => void exportData()}
                  >
                    <Download size={17} />
                    Скачать JSON
                  </button>
                  <p className="ca-muted ca-spaced">
                    История изменений и отмен остаётся в журнале. Отмена
                    операций выполняется с возвратом исходных материалов и
                    проверкой связанных движений.
                  </p>
                </article>
              </section>
            )}
          </>
        )}
      </main>
      {modal && (
        <Dialog
          key={modal.key}
          modal={modal}
          close={() => setModal(null)}
          finish={async () => {
            await refresh();
          }}
        />
      )}
      <dialog
        ref={qrDialog}
        className="ca-dialog ca-qr"
        onClose={() => setQr(null)}
        aria-label="QR отправки"
      >
        {qr && (
          <>
            <h2>{qr.number}</h2>
            <p>
              {qr.bagCount} мешков/бигбегов · {kgAsTonnes(qr.weightKg)} т
            </p>
            <img src={qr.qrImage} alt="QR-код отправки" />
            <div className="ca-row-actions">
              <button className="ca-primary" onClick={() => void downloadQr()}>
                Сохранить QR
              </button>
              <button
                className="ca-secondary"
                onClick={() => printQr(qr!.qrImage)}
              >
                Распечатать
              </button>
              <button
                className="ca-secondary"
                onClick={() => {
                  qrDialog.current?.close();
                  setQr(null);
                }}
              >
                Закрыть
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
function StockTable({
  data,
  siteName,
  edit,
}: {
  data: Row;
  siteName(id: string): string;
  edit(id: string, state: string): void;
}) {
  return (
    <section className="ca-card">
      <div className="ca-card-title">
        <h2>Остатки по объектам</h2>
        <span className="ca-muted">Все значения — в тоннах</span>
      </div>
      <div className="ca-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Объект</th>
              {Object.entries(stateLabels).map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
              <th>Управление</th>
            </tr>
          </thead>
          <tbody>
            {data.locations.map((location: Row) => (
              <tr key={location.id}>
                <td>
                  <strong>{siteName(location.id)}</strong>
                  <small>
                    {location.kind === "FACTORY" ? "Завод" : "Мойка / склад"}
                    {!location.active ? " · архив" : ""}
                  </small>
                </td>
                {Object.keys(stateLabels).map((state) => (
                  <td key={state}>
                    {kgAsTonnes(stockKg(data, location.id, state))}
                  </td>
                ))}
                <td>
                  <button
                    onClick={() =>
                      edit(
                        location.id,
                        location.kind === "FACTORY" ? "WASHED" : "RAW",
                      )
                    }
                  >
                    Корректировать
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function RecentActions({
  actions,
  siteName,
  userName,
}: {
  actions: Row[];
  siteName(id: string): string;
  userName(id: string): string;
}) {
  return (
    <section className="ca-card">
      <div className="ca-card-title">
        <h2>Последние движения</h2>
      </div>
      {actions.map((a) => (
        <div className="ca-recent" key={a.id}>
          <span className="ca-site-icon">
            <ArrowUpRight size={18} />
          </span>
          <div>
            <strong>{actionLabels[a.kind] ?? a.kind}</strong>
            <small>
              {siteName(a.locationId)} · {userName(a.createdById)}
            </small>
          </div>
          <span>
            <strong>{kgAsTonnes(a.quantityKg)} т</strong>
            <small>{stamp(a.createdAt)}</small>
          </span>
        </div>
      ))}
    </section>
  );
}
function Pager({
  page,
  total,
  setPage,
}: {
  page: number;
  total: number;
  setPage(page: number): void;
}) {
  return (
    <div className="ca-pager">
      <button disabled={page === 1} onClick={() => setPage(page - 1)}>
        ← Назад
      </button>
      <span>
        {page} / {Math.max(1, Math.ceil(total / 30))}
      </span>
      <button disabled={page * 30 >= total} onClick={() => setPage(page + 1)}>
        Далее →
      </button>
    </div>
  );
}
function NoticeForm({ data }: { data: Row }) {
  const [target, setTarget] = useState("ALL");
  return (
    <>
      <Field label="Кому">
        <select
          aria-label="Кому"
          name="target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="ALL">Всем пользователям</option>
          <option value="USER">Пользователю</option>
          <option value="LOCATION">Ответственным объекта</option>
          <option value="ROLE">По роли</option>
        </select>
      </Field>
      {target === "USER" && (
        <Field label="Получатель">
          <select aria-label="Получатель" name="targetId" required>
            <option value="">Выберите пользователя</option>
            {data.users
              .filter((u: Row) => !u.isBlocked)
              .map((u: Row) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} · {u.phone}
                </option>
              ))}
          </select>
        </Field>
      )}
      {target === "LOCATION" && <SiteSelect data={data} name="targetId" />}
      {target === "ROLE" && (
        <Field label="Роль получателей">
          <select aria-label="Роль получателей" name="targetId">
            {Object.entries(roleLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Заголовок">
        <input
          aria-label="Заголовок"
          name="title"
          minLength={2}
          maxLength={140}
          required
        />
      </Field>
      <Field label="Текст сообщения">
        <textarea
          aria-label="Текст сообщения"
          name="body"
          minLength={2}
          maxLength={2000}
          required
          rows={4}
        />
      </Field>
      <Reason value="Сообщение администратора" />
    </>
  );
}
function auditTitle(action: string): string {
  const titles: Record<string, string> = {
    "user.save": "Пользователь и назначения",
    "user.block": "Изменение доступа",
    "user.password": "Смена пароля",
    "location.save": "Изменение объекта",
    "stock.set": "Корректировка остатка",
    "bags.add": "Добавление бигбегов",
    "bag.state": "Изменение бигбега",
    "trip.save": "Реквизиты рейса",
    "trip.stage": "Этап рейса",
    "trip.cancel": "Отмена рейса",
    "driver.stop": "Остановка отслеживания",
    "shipment.cancel": "Отмена отправки",
    "operation.reverse": "Отмена операции",
    "notification.send": "Уведомление администратора",
    "notification.retry": "Повторная доставка уведомления",
    settings: "Настройки регистрации",
  };
  return titles[action.replace("collection.admin.", "")] ?? action;
}
