"use client";

import {
  webRequest,
  setSession,
  clearSession,
  networkFetch,
  downloadReport,
  currentSessionId,
} from "./session";
import { CollectionPanel, DriverPanel } from "./workflow-ui";
import { NotificationWorkbench } from "./notification-workbench";
import { LabeledInput, LabeledSelect, RecordDrawer } from "./design-system";
import { ProcessingRegistry } from "./processing-registry";
import { ProcessingPanel } from "./processing-panel";
import { ControlPanel, FleetPanel } from "./control-panel";
import { Ledger } from "./ledger";
import { createCommandId } from "./command-id.mjs";
import { BioflowApiClient } from "@bioflow/api-client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Bell,
  Eye,
  EyeOff,
  Menu,
  ArrowRight,
  Boxes,
  ClipboardList,
  Factory,
  FileText,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  QrCode,
  ShieldCheck,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import { FormEvent, useMemo, useState, useEffect } from "react";
import { roleLabel, roleDescription } from "./role-labels";
import { isMobileWorkspace, mobileNotify, saveBlob } from "./mobile-bridge";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

function request<T>(
  path: string,
  token?: string,
  init?: RequestInit,
): Promise<T> {
  return webRequest<T>(path, token, init);
}

const sections = [
  ["driver", "Мои рейсы", Truck],
  ["control", "Обзор предприятия", LayoutDashboard],
  ["collection", "Сбор и отправка", Truck],
  ["processing", "Работа с партией по QR", QrCode],
  ["laboratory", "Лаборатория", ClipboardList],
  ["big-bags", "Биг-бэги и упаковка", PackageCheck],
  ["fleet", "Водители и маршруты", Truck],
  ["dashboard", "Обзор", LayoutDashboard],
  ["ledger", "Партии и операции", Boxes],
  ["waybills", "Поставки", ClipboardList],
  ["counterparties", "Контрагенты", Users],
  ["vehicles", "Транспорт", Truck],
  ["drivers", "Водители", Users],
  ["extraction-sites", "Места добычи", ClipboardList],
  ["warehouses", "Склады", Warehouse],
  ["plants", "Заводы", Factory],
  ["material-types", "Материалы", Boxes],
  ["product-types", "Продукция", PackageCheck],
  ["reference-values", "Причины и единицы", ClipboardList],
  ["inventory", "Движения", Boxes],
  ["transfers", "Перемещения", PackageCheck],
  ["write-offs", "Списания", PackageCheck],
  ["shipments", "Отгрузки", PackageCheck],
  ["washing", "Мойка", QrCode],
  ["production", "Завод", Factory],
  ["users", "Пользователи", Users],
  ["roles", "Роли", ShieldCheck],
  ["sessions", "Сессии", ShieldCheck],
  ["notifications", "Уведомления", ShieldCheck],
  ["reports", "Отчёты", FileText],
  ["audit", "Аудит", ShieldCheck],
  ["settings", "Настройки", ShieldCheck],
] as const;

const referenceFields: Record<string, Array<[string, string]>> = {
  counterparties: [
    ["name", "Название"],
    ["bin", "БИН"],
    ["phone", "Телефон"],
    ["email", "Email"],
    ["status", "Статус"],
  ],
  vehicles: [
    ["plateNumber", "Госномер"],
    ["brand", "Марка"],
    ["type", "Тип"],
    ["status", "Статус"],
    ["model", "Модель"],
    ["capacity", "Грузоподъёмность, т"],
    ["tareWeight", "Тара, т"],
  ],
  drivers: [
    ["fullName", "ФИО"],
    ["phone", "Телефон"],
  ],
  "extraction-sites": [
    ["name", "Название"],
    ["location", "Локация"],
  ],
  warehouses: [
    ["name", "Название"],
    ["address", "Адрес"],
    ["lowStockLimit", "Мин. остаток, т"],
    ["capacity", "Вместимость, т"],
    ["warehouseType", "Тип склада"],
  ],
  plants: [
    ["name", "Название"],
    ["address", "Адрес"],
  ],
  "material-types": [["name", "Название"]],
  "product-types": [["name", "Название"]],
  "reference-values": [
    ["category", "Категория"],
    ["code", "Код"],
    ["name", "Название"],
  ],
  roles: [
    ["code", "Код"],
    ["name", "Название"],
  ],
};

function Login({ onToken }: { onToken: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const login = useMutation({
    mutationFn: () =>
      request<{ accessToken: string; refreshToken: string }>(
        "/auth/login",
        undefined,
        {
          method: "POST",
          body: JSON.stringify({
            ...(email.includes("@")
              ? { email: email.trim() }
              : { phone: email.trim() }),
            password,
            platform: "web",
          }),
        },
      ),
    onSuccess: (data) => {
      setSession(data);
      onToken(data.accessToken);
    },
  });
  const forgot = useMutation({
    mutationFn: () =>
      request<any>("/auth/forgot-password", undefined, {
        method: "POST",
        body: JSON.stringify(
          email.includes("@")
            ? { email: email.trim() }
            : { phone: email.trim() },
        ),
      }),
    onSuccess: (data) =>
      setMessage(
        data.resetToken
          ? `Код восстановления: ${data.resetToken}`
          : "Для восстановления доступа обратитесь к администратору",
      ),
  });
  const reset = useMutation({
    mutationFn: () =>
      request<any>("/auth/reset-password", undefined, {
        method: "POST",
        body: JSON.stringify({ token: resetToken, newPassword }),
      }),
    onSuccess: () => setMessage("Пароль обновлён"),
  });
  return (
    <main className="login">
      <div className="login-layout">
        <section className="login-intro" aria-label="Collection">
          <div className="collection-logo">
            <img
              src="/branding/collection-symbol.png"
              alt=""
              width="52"
              height="52"
            />
            <span>collection</span>
          </div>
          <span className="eyebrow">От озера до готовой продукции</span>
          <h1>
            Всё движение.
            <br />В одной системе.
          </h1>
          <p>Войдите, чтобы продолжить работу с партиями и операциями.</p>
        </section>
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <div className="toolbar">
            <label className="login-field" htmlFor="login-email">
              Номер телефона
              <input
                id="login-email"
                type="tel"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          </div>
          <div className="toolbar">
            <label className="login-field" htmlFor="login-password">
              Пароль
              <span className="password-input">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={
                    showPassword ? "Скрыть пароль" : "Показать пароль"
                  }
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </span>
            </label>
          </div>
          <button className="button" disabled={login.isPending}>
            <ArrowRight size={20} />
            {login.isPending ? "Входим…" : "Войти"}
          </button>
          <p className="login-help">
            Не получается войти? Обратитесь к администратору.
          </p>
          <details className="login-recovery">
            <summary>Восстановить доступ</summary>
            <button
              className="button secondary"
              type="button"
              disabled={forgot.isPending || !email.trim()}
              onClick={() => forgot.mutate()}
            >
              Запросить восстановление
            </button>
            <div className="toolbar">
              <label className="login-field">
                Код восстановления
                <input
                  value={resetToken}
                  autoComplete="one-time-code"
                  onChange={(e) => setResetToken(e.target.value)}
                />
              </label>
            </div>
            <div className="toolbar">
              <label className="login-field">
                Новый пароль
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
            </div>
            <button
              className="button secondary"
              type="button"
              disabled={reset.isPending || !resetToken || !newPassword}
              onClick={() => reset.mutate()}
            >
              Сбросить пароль
            </button>
          </details>
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          {login.error && (
            <div className="error" role="alert">
              {login.error.message}
            </div>
          )}
          {(forgot.error || reset.error) && (
            <div className="error" role="alert">
              {String((forgot.error ?? reset.error)?.message)}
            </div>
          )}
        </form>
      </div>
    </main>
  );
}

function Dashboard({ token }: { token: string }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const query = new URLSearchParams({
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  }).toString();
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", token, dateFrom, dateTo],
    queryFn: () => request<any>(`/dashboard${query ? `?${query}` : ""}`, token),
  });
  const balances = data?.balances ?? [];
  if (error)
    return (
      <p className="error" role="alert">
        {error.message}
      </p>
    );
  return (
    <>
      <DateRangeControls
        dateFrom={dateFrom}
        dateTo={dateTo}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
      />
      <div className="grid">
        <Metric
          label="Всего накладных"
          value={isLoading ? "..." : (data?.waybills ?? 0)}
        />
        <Metric
          label="Активные"
          value={isLoading ? "..." : (data?.activeWaybills ?? 0)}
        />
        <Metric label="Остатки" value={isLoading ? "…" : balances.length} />
        <Metric
          label="Расхождения"
          value={isLoading ? "…" : (data?.discrepancies ?? 0)}
        />
      </div>
      <Table
        title="Остатки по складам"
        rows={balances}
        columns={["warehouse.name", "state", "quantity"]}
      />
    </>
  );
}

function DateRangeControls({
  dateFrom,
  dateTo,
  setDateFrom,
  setDateTo,
}: {
  dateFrom: string;
  dateTo: string;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
}) {
  return (
    <div className="toolbar">
      <LabeledInput
        placeholder="С даты"
        type="date"
        value={dateFrom}
        onChange={(e) => setDateFrom(e.target.value)}
      />
      <LabeledInput
        placeholder="По дату"
        type="date"
        value={dateTo}
        onChange={(e) => setDateTo(e.target.value)}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <div className="metric">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

const fieldNames: Record<string, string> = {
  number: "Номер",
  mustChangePassword: "Требуется смена пароля",
  lowStockLimit: "Минимальный остаток, т",
  DIRTY: "Сырьё",
  WASHED: "Мытое",
  FINISHED: "Готовая продукция",
  ACTIVE: "Активен",
  INACTIVE: "Неактивен",
  PARTIALLY_SHIPPED: "Частично отгружена",
  FULLY_SHIPPED: "Отгружена",
  entityId: "Объект",
  userId: "Пользователь",
  "user.fullName": "Пользователь",
  OPERATION_CONFIRMED: "Операция подтверждена",
  OPERATION_PENDING: "Ожидает подтверждения",
  WAYBILL_CREATED: "Перевозка создана",
  WAYBILL_LOADED: "Перевозка погружена",
  WAYBILL_UNLOADED: "Перевозка разгружена",
  LOW_STOCK: "Низкий остаток",
  WAREHOUSE_CAPACITY: "Вместимость склада",
  fullName: "ФИО",
  createdAt: "Дата создания",
  updatedAt: "Дата изменения",
  name: "Название",
  code: "Код",
  userRoles: "Роли",
  roleDescription: "Назначение роли",
  category: "Категория",
  email: "Email",
  phone: "Телефон",
  bin: "БИН",
  status: "Статус",
  type: "Тип",
  state: "Состояние",
  quantity: "Количество, т",
  declaredWeight: "Отправлено, т",
  receivedWeight: "Принято, т",
  plateNumber: "Госномер",
  capacity: "Вместимость, т",
  tareWeight: "Тара, т",
  brand: "Марка",
  model: "Модель",
  address: "Адрес",
  location: "Местоположение",
  key: "Параметр",
  value: "Значение",
  action: "Действие",
  entity: "Объект",
  reason: "Причина",
  isBlocked: "Заблокирован",
  archivedAt: "В архиве",
  revokedAt: "Отозвана",
  expiresAt: "Действует до",
  userAgent: "Устройство",
  ip: "IP-адрес",
  title: "Заголовок",
  body: "Сообщение",
  readAt: "Прочитано",
  "organization.name": "Организация",
  "counterparty.name": "Контрагент",
  "warehouse.name": "Склад",
  "vehicle.plateNumber": "Госномер",
  "driver.fullName": "Водитель",
  "items.summary": "Состав",
  sortBy: "Сортировка",
  desc: "По убыванию",
  asc: "По возрастанию",
};
function fieldLabel(key: string) {
  return fieldNames[key] ?? key;
}

function Table({
  title,
  rows,
  columns,
  onSelect,
}: {
  title: string;
  rows: any[];
  columns: string[];
  onSelect?: (row: any) => void;
}) {
  const read = (row: any, path: string) =>
    path.split(".").reduce((acc, key) => acc?.[key], row);
  const cell = (row: any, path: string) => {
    if (path === "roleDescription") return roleDescription(row.code);
    if (path === "userRoles")
      return (
        (row.userRoles ?? [])
          .map((entry: any) => roleLabel(entry.role))
          .join(", ") || "Роли не назначены"
      );
    if (path === "items.summary") {
      return (row.items ?? [])
        .map(
          (item: any) =>
            `${item.materialType?.name ?? item.productType?.name ?? item.materialTypeId ?? item.productTypeId}:${item.quantity}`,
        )
        .join(", ");
    }
    const value = read(row, path);
    if (Array.isArray(value)) return String(value.length);
    return value == null || value === "" ? (
      "-"
    ) : typeof value === "boolean" ? (
      value ? (
        "Да"
      ) : (
        "Нет"
      )
    ) : typeof value === "object" ? (
      JSON.stringify(value)
    ) : ["status", "state", "type"].includes(path) ? (
      <span className="status">{fieldLabel(String(value))}</span>
    ) : /At$/.test(path) && Number.isFinite(Date.parse(String(value))) ? (
      new Date(String(value)).toLocaleString("ru-RU")
    ) : (
      String(value)
    );
  };
  return (
    <section className="tableWrap" style={{ marginTop: 18 }}>
      <h2>{title}</h2>
      <div className="tableScroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {fieldLabel(c)}
                </th>
              ))}
              {onSelect && <th scope="col">Карточка</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => (
                  <td key={c}>{cell(row, c)}</td>
                ))}
                {onSelect && (
                  <td>
                    <button
                      className="button secondary"
                      onClick={() => onSelect(row)}
                    >
                      Открыть
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DataSection({ token, section }: { token: string; section: string }) {
  const me = useQuery({
    queryKey: ["currentUser", token],
    queryFn: () => request<any>("/auth/me", token),
  });
  const mayEditReferences = (me.data?.permissions ?? []).includes(
    "references.manage",
  );
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const referenceSections = [
    "counterparties",
    "vehicles",
    "drivers",
    "extraction-sites",
    "warehouses",
    "plants",
    "material-types",
    "product-types",
    "reference-values",
    "users",
    "roles",
    "settings",
  ];
  const writableReferenceSections = [
    "counterparties",
    "vehicles",
    "drivers",
    "extraction-sites",
    "warehouses",
    "plants",
    "material-types",
    "product-types",
    "reference-values",
  ];
  const pagedSections = [
    "waybills",
    "inventory",
    "audit",
    "washing",
    "production",
    "shipments",
    "write-offs",
    "transfers",
    "notifications",
    ...referenceSections,
  ];
  const searchableSections = [
    "waybills",
    "audit",
    "shipments",
    "write-offs",
    ...referenceSections,
  ];
  const statusSections = [
    "waybills",
    "audit",
    "inventory",
    "washing",
    "production",
    "shipments",
    "write-offs",
    "transfers",
  ];
  useEffect(() => {
    setPage(1);
  }, [search, status, sortBy, sortDir]);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "20",
    ...(search ? { search } : {}),
    ...(statusSections.includes(section) && status ? { status } : {}),
    ...(sortBy ? { sortBy } : {}),
    sortDir,
  });
  const suffix = params.toString();
  const path =
    section === "inventory"
      ? `/inventory/movements?${suffix}`
      : section === "washing"
        ? `/washing-batches?${suffix}`
        : section === "production"
          ? `/production-batches?${suffix}`
          : section === "reports"
            ? "/reports?type=inventory"
            : section === "sessions"
              ? "/auth/sessions"
              : `/${section}${pagedSections.includes(section) && suffix ? `?${suffix}` : ""}`;
  const { data, isLoading, error } = useQuery({
    queryKey: [section, search, status, sortBy, sortDir, page, token],
    queryFn: () => request<any>(path, token),
  });
  const rows = Array.isArray(data) ? data : (data?.rows ?? data?.data ?? []);
  const columns =
    section === "audit"
      ? ["createdAt", "action", "entity", "entityId", "user.fullName", "reason"]
      : section === "reference-values"
        ? ["category", "code", "name", "archivedAt"]
        : section === "inventory"
          ? [
              "type",
              "state",
              "quantity",
              "warehouse.name",
              "materialType.name",
              "productType.name",
              "waybill.number",
              "createdAt",
            ]
          : section === "waybills"
            ? [
                "number",
                "status",
                "declaredWeight",
                "actualWeight",
                "counterparty.name",
                "destinationWarehouse.name",
                "materialType.name",
                "createdAt",
              ]
            : section === "write-offs"
              ? [
                  "status",
                  "state",
                  "quantity",
                  "warehouse.name",
                  "materialType.name",
                  "productType.name",
                  "reason",
                  "createdAt",
                ]
              : section === "shipments"
                ? [
                    "status",
                    "quantity",
                    "warehouse.name",
                    "productType.name",
                    "recipient",
                    "documentNumber",
                    "createdAt",
                  ]
                : section === "transfers"
                  ? [
                      "status",
                      "fromWarehouse.name",
                      "toWarehouse.name",
                      "items.summary",
                      "createdAt",
                    ]
                  : section === "counterparties"
                    ? ["name", "bin", "phone", "email", "status", "createdAt"]
                    : section === "vehicles"
                      ? ["plateNumber", "brand", "type", "status"]
                      : section === "drivers"
                        ? ["fullName", "phone"]
                        : section === "warehouses"
                          ? ["name", "address", "lowStockLimit"]
                          : section === "extraction-sites" ||
                              section === "plants"
                            ? ["name", "location", "address"]
                            : section === "material-types" ||
                                section === "product-types"
                              ? ["name"]
                              : section === "users"
                                ? [
                                    "fullName",
                                    "userRoles",
                                    "email",
                                    "phone",
                                    "isBlocked",
                                    "mustChangePassword",
                                    "createdAt",
                                  ]
                                : section === "roles"
                                  ? ["name", "roleDescription"]
                                  : section === "settings"
                                    ? ["key", "value"]
                                    : [
                                        "number",
                                        "name",
                                        "status",
                                        "state",
                                        "quantity",
                                        "createdAt",
                                      ];
  if (isLoading) return <div className="card">Загрузка...</div>;
  if (error) return <div className="error">{(error as Error).message}</div>;
  if (section === "sessions")
    return <SessionActions token={token} rows={rows} />;
  if (section === "notifications")
    return <NotificationsSection token={token} rows={rows} />;
  return (
    <>
      {section === "waybills" && <WaybillActions token={token} />}
      {section === "inventory" && <CorrectionForm token={token} />}
      {section === "users" && (
        <details className="panel section-editor">
          <summary>Создать сотрудника / назначить роли</summary>
          <UserForm token={token} />
        </details>
      )}
      {section === "transfers" && <TransferForm token={token} />}
      {section === "write-offs" && <WriteOffForm token={token} />}
      {section === "shipments" && <ShipmentForm token={token} />}
      {section === "settings" && <SettingsForm token={token} />}
      {section === "washing" && <OperationForm token={token} kind="washing" />}
      {section === "production" && (
        <OperationForm token={token} kind="production" />
      )}
      {section === "reports" && <ReportExport token={token} />}
      {mayEditReferences &&
        section !== "roles" &&
        writableReferenceSections.includes(section) && (
          <details className="panel section-editor">
            <summary>Добавить запись</summary>
            <ReferenceCreateForm token={token} entity={section} />
          </details>
        )}
      {mayEditReferences &&
        section !== "roles" &&
        writableReferenceSections.includes(section) && (
          <details className="panel section-editor">
            <summary>Изменить / архивировать запись</summary>
            <ReferenceEditForm token={token} entity={section} rows={rows} />
          </details>
        )}
      {pagedSections.includes(section) && (
        <div className="toolbar">
          {searchableSections.includes(section) && (
            <LabeledInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск"
            />
          )}
          {statusSections.includes(section) && (
            <LabeledInput
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder={
                section === "inventory"
                  ? "Тип движения"
                  : section === "audit"
                    ? "Action"
                    : "Статус"
              }
            />
          )}
          <LabeledSelect
            label="Сортировать по"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="createdAt">{fieldLabel("createdAt")}</option>
            {section === "waybills" && (
              <option value="number">{fieldLabel("number")}</option>
            )}
            {section === "waybills" && (
              <option value="status">{fieldLabel("status")}</option>
            )}
            {section === "waybills" && (
              <option value="declaredWeight">
                {fieldLabel("declaredWeight")}
              </option>
            )}
            {section === "inventory" && (
              <option value="type">{fieldLabel("type")}</option>
            )}
            {section === "inventory" && (
              <option value="state">{fieldLabel("state")}</option>
            )}
            {section === "inventory" && (
              <option value="quantity">{fieldLabel("quantity")}</option>
            )}
            {section === "audit" && (
              <option value="action">{fieldLabel("action")}</option>
            )}
            {section === "audit" && (
              <option value="entity">{fieldLabel("entity")}</option>
            )}
            {(section === "washing" || section === "production") && (
              <option value="number">{fieldLabel("number")}</option>
            )}
            {(section === "washing" || section === "production") && (
              <option value="status">{fieldLabel("status")}</option>
            )}
            {(section === "washing" || section === "production") && (
              <option value="inputWeight">{fieldLabel("inputWeight")}</option>
            )}
            {(section === "washing" || section === "production") && (
              <option value="outputWeight">{fieldLabel("outputWeight")}</option>
            )}
            {section === "shipments" && (
              <option value="recipient">{fieldLabel("recipient")}</option>
            )}
            {section === "shipments" && (
              <option value="status">{fieldLabel("status")}</option>
            )}
            {section === "shipments" && (
              <option value="quantity">{fieldLabel("quantity")}</option>
            )}
            {section === "write-offs" && (
              <option value="status">{fieldLabel("status")}</option>
            )}
            {section === "write-offs" && (
              <option value="state">{fieldLabel("state")}</option>
            )}
            {section === "write-offs" && (
              <option value="quantity">{fieldLabel("quantity")}</option>
            )}
            {section === "transfers" && (
              <option value="status">{fieldLabel("status")}</option>
            )}
            {section === "counterparties" && (
              <option value="name">{fieldLabel("name")}</option>
            )}
            {section === "counterparties" && (
              <option value="status">{fieldLabel("status")}</option>
            )}
            {section === "vehicles" && (
              <option value="plateNumber">{fieldLabel("plateNumber")}</option>
            )}
            {section === "vehicles" && (
              <option value="brand">{fieldLabel("brand")}</option>
            )}
            {section === "vehicles" && (
              <option value="type">{fieldLabel("type")}</option>
            )}
            {section === "vehicles" && (
              <option value="status">{fieldLabel("status")}</option>
            )}
            {section === "drivers" && (
              <option value="fullName">{fieldLabel("fullName")}</option>
            )}
            {section === "drivers" && (
              <option value="phone">{fieldLabel("phone")}</option>
            )}
            {section === "warehouses" && (
              <option value="name">{fieldLabel("name")}</option>
            )}
            {(section === "extraction-sites" ||
              section === "plants" ||
              section === "material-types" ||
              section === "product-types") && (
              <option value="name">{fieldLabel("name")}</option>
            )}
            {section === "users" && (
              <option value="fullName">{fieldLabel("fullName")}</option>
            )}
            {section === "users" && (
              <option value="email">{fieldLabel("email")}</option>
            )}
            {section === "roles" && (
              <option value="code">{fieldLabel("code")}</option>
            )}
            {section === "roles" && (
              <option value="name">{fieldLabel("name")}</option>
            )}
            {section === "settings" && (
              <option value="key">{fieldLabel("key")}</option>
            )}
          </LabeledSelect>
          <LabeledSelect
            label="Порядок сортировки"
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value)}
          >
            <option value="desc">{fieldLabel("desc")}</option>
            <option value="asc">{fieldLabel("asc")}</option>
          </LabeledSelect>
        </div>
      )}
      <Table
        title={sections.find(([id]) => id === section)?.[1] ?? section}
        rows={rows}
        columns={columns}
        onSelect={(row) => setDetail(row)}
      />
      {!rows.length && (
        <div className="empty-state">
          <strong>
            {search || status ? "Нет совпадений" : "Записей пока нет"}
          </strong>
          {search || status
            ? "Измените фильтры или очистите поиск."
            : "Здесь будут доступны записи вашей области."}
        </div>
      )}
      {typeof data?.total === "number" && (
        <div className="toolbar">
          <button
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Назад
          </button>
          <span>
            Страница {page} из {Math.max(1, Math.ceil(data.total / 20))} · всего{" "}
            {data.total}
          </span>
          <button
            className="button secondary"
            disabled={page * 20 >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Далее
          </button>
        </div>
      )}
      {detail && (
        <RecordDrawer
          key={detail.id}
          title={
            detail.name ??
            detail.fullName ??
            detail.plateNumber ??
            "Подробности записи"
          }
          onClose={() => setDetail(null)}
        >
          <dl className="confirmation-list">
            {columns.map((key) => {
              const value = key
                .split(".")
                .reduce((v: any, k) => v?.[k], detail);
              return (
                <div key={key}>
                  <dt>{fieldLabel(key)}</dt>
                  <dd>
                    {key === "userRoles"
                      ? (detail.userRoles ?? [])
                          .map((r: any) => roleLabel(r.role))
                          .join(", ")
                      : value == null
                        ? "—"
                        : typeof value === "boolean"
                          ? value
                            ? "Да"
                            : "Нет"
                          : typeof value === "object"
                            ? "См. связанные данные"
                            : /At$/.test(key) &&
                                Number.isFinite(Date.parse(String(value)))
                              ? new Date(value).toLocaleString("ru-RU")
                              : String(value)}
                  </dd>
                </div>
              );
            })}
          </dl>
          {mayEditReferences && writableReferenceSections.includes(section) && (
            <ReferenceEditForm
              key={detail.id}
              token={token}
              entity={section}
              rows={[detail]}
              initialId={detail.id}
            />
          )}
        </RecordDrawer>
      )}
    </>
  );
}

function ReferenceCreateForm({
  token,
  entity,
}: {
  token: string;
  entity: string;
}) {
  const queryClient = useQueryClient();
  const fields = referenceFields[entity] ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: () =>
      request<any>(`/${entity}`, token, {
        method: "POST",
        body: JSON.stringify({
          data: Object.fromEntries(
            Object.entries(values).filter(([, value]) => value !== ""),
          ),
        }),
      }),
    onSuccess: () => {
      setValues({});
      setMessage("Справочник сохранён");
      queryClient.invalidateQueries({ queryKey: [entity] });
    },
  });
  if (fields.length === 0) return null;
  return (
    <section className="tableWrap">
      <h2>Создать</h2>
      <form
        className="formGrid compact"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          create.mutate(undefined, {
            onSuccess: () =>
              window.dispatchEvent(
                new CustomEvent("bioflow:saved", { detail: { form } }),
              ),
          });
        }}
      >
        {fields.map(([key, label]) => (
          <LabeledInput
            key={key}
            required={[
              "name",
              "plateNumber",
              "brand",
              "type",
              "fullName",
              "category",
              "code",
            ].includes(key)}
            value={values[key] ?? ""}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [key]: e.target.value }))
            }
            placeholder={label}
          />
        ))}
        <button className="button" disabled={create.isPending}>
          Сохранить
        </button>
      </form>
      {message && <p className="metric">{message}</p>}
      {create.error && <div className="error">{create.error.message}</div>}
    </section>
  );
}

function ReferenceEditForm({
  token,
  entity,
  rows,
  initialId,
}: {
  token: string;
  entity: string;
  rows: any[];
  initialId?: string;
}) {
  const queryClient = useQueryClient();
  const fields = referenceFields[entity] ?? [];
  const [id, setId] = useState(initialId ?? "");
  const selected = rows.find((row) => row.id === id);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map(([key]) => [
        key,
        selected?.[key] == null ? "" : String(selected[key]),
      ]),
    ),
  );
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const update = useMutation({
    mutationFn: () =>
      request<any>(`/${entity}/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          data: Object.fromEntries(
            Object.entries(values).filter(([, value]) => value !== ""),
          ),
          reason: reason || undefined,
        }),
      }),
    onSuccess: () => {
      setMessage("Справочник обновлён");
      queryClient.invalidateQueries({ queryKey: [entity] });
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      request(`/ledger/archive/${entity}/${id}`, token, {
        method: "POST",
        body: JSON.stringify({ reason, idempotencyKey: createCommandId() }),
      }),
    onSuccess: () => {
      setMessage("Запись архивирована, история сохранена");
      queryClient.invalidateQueries({ queryKey: [entity] });
    },
  });
  if (fields.length === 0 || rows.length === 0) return null;
  return (
    <section className="tableWrap">
      <h2>Редактировать</h2>
      <form
        className="formGrid compact"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          update.mutate(undefined, {
            onSuccess: () =>
              window.dispatchEvent(
                new CustomEvent("bioflow:saved", { detail: { form } }),
              ),
          });
        }}
      >
        <LabeledSelect
          label="Запись"
          value={id}
          onChange={(e) => {
            const next = rows.find((row) => row.id === e.target.value);
            setId(e.target.value);
            setValues(
              Object.fromEntries(
                fields.map(([key]) => [
                  key,
                  next?.[key] == null ? "" : String(next[key]),
                ]),
              ),
            );
          }}
        >
          <option value="">Выберите запись</option>
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name ??
                row.fullName ??
                row.plateNumber ??
                row.code ??
                row.id}
            </option>
          ))}
        </LabeledSelect>
        {fields.map(([key, label]) => (
          <LabeledInput
            key={key}
            required={[
              "name",
              "plateNumber",
              "brand",
              "type",
              "fullName",
              "category",
              "code",
            ].includes(key)}
            value={values[key] ?? ""}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [key]: e.target.value }))
            }
            placeholder={
              selected?.[key] == null ? label : `${label}: ${selected[key]}`
            }
          />
        ))}
        <LabeledInput
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина изменения"
        />
        <button className="button" disabled={update.isPending || !id}>
          Обновить
        </button>
      </form>
      {message && <p className="metric">{message}</p>}
      {[
        "counterparties",
        "vehicles",
        "drivers",
        "extraction-sites",
        "warehouses",
        "plants",
      ].includes(entity) && (
        <button
          className="button secondary"
          disabled={!id || !reason || archive.isPending}
          onClick={() => {
            if (
              window.confirm(
                "Архивировать выбранную запись? История сохранится.",
              )
            )
              archive.mutate();
          }}
        >
          Архивировать
        </button>
      )}
      {archive.error && <div className="error">{archive.error.message}</div>}
      {update.error && <div className="error">{update.error.message}</div>}
    </section>
  );
}

function CorrectionForm({ token }: { token: string }) {
  const refs = useReferenceOptions(token);
  const [state, setState] = useState("DIRTY");
  const [quantityDelta, setQuantityDelta] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: () =>
      request<any>("/inventory/corrections", token, {
        method: "POST",
        body: JSON.stringify({
          warehouseId: refs.warehouseId,
          materialTypeId:
            state === "FINISHED" ? undefined : refs.materialTypeId,
          productTypeId: state === "FINISHED" ? refs.productTypeId : undefined,
          state,
          quantityDelta,
          reason,
        }),
      }),
    onSuccess: (data) =>
      setMessage(`Корректировка проведена: ${data.movement.id}`),
  });
  return (
    <section className="tableWrap">
      <h2>Корректировка остатка</h2>
      <form
        className="formGrid compact"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          create.mutate(undefined, {
            onSuccess: () =>
              window.dispatchEvent(
                new CustomEvent("bioflow:saved", { detail: { form } }),
              ),
          });
        }}
      >
        <Select
          label="Склад"
          value={refs.warehouseId}
          setValue={refs.setWarehouseId}
          rows={refs.warehouses}
        />
        <label>
          <span className="metric">Состояние</span>
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="DIRTY">{fieldLabel("DIRTY")}</option>
            <option value="WASHED">{fieldLabel("WASHED")}</option>
            <option value="FINISHED">{fieldLabel("FINISHED")}</option>
          </select>
        </label>
        {state === "FINISHED" ? (
          <Select
            label="Продукт"
            value={refs.productTypeId}
            setValue={refs.setProductTypeId}
            rows={refs.productTypes}
          />
        ) : (
          <Select
            label="Материал"
            value={refs.materialTypeId}
            setValue={refs.setMaterialTypeId}
            rows={refs.materialTypes}
          />
        )}
        <LabeledInput
          value={quantityDelta}
          onChange={(e) => setQuantityDelta(e.target.value)}
          placeholder="Дельта веса, +/-"
        />
        <LabeledInput
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина"
        />
        <button className="button" disabled={create.isPending}>
          Провести
        </button>
      </form>
      {message && <p className="metric">{message}</p>}
      {create.error && <div className="error">{create.error.message}</div>}
    </section>
  );
}

function ShipmentForm({ token }: { token: string }) {
  const refs = useReferenceOptions(token);
  const [quantity, setQuantity] = useState("");
  const [recipient, setRecipient] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: () =>
      request<any>("/shipments", token, {
        method: "POST",
        body: JSON.stringify({
          warehouseId: refs.warehouseId,
          productTypeId: refs.productTypeId,
          quantity,
          recipient,
          documentNumber: documentNumber || undefined,
        }),
      }),
    onSuccess: (data) => setMessage(`Отгрузка проведена: ${data.id}`),
  });
  return (
    <section className="tableWrap">
      <h2>Новая отгрузка</h2>
      <form
        className="formGrid compact"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          create.mutate(undefined, {
            onSuccess: () =>
              window.dispatchEvent(
                new CustomEvent("bioflow:saved", { detail: { form } }),
              ),
          });
        }}
      >
        <Select
          label="Склад"
          value={refs.warehouseId}
          setValue={refs.setWarehouseId}
          rows={refs.warehouses}
        />
        <Select
          label="Продукт"
          value={refs.productTypeId}
          setValue={refs.setProductTypeId}
          rows={refs.productTypes}
        />
        <LabeledInput
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Вес"
        />
        <LabeledInput
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Получатель"
        />
        <LabeledInput
          value={documentNumber}
          onChange={(e) => setDocumentNumber(e.target.value)}
          placeholder="Документ"
        />
        <button className="button" disabled={create.isPending}>
          Отгрузить
        </button>
      </form>
      {message && <p className="metric">{message}</p>}
      {create.error && <div className="error">{create.error.message}</div>}
    </section>
  );
}

function NotificationsSection({ token, rows }: { token: string; rows: any[] }) {
  const client = useQueryClient();
  const [message, setMessage] = useState("");
  const markRead = useMutation({
    mutationFn: (id: string) =>
      request<any>(`/notifications/${id}/read`, token, { method: "POST" }),
    onSuccess: () => {
      setMessage("Уведомление отмечено прочитанным");
      void client.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  return (
    <section className="tableWrap">
      <h2>Уведомления</h2>
      <div className="tableScroll">
        <table>
          <thead>
            <tr>
              <th>Тип</th>
              <th>Заголовок</th>
              <th>Текст</th>
              <th>Создано</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{fieldLabel(row.type)}</td>
                <td>{row.title}</td>
                <td>{row.body}</td>
                <td>{row.createdAt}</td>
                <td>{row.readAt ? "Прочитано" : "Новое"}</td>
                <td>
                  <button
                    className="button secondary"
                    disabled={Boolean(row.readAt) || markRead.isPending}
                    onClick={() => markRead.mutate(row.id)}
                  >
                    Прочитано
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message && <p className="metric">{message}</p>}
      {markRead.error && <div className="error">{markRead.error.message}</div>}
    </section>
  );
}

function SettingsForm({ token }: { token: string }) {
  const client = useQueryClient();
  const [initialized, setInitialized] = useState(false);
  const current = useQuery({
    queryKey: ["acceptanceSetting", token],
    queryFn: () =>
      request<any>(
        "/settings?search=acceptance.differenceThresholdPercent",
        token,
      ),
  });
  const [threshold, setThreshold] = useState("3");
  useEffect(() => {
    if (!initialized && current.data) {
      setThreshold(
        String(
          current.data.data?.find(
            (x: any) => x.key === "acceptance.differenceThresholdPercent",
          )?.value ?? 3,
        ),
      );
      setInitialized(true);
    }
  }, [current.data, initialized]);
  const [reason, setReason] = useState("Обновление порога приёмки");
  const [message, setMessage] = useState("");
  const save = useMutation({
    mutationFn: () =>
      request<any>("/settings", token, {
        method: "POST",
        body: JSON.stringify({
          key: "acceptance.differenceThresholdPercent",
          value: Number(threshold),
          reason,
        }),
      }),
    onSuccess: () => {
      setMessage("Настройка сохранена");
      void client.invalidateQueries({ queryKey: ["settings"] });
      void client.invalidateQueries({ queryKey: ["acceptanceSetting"] });
    },
  });
  return (
    <section className="tableWrap">
      <h2>Настройки приёмки</h2>
      <form
        className="formGrid compact"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          save.mutate(undefined, {
            onSuccess: () =>
              window.dispatchEvent(
                new CustomEvent("bioflow:saved", { detail: { form } }),
              ),
          });
        }}
      >
        <LabeledInput
          type="number"
          required
          min={0}
          max={100}
          step="0.01"
          value={threshold}
          onChange={(e) => {
            setInitialized(true);
            setThreshold(e.target.value);
          }}
          placeholder="Порог расхождения, %"
        />
        <LabeledInput
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина изменения"
        />
        <button className="button" disabled={save.isPending}>
          Сохранить
        </button>
      </form>
      {message && <p className="metric">{message}</p>}
      {save.error && <div className="error">{save.error.message}</div>}
    </section>
  );
}

function SessionActions({ token, rows }: { token: string; rows: any[] }) {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [message, setMessage] = useState("");
  const profile = useQuery({
    queryKey: ["me", token],
    queryFn: () => request<any>("/auth/me", token),
  });
  const changePassword = useMutation({
    mutationFn: () =>
      request<any>("/auth/change-password", token, {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    onSuccess: () => window.dispatchEvent(new Event("bioflow:expired")),
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      request<any>(`/auth/sessions/${id}/revoke`, token, { method: "POST" }),
    onSuccess: (_, id) => {
      if (id === currentSessionId()) {
        window.dispatchEvent(new Event("bioflow:expired"));
        return;
      }
      setMessage("Сессия отозвана");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
  return (
    <>
      <section className="tableWrap">
        <h2>Профиль и безопасность</h2>
        <p className="metric">
          {profile.data
            ? `${profile.data.fullName} · ${profile.data.organization?.name}`
            : "Загрузка профиля..."}
        </p>
        <form
          className="formGrid compact"
          onSubmit={(e) => {
            e.preventDefault();
            if (newPassword === repeatPassword) changePassword.mutate();
          }}
        >
          <LabeledInput
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Текущий пароль"
          />
          <LabeledInput
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Новый пароль"
          />
          <LabeledInput
            type="password"
            required
            value={repeatPassword}
            onChange={(e) => {
              setRepeatPassword(e.target.value);
              e.target.setCustomValidity(
                e.target.value === newPassword ? "" : "Пароли не совпадают",
              );
            }}
            placeholder="Повторите новый пароль"
          />
          <button
            className="button"
            disabled={
              changePassword.isPending || newPassword !== repeatPassword
            }
          >
            Сменить пароль
          </button>
        </form>
        {message && <p className="metric">{message}</p>}
        {(changePassword.error || revoke.error) && (
          <div className="error">
            {String((changePassword.error ?? revoke.error)?.message)}
          </div>
        )}
      </section>
      <section className="tableWrap">
        <h2>Активные сессии</h2>
        <div className="tableScroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Создана</th>
                <th>Истекает</th>
                <th>Устройство</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.createdAt}</td>
                  <td>{row.expiresAt}</td>
                  <td>{row.device?.platform ?? ""}</td>
                  <td>{row.revokedAt ? "Отозвана" : "Активна"}</td>
                  <td>
                    <button
                      className="button secondary"
                      disabled={Boolean(row.revokedAt) || revoke.isPending}
                      onClick={() => revoke.mutate(row.id)}
                    >
                      Отозвать
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function WriteOffForm({ token }: { token: string }) {
  const refs = useReferenceOptions(token);
  const [state, setState] = useState("DIRTY");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: () =>
      request<any>("/write-offs", token, {
        method: "POST",
        body: JSON.stringify({
          warehouseId: refs.warehouseId,
          materialTypeId:
            state === "FINISHED" ? undefined : refs.materialTypeId,
          productTypeId: state === "FINISHED" ? refs.productTypeId : undefined,
          state,
          quantity,
          reason,
        }),
      }),
    onSuccess: (data) => setMessage(`Списание проведено: ${data.id}`),
  });
  return (
    <section className="tableWrap">
      <h2>Новое списание</h2>
      <form
        className="formGrid compact"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          create.mutate(undefined, {
            onSuccess: () =>
              window.dispatchEvent(
                new CustomEvent("bioflow:saved", { detail: { form } }),
              ),
          });
        }}
      >
        <Select
          label="Склад"
          value={refs.warehouseId}
          setValue={refs.setWarehouseId}
          rows={refs.warehouses}
        />
        <label>
          <span className="metric">Состояние</span>
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="DIRTY">{fieldLabel("DIRTY")}</option>
            <option value="WASHED">{fieldLabel("WASHED")}</option>
            <option value="FINISHED">{fieldLabel("FINISHED")}</option>
          </select>
        </label>
        {state === "FINISHED" ? (
          <Select
            label="Продукт"
            value={refs.productTypeId}
            setValue={refs.setProductTypeId}
            rows={refs.productTypes}
          />
        ) : (
          <Select
            label="Материал"
            value={refs.materialTypeId}
            setValue={refs.setMaterialTypeId}
            rows={refs.materialTypes}
          />
        )}
        <LabeledInput
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Вес"
        />
        <LabeledInput
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина"
        />
        <button className="button" disabled={create.isPending}>
          Списать
        </button>
      </form>
      {message && <p className="metric">{message}</p>}
      {create.error && <div className="error">{create.error.message}</div>}
    </section>
  );
}

function TransferForm({ token }: { token: string }) {
  const refs = useReferenceOptions(token);
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: () =>
      request<any>("/transfers", token, {
        method: "POST",
        body: JSON.stringify({
          fromWarehouseId,
          toWarehouseId,
          items: [
            { materialTypeId: refs.materialTypeId, state: "DIRTY", quantity },
          ],
        }),
      }),
    onSuccess: (data) => setMessage(`Перемещение создано: ${data.id}`),
  });
  const confirm = useMutation({
    mutationFn: (id: string) =>
      request<any>(`/transfers/${id}/confirm`, token, { method: "POST" }),
    onSuccess: () => setMessage("Перемещение подтверждено"),
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      request<any>(`/transfers/${id}/cancel`, token, {
        method: "POST",
        body: JSON.stringify({ reason: cancelReason }),
      }),
    onSuccess: () => setMessage("Перемещение отменено"),
  });
  return (
    <section className="tableWrap">
      <h2>Новое перемещение</h2>
      <form
        className="formGrid compact"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          create.mutate(undefined, {
            onSuccess: () =>
              window.dispatchEvent(
                new CustomEvent("bioflow:saved", { detail: { form } }),
              ),
          });
        }}
      >
        <Select
          label="Со склада"
          value={fromWarehouseId}
          setValue={setFromWarehouseId}
          rows={refs.warehouses}
        />
        <Select
          label="На склад"
          value={toWarehouseId}
          setValue={setToWarehouseId}
          rows={refs.warehouses}
        />
        <Select
          label="Материал"
          value={refs.materialTypeId}
          setValue={refs.setMaterialTypeId}
          rows={refs.materialTypes}
        />
        <LabeledInput
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Вес"
        />
        <button className="button" disabled={create.isPending}>
          Создать
        </button>
      </form>
      {message.startsWith("Перемещение создано:") && (
        <div className="formGrid compact">
          <LabeledInput
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Причина отмены"
          />
          <button
            className="button secondary"
            onClick={() =>
              confirm.mutate(message.replace("Перемещение создано: ", ""))
            }
          >
            Подтвердить
          </button>
          <button
            className="button secondary"
            disabled={!cancelReason || cancel.isPending}
            onClick={() =>
              cancel.mutate(message.replace("Перемещение создано: ", ""))
            }
          >
            Отменить
          </button>
        </div>
      )}
      {message && <p className="metric">{message}</p>}
      {(create.error || confirm.error || cancel.error) && (
        <div className="error">
          {String((create.error ?? confirm.error ?? cancel.error)?.message)}
        </div>
      )}
    </section>
  );
}

function UserForm({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: ["userChoices", token],
    queryFn: () => request<any>("/users?pageSize=100", token),
  });
  const roles = useQuery({
    queryKey: ["roleChoices", token],
    queryFn: () => request<any>("/roles?pageSize=100", token),
  });
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("123456");
  const [userId, setUserId] = useState("");
  const [roleCodes, setRoleCodes] = useState<string[]>(["AUDITOR"]);
  const [blockReason, setBlockReason] = useState("");
  const [message, setMessage] = useState("");
  function selectUser(id: string) {
    setUserId(id);
    const user = users.data?.data?.find((user: any) => user.id === id);
    setRoleCodes((user?.userRoles ?? []).map((entry: any) => entry.role.code));
  }
  const create = useMutation({
    mutationFn: () =>
      request<any>("/users", token, {
        method: "POST",
        body: JSON.stringify({
          email: email || undefined,
          phone: phone || undefined,
          fullName,
          temporaryPassword,
        }),
      }),
    onSuccess: (data) => {
      setMessage(`Пользователь создан: ${data.fullName}`);
      setTemporaryPassword("123456");
      setUserId(data.id);
      setRoleCodes(["AUDITOR"]);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["userChoices"] });
    },
  });
  const assignRoles = useMutation({
    mutationFn: () =>
      request<any>(`/users/${userId}/roles`, token, {
        method: "POST",
        body: JSON.stringify({
          roleCodes,
        }),
      }),
    onSuccess: () => {
      setMessage("Роли назначены");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["userChoices"] });
      void queryClient.invalidateQueries({ queryKey: ["currentUser", token] });
    },
  });
  const blockUser = useMutation({
    mutationFn: (blocked: boolean) =>
      request<any>(`/users/${userId}/block`, token, {
        method: "POST",
        body: JSON.stringify({ blocked, reason: blockReason }),
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["userChoices"] });
      setMessage(
        data.isBlocked
          ? "Пользователь заблокирован"
          : "Пользователь разблокирован",
      );
    },
  });
  return (
    <section className="tableWrap">
      <h2>Новый пользователь</h2>
      <p>
        Вход по номеру телефона. Временный пароль — 123456. При первом входе
        пользователь обязан сменить пароль (не менее 8 символов).
      </p>
      <form
        className="formGrid compact"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          create.mutate(undefined, {
            onSuccess: () =>
              window.dispatchEvent(
                new CustomEvent("bioflow:saved", { detail: { form } }),
              ),
          });
        }}
      >
        <LabeledInput
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="ФИО"
        />
        <LabeledInput
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />
        <LabeledInput
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Телефон"
          type="tel"
          required
        />
        <LabeledInput
          type="password"
          autoComplete="new-password"
          value={temporaryPassword}
          onChange={(e) => setTemporaryPassword(e.target.value)}
          placeholder="Временный пароль"
        />
        <button className="button" disabled={create.isPending}>
          Создать
        </button>
      </form>
      <h2>Назначить роли</h2>
      <form
        className="formGrid compact"
        onSubmit={(e) => {
          e.preventDefault();
          assignRoles.mutate();
        }}
      >
        <LabeledSelect
          label="Пользователь"
          aria-label="Пользователь"
          value={userId}
          onChange={(e) => selectUser(e.target.value)}
        >
          <option value="">Выберите пользователя</option>
          {(users.data?.data ?? []).map((user: any) => (
            <option key={user.id} value={user.id}>
              {user.fullName} · {user.email ?? user.phone}
            </option>
          ))}
        </LabeledSelect>
        <fieldset className="role-choices">
          <legend>Роли пользователя</legend>
          <p>
            Отметьте нужные роли. После назначения сохранится выбранный набор.
            Доступ к объектам задаётся отдельно.
          </p>
          {(roles.data?.data ?? []).map((role: any) => (
            <label key={role.id} className="role-choice">
              <input
                type="checkbox"
                checked={roleCodes.includes(role.code)}
                disabled={assignRoles.isPending}
                onChange={(e) =>
                  setRoleCodes((codes) =>
                    e.target.checked
                      ? [...codes, role.code]
                      : codes.filter((code) => code !== role.code),
                  )
                }
              />
              <span>
                <strong>{roleLabel(role)}</strong>
                <small>{roleDescription(role.code)}</small>
              </span>
            </label>
          ))}
          {roles.isLoading && <p>Загрузка ролей…</p>}
          {roles.error && <p role="alert">{roles.error.message}</p>}
        </fieldset>
        <button
          className="button secondary"
          disabled={
            assignRoles.isPending ||
            !userId ||
            roleCodes.length === 0 ||
            roles.isLoading ||
            !!roles.error
          }
        >
          Назначить
        </button>
      </form>
      <h2>Блокировка доступа</h2>
      <div className="formGrid compact">
        <LabeledSelect
          label="Пользователь"
          aria-label="Пользователь"
          value={userId}
          onChange={(e) => selectUser(e.target.value)}
        >
          <option value="">Выберите пользователя</option>
          {(users.data?.data ?? []).map((user: any) => (
            <option key={user.id} value={user.id}>
              {user.fullName} · {user.email ?? user.phone}
            </option>
          ))}
        </LabeledSelect>
        <LabeledInput
          value={blockReason}
          onChange={(e) => setBlockReason(e.target.value)}
          placeholder="Причина"
        />
        <button
          className="button secondary"
          disabled={blockUser.isPending || !userId || !blockReason}
          onClick={() => blockUser.mutate(true)}
        >
          Заблокировать
        </button>
        <button
          className="button secondary"
          disabled={blockUser.isPending || !userId || !blockReason}
          onClick={() => blockUser.mutate(false)}
        >
          Разблокировать
        </button>
      </div>
      {message && <p className="metric">{message}</p>}
      {(create.error || assignRoles.error || blockUser.error) && (
        <div className="error">
          {String(
            (create.error ?? assignRoles.error ?? blockUser.error)?.message,
          )}
        </div>
      )}
    </section>
  );
}

function ReportExport({ token }: { token: string }) {
  const [type, setType] = useState("inventory");
  const [format, setFormat] = useState("csv");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const reportParams = new URLSearchParams({
    type,
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  });
  const report = useQuery({
    queryKey: ["report", token, type, dateFrom, dateTo],
    queryFn: () => request<any>(`/reports?${reportParams.toString()}`, token),
  });
  async function download() {
    setStatus("Формируем файл…");
    try {
      const params = new URLSearchParams({
        type,
        format,
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
      });
      const blob = await downloadReport(`/reports/export?${params}`, token);
      setStatus("Файл сформирован. Выберите место сохранения.");
      const result = await saveBlob(blob, `collection-${type}.${format}`);
      setStatus(
        result === "cancelled"
          ? "Сохранение отменено. Файл не сохранён."
          : result === "saved"
            ? "Файл сохранён"
            : "Файл передан браузеру для скачивания",
      );
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  const rows = report.data?.rows ?? [];
  const reportColumns =
    type === "movements"
      ? [
          "type",
          "state",
          "quantity",
          "warehouse.name",
          "materialType.name",
          "productType.name",
          "waybill.number",
          "createdAt",
        ]
      : type === "inventory"
        ? [
            "state",
            "quantity",
            "warehouse.name",
            "materialType.name",
            "productType.name",
            "updatedAt",
          ]
        : type === "write-offs"
          ? [
              "status",
              "state",
              "quantity",
              "warehouse.name",
              "materialType.name",
              "productType.name",
              "reason",
              "createdAt",
            ]
          : type === "shipments"
            ? [
                "status",
                "quantity",
                "warehouse.name",
                "productType.name",
                "recipient",
                "documentNumber",
                "createdAt",
              ]
            : type === "transfers"
              ? [
                  "status",
                  "fromWarehouse.name",
                  "toWarehouse.name",
                  "items.summary",
                  "createdAt",
                ]
              : [
                  "number",
                  "status",
                  "state",
                  "quantity",
                  "inputWeight",
                  "outputWeight",
                  "createdAt",
                ];
  return (
    <>
      <section className="tableWrap">
        <h2>Отчёт</h2>
        <div className="formGrid compact">
          <LabeledSelect
            label="Тип отчёта"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="inventory">Остатки</option>
            <option value="movements">Движение материала</option>
            <option value="waybills">Поставки</option>
            <option value="discrepancies">Расхождения</option>
            <option value="washing">Мойка</option>
            <option value="production">Завод</option>
            <option value="write-offs">Списания</option>
            <option value="shipments">Отгрузки</option>
            <option value="transfers">Перемещения</option>
            <option value="audit">Журнал действий</option>
          </LabeledSelect>
          <LabeledSelect
            label="Формат файла"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
            <option value="pdf">PDF</option>
          </LabeledSelect>
          <LabeledInput
            placeholder="С даты"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <LabeledInput
            placeholder="По дату"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
          <button className="button" onClick={download}>
            Скачать отчёт
          </button>
        </div>
        <p className="metric">
          Дата: {report.data?.generatedAt ?? "..."}. Пользователь:{" "}
          {report.data?.userId ?? "..."}. Строк: {rows.length}
        </p>
        {status && <p className="metric">{status}</p>}
        {report.error && <div className="error">{report.error.message}</div>}
      </section>
      <Table title={`report:${type}`} rows={rows} columns={reportColumns} />
    </>
  );
}

function WaybillActions({ token }: { token: string }) {
  const [qrToken, setQrToken] = useState("");
  const [waybillId, setWaybillId] = useState("");
  const [waybillNumber, setWaybillNumber] = useState("");
  const [currentStatus, setCurrentStatus] = useState("");
  const [nextStatus, setNextStatus] = useState("LOADED");
  const [statusReason, setStatusReason] = useState("");
  const [message, setMessage] = useState("");
  const refs = useReferenceOptions(token);
  const create = useMutation({
    mutationFn: (body: Record<string, string>) =>
      request<any>("/waybills", token, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setQrToken(data.qrToken);
      setWaybillId(data.id);
      setCurrentStatus(data.status);
      setMessage(`Создана накладная ${data.number}`);
    },
  });
  const accept = useMutation({
    mutationFn: () =>
      request<any>(`/waybills/${waybillId}/accept`, token, {
        method: "POST",
        body: JSON.stringify({
          warehouseId: refs.warehouseId,
          actualWeight: refs.actualWeight,
          idempotencyKey: createCommandId(),
          reason: refs.reason || undefined,
        }),
      }),
    onSuccess: () => setMessage("Приёмка выполнена"),
  });
  const statusUpdate = useMutation({
    mutationFn: () =>
      request<any>(`/waybills/${waybillId}/status`, token, {
        method: "POST",
        body: JSON.stringify({
          status: nextStatus,
          reason: statusReason || undefined,
        }),
      }),
    onSuccess: (data) => {
      setCurrentStatus(data.status);
      setMessage(`Статус обновлён: ${data.status}`);
    },
  });
  async function moveToArrived() {
    const flow = ["CREATED", "LOADED", "IN_TRANSIT", "ARRIVED"];
    const start = Math.max(flow.indexOf(currentStatus), 0);
    for (const status of flow.slice(start + 1)) {
      const updated = await request<any>(
        `/waybills/${waybillId}/status`,
        token,
        { method: "POST", body: JSON.stringify({ status }) },
      );
      setCurrentStatus(updated.status);
    }
    setMessage("Накладная готова к приёмке: ARRIVED");
  }

  return (
    <section className="tableWrap">
      <h2>Операции с накладной</h2>
      <form
        className="formGrid"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            counterpartyId: refs.counterpartyId,
            extractionSiteId: refs.extractionSiteId,
            vehicleId: refs.vehicleId,
            driverId: refs.driverId,
            destinationWarehouseId: refs.warehouseId,
            materialTypeId: refs.materialTypeId,
            declaredWeight: refs.declaredWeight,
          });
        }}
      >
        <Select
          label="Контрагент"
          value={refs.counterpartyId}
          setValue={refs.setCounterpartyId}
          rows={refs.counterparties}
        />
        <Select
          label="Место добычи"
          value={refs.extractionSiteId}
          setValue={refs.setExtractionSiteId}
          rows={refs.extractionSites}
        />
        <Select
          label="Авто"
          value={refs.vehicleId}
          setValue={refs.setVehicleId}
          rows={refs.vehicles}
        />
        <Select
          label="Водитель"
          value={refs.driverId}
          setValue={refs.setDriverId}
          rows={refs.drivers}
        />
        <Select
          label="Склад"
          value={refs.warehouseId}
          setValue={refs.setWarehouseId}
          rows={refs.warehouses}
        />
        <Select
          label="Материал"
          value={refs.materialTypeId}
          setValue={refs.setMaterialTypeId}
          rows={refs.materialTypes}
        />
        <LabeledInput
          value={refs.declaredWeight}
          onChange={(e) => refs.setDeclaredWeight(e.target.value)}
          placeholder="Заявленный вес"
        />
        <button className="button" disabled={create.isPending}>
          Создать накладную
        </button>
      </form>
      <div className="formGrid compact">
        <LabeledInput
          value={waybillId}
          onChange={(e) => setWaybillId(e.target.value)}
          placeholder="ID накладной"
        />
        <LabeledInput
          value={currentStatus}
          readOnly
          placeholder="Текущий статус"
        />
        <LabeledInput
          value={qrToken}
          onChange={(e) => setQrToken(e.target.value)}
          placeholder="QR token"
        />
        <LabeledInput
          value={refs.actualWeight}
          onChange={(e) => refs.setActualWeight(e.target.value)}
          placeholder="Фактический вес"
        />
        <LabeledInput
          value={refs.reason}
          onChange={(e) => refs.setReason(e.target.value)}
          placeholder="Причина расхождения"
        />
        <button
          className="button secondary"
          onClick={() =>
            request<any>("/qr/resolve", token, {
              method: "POST",
              body: JSON.stringify({ token: qrToken }),
            }).then((data) => {
              setWaybillId(data.id);
              setCurrentStatus(data.status);
              setMessage(`QR найден: ${data.number}`);
            })
          }
        >
          Проверить QR
        </button>
        <button
          className="button secondary"
          disabled={!waybillId || statusUpdate.isPending}
          onClick={moveToArrived}
        >
          До ARRIVED
        </button>
        <button
          className="button"
          disabled={!waybillId || accept.isPending}
          onClick={() => accept.mutate()}
        >
          Принять
        </button>
      </div>
      <div className="formGrid compact">
        <LabeledInput
          value={waybillNumber}
          onChange={(e) => setWaybillNumber(e.target.value)}
          placeholder="Номер накладной"
        />
        <button
          className="button secondary"
          onClick={() =>
            request<any>(
              `/waybills/by-number/${encodeURIComponent(waybillNumber)}`,
              token,
            ).then((data) => {
              setWaybillId(data.id);
              setCurrentStatus(data.status);
              setMessage(`Накладная найдена: ${data.number}`);
            })
          }
        >
          Найти по номеру
        </button>
        <LabeledSelect
          label="Новый статус"
          value={nextStatus}
          onChange={(e) => setNextStatus(e.target.value)}
        >
          <option value="LOADED">{fieldLabel("LOADED")}</option>
          <option value="IN_TRANSIT">{fieldLabel("IN_TRANSIT")}</option>
          <option value="ARRIVED">{fieldLabel("ARRIVED")}</option>
          <option value="REJECTED">{fieldLabel("REJECTED")}</option>
          <option value="CANCELLED">{fieldLabel("CANCELLED")}</option>
        </LabeledSelect>
        <LabeledInput
          value={statusReason}
          onChange={(e) => setStatusReason(e.target.value)}
          placeholder="Причина статуса"
        />
        <button
          className="button secondary"
          disabled={!waybillId || statusUpdate.isPending}
          onClick={() => statusUpdate.mutate()}
        >
          Обновить статус
        </button>
      </div>
      <FileUploadUrlForm token={token} waybillId={waybillId} />
      {message && <p className="metric">{message}</p>}
      {(create.error || accept.error || statusUpdate.error) && (
        <div className="error">
          {String(
            (create.error ?? accept.error ?? statusUpdate.error)?.message,
          )}
        </div>
      )}
    </section>
  );
}

function FileUploadUrlForm({
  token,
  waybillId,
}: {
  token: string;
  waybillId: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  return (
    <div className="workflow-stack">
      <label className="field-control">
        Фото или документ поставки
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={busy || !waybillId}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            setMessage("");
            try {
              const upload = await request<any>("/files/upload-url", token, {
                method: "POST",
                body: JSON.stringify({
                  fileName: file.name,
                  mimeType: file.type,
                  size: file.size,
                  waybillId,
                }),
              });
              const response = await networkFetch(upload.uploadUrl, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type },
              });
              if (!response.ok)
                throw Error("Не удалось загрузить файл. Повторите попытку.");
              await request(`/files/${upload.file.id}/complete`, token, {
                method: "POST",
                body: "{}",
              });
              setMessage(`Загружено: ${file.name}`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {!waybillId && <p className="metric">Сначала выберите поставку.</p>}
      {busy && <p role="status">Загружаем документ…</p>}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}

function OperationForm({
  token,
  kind,
}: {
  token: string;
  kind: "washing" | "production";
}) {
  const refs = useReferenceOptions(token);
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const path =
        kind === "washing" ? "/washing-batches" : "/production-batches";
      return request(path, token, {
        method: "POST",
        body: JSON.stringify({
          warehouseId: refs.warehouseId,
          productTypeId: refs.productTypeId,
          inputWeight: refs.inputWeight,
          outputWeight: refs.outputWeight,
          wasteWeight: refs.wasteWeight,
          lossWeight: refs.lossWeight,
        }),
      });
    },
    onSuccess: () => setMessage("Операция проведена"),
  });
  return (
    <section className="tableWrap">
      <h2>{kind === "washing" ? "Новая мойка" : "Новое производство"}</h2>
      <form className="formGrid" onSubmit={(event) => mutation.mutate(event)}>
        <Select
          label="Склад"
          value={refs.warehouseId}
          setValue={refs.setWarehouseId}
          rows={refs.warehouses}
        />
        {kind === "production" && (
          <Select
            label="Продукт"
            value={refs.productTypeId}
            setValue={refs.setProductTypeId}
            rows={refs.productTypes}
          />
        )}
        <LabeledInput
          value={refs.inputWeight}
          onChange={(e) => refs.setInputWeight(e.target.value)}
          placeholder="Входной вес"
        />
        <LabeledInput
          value={refs.outputWeight}
          onChange={(e) => refs.setOutputWeight(e.target.value)}
          placeholder="Выходной вес"
        />
        <LabeledInput
          value={refs.wasteWeight}
          onChange={(e) => refs.setWasteWeight(e.target.value)}
          placeholder="Отходы"
        />
        <LabeledInput
          value={refs.lossWeight}
          onChange={(e) => refs.setLossWeight(e.target.value)}
          placeholder="Потери"
        />
        <button className="button" disabled={mutation.isPending}>
          Провести
        </button>
      </form>
      {message && <p className="metric">{message}</p>}
      {mutation.error && <div className="error">{mutation.error.message}</div>}
    </section>
  );
}

function Select({
  label,
  value,
  setValue,
  rows,
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  rows: any[];
}) {
  return (
    <label>
      <span className="metric">{label}</span>
      <select value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">Выберите</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name ?? row.fullName ?? row.plateNumber ?? row.id}
          </option>
        ))}
      </select>
    </label>
  );
}

function useReferenceOptions(token: string) {
  const [counterpartyId, setCounterpartyId] = useState("");
  const [extractionSiteId, setExtractionSiteId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [materialTypeId, setMaterialTypeId] = useState("");
  const [productTypeId, setProductTypeId] = useState("");
  const [declaredWeight, setDeclaredWeight] = useState("");
  const [actualWeight, setActualWeight] = useState("");
  const [inputWeight, setInputWeight] = useState("");
  const [outputWeight, setOutputWeight] = useState("");
  const [wasteWeight, setWasteWeight] = useState("");
  const [lossWeight, setLossWeight] = useState("");
  const [reason, setReason] = useState("");
  const query = (key: string) =>
    useQuery({
      queryKey: [key, token],
      queryFn: () => request<any>(`/${key}`, token),
      select: (data) => data.data ?? [],
    });
  const counterparties = query("counterparties").data ?? [];
  const extractionSites = query("extraction-sites").data ?? [];
  const vehicles = query("vehicles").data ?? [];
  const drivers = query("drivers").data ?? [];
  const warehouses = query("warehouses").data ?? [];
  const materialTypes = query("material-types").data ?? [];
  const productTypes = query("product-types").data ?? [];
  return {
    counterpartyId,
    setCounterpartyId,
    extractionSiteId,
    setExtractionSiteId,
    vehicleId,
    setVehicleId,
    driverId,
    setDriverId,
    warehouseId,
    setWarehouseId,
    materialTypeId,
    setMaterialTypeId,
    productTypeId,
    setProductTypeId,
    declaredWeight,
    setDeclaredWeight,
    actualWeight,
    setActualWeight,
    inputWeight,
    setInputWeight,
    outputWeight,
    setOutputWeight,
    wasteWeight,
    setWasteWeight,
    lossWeight,
    setLossWeight,
    reason,
    setReason,
    counterparties,
    extractionSites,
    vehicles,
    drivers,
    warehouses,
    materialTypes,
    productTypes,
  };
}

function ForcePassword({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const [currentPassword, setCurrent] = useState(""),
    [newPassword, setNew] = useState(""),
    [repeatPassword, setRepeatPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      request("/auth/change-password", token, {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    onSuccess: onDone,
  });
  return (
    <main className="login">
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <h1>Смените временный пароль</h1>
        <p>Для начала работы установите свой пароль.</p>
        <LabeledInput
          type="password"
          required
          autoComplete="current-password"
          placeholder="Текущий пароль"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <LabeledInput
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Новый пароль"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
        <LabeledInput
          type="password"
          required
          autoComplete="new-password"
          placeholder="Повторите новый пароль"
          value={repeatPassword}
          onChange={(e) => {
            setRepeatPassword(e.target.value);
            e.currentTarget.setCustomValidity(
              e.target.value === newPassword ? "" : "Пароли не совпадают",
            );
          }}
        />
        <button
          className="button"
          disabled={mutation.isPending || repeatPassword !== newPassword}
        >
          Сохранить и войти заново
        </button>
        {mutation.error && (
          <div className="error">{mutation.error.message}</div>
        )}
      </form>
    </main>
  );
}

function App() {
  const dirty = useMemo(
    () => ({
      forms: new Set<Element>(),
      get value() {
        for (const form of this.forms)
          if (!form.isConnected) this.forms.delete(form);
        return this.forms.size > 0;
      },
      set value(value: boolean) {
        if (!value) this.forms.clear();
      },
    }),
    [],
  );
  const navigation = useMemo(() => ({ index: 0, restoring: false }), []);
  const discardChanges = () =>
    !dirty.value ||
    window.confirm("Есть несохранённые изменения. Покинуть форму?");
  useEffect(() => {
    const change = (e: Event) => {
      const form = (e.target as HTMLElement).closest("form, .formGrid");
      if (form) dirty.forms.add(form);
    };
    const saved = (event: Event) => {
      const form = (event as CustomEvent<{ form?: Element }>).detail?.form;
      if (form) dirty.forms.delete(form);
    };
    const navigate = (e: Event) => {
      const container = (e as CustomEvent).detail?.container as
        Element | undefined;
      const affected = container
        ? [...dirty.forms].filter((form) => container.contains(form))
        : [...dirty.forms].filter((form) => form.isConnected);
      if (
        affected.length &&
        !window.confirm("Есть несохранённые изменения. Покинуть форму?")
      )
        e.preventDefault();
      else affected.forEach((form) => dirty.forms.delete(form));
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.value) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("input", change);
    document.addEventListener("change", change);
    window.addEventListener("bioflow:navigate", navigate);
    window.addEventListener("bioflow:saved", saved);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("input", change);
      document.removeEventListener("change", change);
      window.removeEventListener("bioflow:navigate", navigate);
      window.removeEventListener("bioflow:saved", saved);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty]);
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [initialQr, setInitialQr] = useState<{
    token: string;
    nonce: number;
  }>();
  useEffect(() => {
    if (!isMobileWorkspace()) return;
    document.documentElement.dataset.mobileApp = "true";
    const receive = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (
        !data ||
        typeof data.accessToken !== "string" ||
        typeof data.refreshToken !== "string"
      )
        return;
      void queryClient.cancelQueries();
      queryClient.clear();
      dirty.value = false;
      setSession(data);
      setSection(
        sections.some(([id]) => id === data.section)
          ? data.section
          : "dashboard",
      );
      if (typeof data.qr === "string" && data.qr.length <= 512)
        setInitialQr({ token: data.qr, nonce: Date.now() });
      setToken(data.accessToken);
    };
    const partyQr = (event: Event) => {
      const qr = (event as CustomEvent).detail;
      if (typeof qr === "string" && qr.length <= 512) {
        setInitialQr({ token: qr, nonce: Date.now() });
        setSection("processing");
      }
    };
    window.addEventListener("bioflow:party-qr", partyQr);
    window.addEventListener("bioflow:mobile-login", receive);
    mobileNotify({ action: "ready" });
    return () => {
      window.removeEventListener("bioflow:party-qr", partyQr);
      window.removeEventListener("bioflow:mobile-login", receive);
      delete document.documentElement.dataset.mobileApp;
    };
  }, [queryClient, dirty]);
  useEffect(() => {
    const expire = () => {
      void queryClient.cancelQueries();
      queryClient.clear();
      clearSession();
      dirty.value = false;
      setSection("dashboard");
      setToken("");
    };
    window.addEventListener("bioflow:expired", expire);
    return () => window.removeEventListener("bioflow:expired", expire);
  }, [queryClient, dirty]);

  const profile = useQuery({
    queryKey: ["currentUser", token],
    queryFn: () => request<any>("/auth/me", token),
    enabled: !!token,
  });
  useEffect(() => {
    if (profile.data)
      mobileNotify({
        action: "profileReady",
        userId: profile.data.id,
        sections: sections
          .filter(([id]) => allowed(id))
          .map(([id, title]) => ({ id, title })),
      });
  }, [profile.data]);
  useEffect(() => {
    localStorage.removeItem("token");
  }, []);
  const permissions: string[] = profile.data?.permissions ?? [];
  const [section, setSection] = useState("dashboard");
  const [mobileMenu, setMobileMenu] = useState(false);
  const allowed = (id: string): boolean =>
    id === "driver"
      ? permissions.includes("tracking.write") &&
        !!profile.data?.roles?.includes("DRIVER")
      : id === "control"
        ? permissions.includes("processing.overview")
        : id === "collection"
          ? permissions.includes("collection.manage")
          : ["processing", "laboratory", "big-bags"].includes(id)
            ? permissions.includes("processing.read")
            : id === "fleet"
              ? permissions.includes("tracking.read")
              : id === "plants"
                ? permissions.includes("references.read") &&
                  !!profile.data?.accessAllObjects
                : id === "audit"
                  ? permissions.includes("audit.read") &&
                    !!profile.data?.accessAllObjects
                  : id === "dashboard"
                    ? permissions.includes("dashboard.read") &&
                      !!profile.data?.accessAllObjects
                    : id === "settings"
                      ? permissions.includes("references.manage")
                      : [
                            "ledger",
                            "waybills",
                            "inventory",
                            "transfers",
                            "write-offs",
                            "shipments",
                            "washing",
                            "production",
                          ].includes(id)
                        ? permissions.includes("inventory.read")
                        : id === "reports"
                          ? permissions.includes("reports.read")
                          : id === "notifications"
                            ? permissions.includes("notifications.read")
                            : id === "sessions"
                              ? true
                              : [
                                    "users",
                                    "roles",
                                    "settings",
                                    "audit",
                                  ].includes(id)
                                ? permissions.includes(
                                    id === "audit"
                                      ? "audit.read"
                                      : "users.manage",
                                  )
                                : permissions.includes("references.read");
  useEffect(() => {
    if (profile.data && !allowed(section))
      setSection(sections.find(([id]) => allowed(id))?.[0] ?? "sessions");
  }, [profile.data, section]);
  useEffect(() => {
    window.history.replaceState(
      { ...window.history.state, bioflowIndex: navigation.index },
      "",
    );
    const onBack = (event: PopStateEvent) => {
      if (navigation.restoring) {
        navigation.restoring = false;
        return;
      }
      const index =
        typeof event.state?.bioflowIndex === "number"
          ? event.state.bioflowIndex
          : 0;
      const next = window.location.hash.slice(1);
      if (
        dirty.value &&
        !window.confirm("Есть несохранённые изменения. Покинуть форму?")
      ) {
        navigation.restoring = true;
        window.history.go(navigation.index - index);
        return;
      }
      dirty.value = false;
      navigation.index = index;
      if (sections.some(([id]) => id === next)) setSection(next);
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);
  useEffect(() => {
    if (token)
      window.history.replaceState(window.history.state, "", `#${section}`);
  }, [section, token]);
  const navigate = (id: string) => {
    setMobileMenu(false);
    if (id === section) return;
    if (!discardChanges()) return;
    dirty.value = false;
    setSection(id);
    navigation.index++;
    window.history.pushState({ bioflowIndex: navigation.index }, "", `#${id}`);
  };
  const title = sections.find(([id]) => id === section)?.[1] ?? "Обзор";
  useEffect(() => {
    if (!isMobileWorkspace()) return;
    const change = (event: Event) => {
      const id = (event as CustomEvent).detail;
      if (sections.some(([key]) => key === id) && allowed(id)) navigate(id);
    };
    window.addEventListener("bioflow:mobile-section", change);
    return () => window.removeEventListener("bioflow:mobile-section", change);
  });
  if (!token)
    return (
      <Login
        onToken={(next) => {
          void queryClient.cancelQueries();
          queryClient.clear();
          setSection("control");
          setToken(next);
        }}
      />
    );
  if (!profile.data)
    return (
      <p role="status">
        {profile.error
          ? "Не удалось загрузить профиль. Обновите страницу."
          : "Загрузка профиля…"}
      </p>
    );
  if (profile.data?.mustChangePassword)
    return (
      <ForcePassword
        token={token}
        onDone={() => {
          clearSession();
          setToken("");
        }}
      />
    );
  return (
    <div className="shell">
      <aside
        className="sidebar"
        data-mobile-menu={mobileMenu ? "open" : "closed"}
      >
        <div className="brand collection-logo">
          <img
            src="/branding/collection-symbol.png"
            alt=""
            width="40"
            height="40"
          />
          <span>collection</span>
        </div>
        <button
          className="button secondary menu-toggle"
          onClick={() => setMobileMenu((v) => !v)}
          aria-expanded={mobileMenu}
          aria-label="Открыть меню"
        >
          <Menu size={20} /> Меню
        </button>
        <div className="workspace-label">
          <Factory size={22} />
          <div>
            <strong>Collection</strong>
            <small>Управление предприятием</small>
          </div>
        </div>
        <nav className="nav" aria-label="Разделы рабочего пространства">
          {[
            {
              title: "Рабочее пространство",
              ids: [
                "control",
                "dashboard",
                "driver",
                "collection",
                "processing",
                "laboratory",
                "big-bags",
                "fleet",
                "ledger",
                "waybills",
                "inventory",
                "washing",
                "production",
                "shipments",
                "reports",
              ],
            },
            {
              title: "Складские операции",
              ids: ["transfers", "write-offs", "warehouses"],
            },
            {
              title: "Справочники",
              ids: [
                "counterparties",
                "vehicles",
                "drivers",
                "extraction-sites",
                "plants",
                "material-types",
                "product-types",
                "reference-values",
              ],
            },
            {
              title: "Управление",
              ids: [
                "users",
                "roles",
                "notifications",
                "audit",
                "settings",
                "sessions",
              ],
            },
          ].map((group) => {
            const items = sections.filter(
              ([id]) => group.ids.includes(id) && allowed(id),
            );
            if (!items.length) return null;
            const buttons = items.map(([id, label, Icon]) => (
              <button
                key={id}
                className={section === id ? "active" : ""}
                aria-current={section === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={20} />
                {label}
              </button>
            ));
            return group.title === "Справочники" ||
              group.title === "Складские операции" ? (
              <details
                key={group.title}
                className="nav-group"
                open={items.some(([id]) => id === section) || undefined}
              >
                <summary className="nav-heading">{group.title}</summary>
                {buttons}
              </details>
            ) : (
              <div key={group.title} className="nav-group">
                <p className="nav-heading">{group.title}</p>
                {buttons}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-profile">
          <span className="avatar" aria-hidden="true">
            {String(profile.data.fullName ?? "C")
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((x) => x[0])
              .join("")}
          </span>
          <div>
            <strong>{profile.data.fullName}</strong>
            <small>
              {(profile.data.roles ?? [])
                .map((code: string) => roleLabel({ code }))
                .join(", ") || "Роли не назначены"}
            </small>
          </div>
        </div>
      </aside>
      <main className="main" id="workspace-main">
        <header className="workspace-topbar">
          <div className="breadcrumb">
            Рабочее пространство <span aria-hidden="true"> / </span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            {allowed("notifications") && (
              <button
                className="icon-button"
                aria-label="Открыть уведомления"
                onClick={() => navigate("notifications")}
              >
                <Bell size={21} />
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Мои сессии и профиль"
              onClick={() => navigate("sessions")}
            >
              <Users size={20} />
            </button>
          </div>
        </header>
        <div className="workspace-content">
          <div className="topbar">
            <div>
              <h1 className="title">{title}</h1>
              <p className="section-subtitle">
                {section === "control" || section === "dashboard"
                  ? "Движение сырья и продукции · фактические данные предприятия"
                  : "Партии, операции и доступные действия вашей роли"}
              </p>
            </div>
            <button
              className="button secondary"
              onClick={async () => {
                if (!discardChanges()) return;
                dirty.value = false;
                await request("/auth/logout-all", token, {
                  method: "POST",
                  body: "{}",
                }).catch(() => {});
                void queryClient.cancelQueries();
                queryClient.clear();
                mobileNotify({ action: "signedOut" });
                clearSession();
                setSection("dashboard");
                setToken("");
              }}
            >
              <LogOut size={16} /> Выйти
            </button>
          </div>
          {!allowed(section) ? (
            <p>Загрузка доступного раздела…</p>
          ) : section === "driver" ? (
            <DriverPanel token={token} />
          ) : section === "control" ? (
            <ControlPanel token={token} />
          ) : section === "collection" ? (
            <CollectionPanel token={token} />
          ) : section === "processing" ? (
            <ProcessingPanel
              token={token}
              permissions={permissions}
              initialQr={initialQr}
            />
          ) : section === "laboratory" || section === "big-bags" ? (
            <ProcessingRegistry
              key={section}
              token={token}
              permissions={permissions}
              mode={section === "laboratory" ? "laboratory" : "bags"}
            />
          ) : section === "fleet" ? (
            <FleetPanel token={token} />
          ) : section === "notifications" ? (
            <NotificationWorkbench
              token={token}
              onFleet={allowed("fleet") ? () => navigate("fleet") : undefined}
            />
          ) : section === "dashboard" ? (
            <Dashboard token={token} />
          ) : [
              "ledger",
              "waybills",
              "inventory",
              "transfers",
              "write-offs",
              "shipments",
              "washing",
              "production",
              "reports",
            ].includes(section) ? (
            <Ledger
              key={section}
              token={token}
              initialKind={
                (
                  {
                    transfers: "TRANSFER",
                    "write-offs": "WRITE_OFF",
                    shipments: "SHIPMENT",
                    washing: "WASHING",
                    production: "PRODUCTION",
                  } as Record<string, string>
                )[section]
              }
              initialTab={
                section === "waybills"
                  ? "waybills"
                  : section === "inventory"
                    ? "stocks"
                    : section === "reports"
                      ? "reports"
                      : [
                            "transfers",
                            "write-offs",
                            "shipments",
                            "washing",
                            "production",
                          ].includes(section)
                        ? "operations"
                        : "batches"
              }
            />
          ) : (
            <DataSection
              key={`${section}:${token}`}
              token={token}
              section={section}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default function Page() {
  const client = useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  );
}
