"use client";

import {
  webRequest,
  setSession,
  clearSession,
  currentSessionId,
} from "./session";
import { Ledger } from "./ledger";
import { BioflowApiClient } from "@bioflow/api-client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
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

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

function request<T>(
  path: string,
  token?: string,
  init?: RequestInit,
): Promise<T> {
  return webRequest<T>(path, token, init);
}

const sections = [
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
  ["production", "Производство", Factory],
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
          body: JSON.stringify({ email, password, platform: "web" }),
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
        body: JSON.stringify({ email }),
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
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <h1>BIOFLOW</h1>
        <p className="metric">Вход в систему контроля биоматериала</p>
        <div className="toolbar">
          <label className="login-field" htmlFor="login-email">
            Электронная почта
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>
        <div className="toolbar">
          <label className="login-field" htmlFor="login-password">
            Пароль
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>
        <button className="button" disabled={login.isPending}>
          Войти
        </button>
        <div className="toolbar">
          <button
            className="button secondary"
            type="button"
            disabled={forgot.isPending}
            onClick={() => forgot.mutate()}
          >
            Восстановить доступ
          </button>
        </div>
        <div className="toolbar">
          <input
            value={resetToken}
            onChange={(e) => setResetToken(e.target.value)}
            placeholder="Код восстановления"
          />
        </div>
        <div className="toolbar">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Новый пароль"
          />
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={reset.isPending || !resetToken || !newPassword}
          onClick={() => reset.mutate()}
        >
          Сбросить пароль
        </button>
        {message && <p className="metric">{message}</p>}
        {login.error && <div className="error">{login.error.message}</div>}
        {(forgot.error || reset.error) && (
          <div className="error">
            {String((forgot.error ?? reset.error)?.message)}
          </div>
        )}
      </form>
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
        <Metric label="Остатки" value={balances.length} />
        <Metric label="Расхождения" value={data?.discrepancies ?? 0} />
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
      <input
        type="date"
        value={dateFrom}
        onChange={(e) => setDateFrom(e.target.value)}
      />
      <input
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
}: {
  title: string;
  rows: any[];
  columns: string[];
}) {
  const read = (row: any, path: string) =>
    path.split(".").reduce((acc, key) => acc?.[key], row);
  const cell = (row: any, path: string) => {
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
    return value == null || value === ""
      ? "-"
      : typeof value === "boolean"
        ? value
          ? "Да"
          : "Нет"
        : typeof value === "object"
          ? JSON.stringify(value)
          : ["status", "state", "type"].includes(path)
            ? fieldLabel(String(value))
            : String(value);
  };
  return (
    <section className="tableWrap" style={{ marginTop: 18 }}>
      <h2>{title}</h2>
      <div className="tableScroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{fieldLabel(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => (
                  <td key={c}>{cell(row, c)}</td>
                ))}
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
  const params = new URLSearchParams({
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
    queryKey: [section, search, status, sortBy, sortDir, token],
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
                                    "email",
                                    "phone",
                                    "isBlocked",
                                    "mustChangePassword",
                                    "createdAt",
                                  ]
                                : section === "roles"
                                  ? ["code", "name"]
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
      {section === "users" && <UserForm token={token} />}
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
          <ReferenceCreateForm token={token} entity={section} />
        )}
      {mayEditReferences &&
        section !== "roles" &&
        writableReferenceSections.includes(section) && (
          <ReferenceEditForm token={token} entity={section} rows={rows} />
        )}
      {pagedSections.includes(section) && (
        <div className="toolbar">
          {searchableSections.includes(section) && (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск"
            />
          )}
          {statusSections.includes(section) && (
            <input
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
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
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
          </select>
          <select value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
            <option value="desc">{fieldLabel("desc")}</option>
            <option value="asc">{fieldLabel("asc")}</option>
          </select>
        </div>
      )}
      <Table
        title={sections.find(([id]) => id === section)?.[1] ?? section}
        rows={rows}
        columns={columns}
      />
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
          create.mutate();
        }}
      >
        {fields.map(([key, label]) => (
          <input
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
}: {
  token: string;
  entity: string;
  rows: any[];
}) {
  const queryClient = useQueryClient();
  const fields = referenceFields[entity] ?? [];
  const [id, setId] = useState("");
  const selected = rows.find((row) => row.id === id);
  const [values, setValues] = useState<Record<string, string>>({});
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
        body: JSON.stringify({ reason, idempotencyKey: crypto.randomUUID() }),
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
          update.mutate();
        }}
      >
        <select
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
        </select>
        {fields.map(([key, label]) => (
          <input
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
        <input
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
  const [quantityDelta, setQuantityDelta] = useState("10");
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
          create.mutate();
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
        <input
          value={quantityDelta}
          onChange={(e) => setQuantityDelta(e.target.value)}
          placeholder="Дельта веса, +/-"
        />
        <input
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
  const [quantity, setQuantity] = useState("10");
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
          create.mutate();
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
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Вес"
        />
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Получатель"
        />
        <input
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
          save.mutate();
        }}
      >
        <input
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
        <input
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
            changePassword.mutate();
          }}
        >
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Текущий пароль"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Новый пароль"
          />
          <button className="button" disabled={changePassword.isPending}>
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
  const [quantity, setQuantity] = useState("10");
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
          create.mutate();
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
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Вес"
        />
        <input
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
  const [quantity, setQuantity] = useState("10");
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
          create.mutate();
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
        <input
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
          <input
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
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [userId, setUserId] = useState("");
  const [roleCodes, setRoleCodes] = useState("AUDITOR");
  const [blockReason, setBlockReason] = useState("");
  const [message, setMessage] = useState("");
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
      setTemporaryPassword("");
      setUserId(data.id);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["userChoices"] });
    },
  });
  const assignRoles = useMutation({
    mutationFn: () =>
      request<any>(`/users/${userId}/roles`, token, {
        method: "POST",
        body: JSON.stringify({
          roleCodes: roleCodes
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
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
      <form
        className="formGrid compact"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="ФИО"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Телефон"
        />
        <input
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
        <select
          aria-label="Пользователь"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          <option value="">Выберите пользователя</option>
          {(users.data?.data ?? []).map((user: any) => (
            <option key={user.id} value={user.id}>
              {user.fullName} · {user.email ?? user.phone}
            </option>
          ))}
        </select>
        <input
          value={roleCodes}
          onChange={(e) => setRoleCodes(e.target.value)}
          placeholder="Роли через запятую"
        />
        <button className="button secondary" disabled={assignRoles.isPending}>
          Назначить
        </button>
      </form>
      <h2>Блокировка доступа</h2>
      <div className="formGrid compact">
        <select
          aria-label="Пользователь"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          <option value="">Выберите пользователя</option>
          {(users.data?.data ?? []).map((user: any) => (
            <option key={user.id} value={user.id}>
              {user.fullName} · {user.email ?? user.phone}
            </option>
          ))}
        </select>
        <input
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
    const params = new URLSearchParams({
      type,
      format,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    });
    const res = await fetch(`${apiUrl}/reports/export?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setStatus(await res.text());
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bioflow-${type}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`${format.toUpperCase()} сформирован`);
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
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="inventory">Остатки</option>
            <option value="movements">Движение материала</option>
            <option value="waybills">Поставки</option>
            <option value="discrepancies">Расхождения</option>
            <option value="washing">Мойка</option>
            <option value="production">Производство</option>
            <option value="write-offs">Списания</option>
            <option value="shipments">Отгрузки</option>
            <option value="transfers">Перемещения</option>
            <option value="audit">Журнал действий</option>
          </select>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
            <option value="pdf">PDF</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <input
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
          idempotencyKey: crypto.randomUUID(),
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
        <input
          value={refs.declaredWeight}
          onChange={(e) => refs.setDeclaredWeight(e.target.value)}
          placeholder="Заявленный вес"
        />
        <button className="button" disabled={create.isPending}>
          Создать накладную
        </button>
      </form>
      <div className="formGrid compact">
        <input
          value={waybillId}
          onChange={(e) => setWaybillId(e.target.value)}
          placeholder="ID накладной"
        />
        <input value={currentStatus} readOnly placeholder="Текущий статус" />
        <input
          value={qrToken}
          onChange={(e) => setQrToken(e.target.value)}
          placeholder="QR token"
        />
        <input
          value={refs.actualWeight}
          onChange={(e) => refs.setActualWeight(e.target.value)}
          placeholder="Фактический вес"
        />
        <input
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
        <input
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
        <select
          value={nextStatus}
          onChange={(e) => setNextStatus(e.target.value)}
        >
          <option value="LOADED">{fieldLabel("LOADED")}</option>
          <option value="IN_TRANSIT">{fieldLabel("IN_TRANSIT")}</option>
          <option value="ARRIVED">{fieldLabel("ARRIVED")}</option>
          <option value="REJECTED">{fieldLabel("REJECTED")}</option>
          <option value="CANCELLED">{fieldLabel("CANCELLED")}</option>
        </select>
        <input
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
  const [fileName, setFileName] = useState("");
  const [mimeType, setMimeType] = useState("application/pdf");
  const [size, setSize] = useState("1024");
  const [result, setResult] = useState("");
  const create = useMutation({
    mutationFn: () =>
      request<any>("/files/upload-url", token, {
        method: "POST",
        body: JSON.stringify({
          fileName,
          mimeType,
          size: Number(size),
          waybillId: waybillId || undefined,
        }),
      }),
    onSuccess: (data) => setResult(`PUT ${data.uploadUrl}`),
  });
  return (
    <div className="formGrid compact">
      <input
        value={fileName}
        onChange={(e) => setFileName(e.target.value)}
        placeholder="Файл для накладной"
      />
      <select value={mimeType} onChange={(e) => setMimeType(e.target.value)}>
        <option value="application/pdf">PDF</option>
        <option value="image/jpeg">JPEG</option>
        <option value="image/png">PNG</option>
        <option value="image/webp">WEBP</option>
      </select>
      <input
        value={size}
        onChange={(e) => setSize(e.target.value)}
        placeholder="Размер, байт"
      />
      <button
        className="button secondary"
        disabled={create.isPending || !fileName}
        onClick={() => create.mutate()}
      >
        URL загрузки
      </button>
      {result && <p className="metric">{result}</p>}
      {create.error && <div className="error">{create.error.message}</div>}
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
        <input
          value={refs.inputWeight}
          onChange={(e) => refs.setInputWeight(e.target.value)}
          placeholder="Входной вес"
        />
        <input
          value={refs.outputWeight}
          onChange={(e) => refs.setOutputWeight(e.target.value)}
          placeholder="Выходной вес"
        />
        <input
          value={refs.wasteWeight}
          onChange={(e) => refs.setWasteWeight(e.target.value)}
          placeholder="Отходы"
        />
        <input
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
  const [declaredWeight, setDeclaredWeight] = useState("1000");
  const [actualWeight, setActualWeight] = useState("1000");
  const [inputWeight, setInputWeight] = useState("100");
  const [outputWeight, setOutputWeight] = useState("90");
  const [wasteWeight, setWasteWeight] = useState("5");
  const [lossWeight, setLossWeight] = useState("5");
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
    [newPassword, setNew] = useState("");
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
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Текущий пароль"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Новый пароль"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
        <button className="button" disabled={mutation.isPending}>
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
      if (
        dirty.value &&
        !window.confirm("Есть несохранённые изменения. Покинуть форму?")
      )
        e.preventDefault();
      else dirty.value = false;
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
    localStorage.removeItem("token");
  }, []);
  const permissions: string[] = profile.data?.permissions ?? [];
  const [section, setSection] = useState("dashboard");
  const allowed = (id: string): boolean =>
    id === "plants"
      ? permissions.includes("references.read") &&
        !!profile.data?.accessAllObjects
      : id === "audit"
        ? permissions.includes("audit.read") && !!profile.data?.accessAllObjects
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
                    : ["users", "roles", "settings", "audit"].includes(id)
                      ? permissions.includes(
                          id === "audit" ? "audit.read" : "users.manage",
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
    if (id === section) return;
    if (!discardChanges()) return;
    dirty.value = false;
    setSection(id);
    navigation.index++;
    window.history.pushState({ bioflowIndex: navigation.index }, "", `#${id}`);
  };
  const title = sections.find(([id]) => id === section)?.[1] ?? "Обзор";
  if (!token)
    return (
      <Login
        onToken={(next) => {
          void queryClient.cancelQueries();
          queryClient.clear();
          setSection("dashboard");
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
      <aside className="sidebar">
        <div className="brand">BIOFLOW</div>
        <nav className="nav">
          {sections
            .filter(([id]) => allowed(id))
            .map(([id, label, Icon]) => (
              <button
                key={id}
                className={section === id ? "active" : ""}
                onClick={() => navigate(id)}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
        </nav>
      </aside>
      <main className="main">
        <div className="topbar">
          <h1 className="title">{title}</h1>
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
