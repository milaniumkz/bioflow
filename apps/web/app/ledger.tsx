"use client";
import { useEffect, useRef, useState } from "react";
import { webRequest, downloadReport } from "./session";
type Row = Record<string, any>;
const url = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
const names: Record<string, string> = {
  DIRTY: "Сырьё",
  WASHED: "Мытое",
  FINISHED: "Готовая продукция",
  DRAFT: "Черновик",
  CONFIRMED: "Подтверждено",
  CREATED: "Создана",
  LOADED: "Погружена",
  IN_TRANSIT: "В пути",
  ARRIVED: "Прибыла",
  ACCEPTED: "Принята",
  ACCEPTED_WITH_DIFFERENCE: "Принята с расхождением",
  PARTIALLY_ACCEPTED: "Частичная приёмка",
  UNLOADED: "Разгружена",
  COMPLETED: "Завершена",
  REVIEW: "На проверке",
  CANCELLED: "Отменена",
  WASHING: "Мойка",
  PRODUCTION: "Производство",
  TRANSFER: "Перемещение",
  WRITE_OFF: "Списание",
  SHIPMENT: "Отгрузка",
  RESERVE: "Резерв",
  RELEASE: "Снять резерв",
  CORRECTION: "Корректировка",
  INVENTORY: "Инвентаризация",
  RETURN: "Возврат",
};
const tabs = [
  ["batches", "Партии добычи"],
  ["waybills", "Перевозки"],
  ["stocks", "Остатки"],
  ["operations", "Операции"],
  ["reports", "Отчёты"],
  ["access", "Доступ"],
];
const reports = [
  "extraction",
  "waybills",
  "discrepancies",
  "movements",
  "inventory",
  "turnover",
  "washing",
  "production",
  "losses",
  "transfers",
  "shipments",
  "reconciliation",
  "audit",
];
const reportNames = [
  "Добыча",
  "Перевозки",
  "Расхождения",
  "Движения",
  "Остатки",
  "Обороты",
  "Мойка",
  "Производство",
  "Потери",
  "Перемещения",
  "Отгрузки",
  "Сверка",
  "Аудит",
];
export function Ledger({
  token,
  initialTab = "batches",
}: {
  token: string;
  initialTab?: string;
}) {
  const pending = useRef(new Map<string, string>());

  const [tab, setTab] = useState(initialTab),
    [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [filter, setFilter] = useState({
      search: "",
      status: "",
      warehouseId: "",
      dateFrom: "",
      dateTo: "",
    });
  const [refs, setRefs] = useState<Record<string, Row[]>>({}),
    [permissions, setPermissions] = useState<string[]>([]),
    [values, setValues] = useState<Row>({}),
    [inputs, setInputs] = useState([{ batchId: "", quantity: "" }]),
    [files, setFiles] = useState<string[]>([]),
    [selected, setSelected] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [trace, setTrace] = useState<Row | null>(null),
    [report, setReport] = useState("inventory"),
    [revision, setRevision] = useState(0),
    [result, setResult] = useState<Row | null>(null);
  const has = (p: string) => permissions.includes(p);
  const call = <T,>(path: string, data?: unknown) =>
    webRequest<T>(
      path,
      token,
      data === undefined
        ? undefined
        : { method: "POST", body: JSON.stringify(data) },
    );
  useEffect(() => {
    let alive = true;
    call<Row>("/auth/me")
      .then((x) => {
        if (alive) setPermissions(x.permissions ?? []);
      })
      .catch((e) => setError(e.message));
    Promise.all(
      [
        "counterparties",
        "extraction-sites",
        "warehouses",
        "vehicles",
        "drivers",
        "material-types",
        "product-types",
        "ledger/batches",
        "ledger/stocks",
      ].map(async (entity) => {
        const x = await call<any>(`/${entity}?pageSize=100`);
        return [entity, Array.isArray(x) ? x : (x.data ?? [])] as const;
      }),
    )
      .then((x) => {
        if (alive) setRefs(Object.fromEntries(x));
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [token]);
  useEffect(() => {
    let alive = true;
    setError("");
    const q = new URLSearchParams({
      page: String(page),
      pageSize: "20",
      ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)),
    });
    const path =
      tab === "reports"
        ? `/ledger/reports/${report}?${q}`
        : tab === "access"
          ? "/users?pageSize=100"
          : `/ledger/${tab}?${q}`;
    call<any>(path)
      .then((x) => {
        if (!alive) return;
        setRows(Array.isArray(x) ? x : (x.rows ?? x.data ?? []));
        setTotal(x.total ?? x.rows?.length ?? x.length ?? 0);
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setRows([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [tab, page, filter, report, revision, token]);
  const set = (k: string, v: unknown) => setValues((x) => ({ ...x, [k]: v }));
  async function command(path: string, data: Row) {
    setBusy(true);
    setError("");
    try {
      const clean = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== "" && v !== undefined),
      );
      const fingerprint = JSON.stringify({ path, clean });
      const idempotencyKey =
        pending.current.get(fingerprint) ?? crypto.randomUUID();
      pending.current.set(fingerprint, idempotencyKey);
      const x = await call<Row>(
        path,
        path.endsWith("/access") ? clean : { ...clean, idempotencyKey },
      );
      pending.current.delete(fingerprint);
      setResult(x);
      setRevision((x) => x + 1);
      setSelected(null);
      setValues({});
      setFiles([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = (
    key: string,
    label: string,
    type = "text",
    required = true,
  ) => (
    <label key={key}>
      {label}
      <input
        type={type}
        required={required}
        step={type === "number" ? "0.001" : undefined}
        value={values[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  const select = (
    key: string,
    label: string,
    entity: string,
    required = true,
  ) => (
    <label key={key}>
      {label}
      <select
        required={required}
        value={values[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="">Выберите</option>
        {(refs[entity] ?? []).map((x) => (
          <option key={x.id} value={x.id}>
            {x.name ?? x.plateNumber ?? x.fullName}
          </option>
        ))}
      </select>
    </label>
  );
  const batchSelect = (key: string, label: string) => (
    <label>
      {label}
      <select
        required
        value={values[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="">Выберите партию</option>
        {(refs["ledger/batches"] ?? [])
          .filter(
            (x) =>
              ["CONFIRMED", "PARTIALLY_SHIPPED"].includes(x.status) &&
              Number(x.availableSourceQuantity) > 0,
          )
          .map((x) => (
            <option key={x.id} value={x.id}>
              {x.number} · доступно {x.availableSourceQuantity} т
            </option>
          ))}
      </select>
    </label>
  );
  async function upload(list: FileList | null) {
    if (!list) return;
    setBusy(true);
    try {
      for (const f of Array.from(list)) {
        const x = await call<Row>("/files/upload-url", {
          fileName: f.name,
          mimeType: f.type,
          size: f.size,
        });
        const r = await fetch(x.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": f.type },
          body: f,
        });
        if (!r.ok) throw Error("Не удалось загрузить документ");
        await call(`/files/${x.file.id}/complete`, {});
        setFiles((v) => [...v, x.file.id]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const documents = (
    <label>
      Фото весов / документы
      <input
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={(e) => upload(e.target.files)}
      />
      <small>Загружено: {files.length}</small>
    </label>
  );
  const action = (
    row: Row,
    label: string,
    suffix: string,
    payload: Row = {},
    needReason = false,
  ) => (
    <button
      disabled={busy}
      className="button secondary"
      onClick={() => {
        const reason = needReason
          ? window.prompt("Причина операции")
          : undefined;
        if (needReason && !reason) return;
        if (!window.confirm(`${label}: ${row.number ?? row.id}?`)) return;
        command(`/ledger/${tab}/${row.id}/${suffix}`, {
          ...payload,
          ...(reason ? { reason } : {}),
        });
      }}
    >
      {label}
    </button>
  );
  const operationKind = values.kind ?? "TRANSFER";
  return (
    <>
      <div className="toolbar">
        {tabs
          .filter(([id]) => id !== "access" || has("users.manage"))
          .filter(([id]) => id !== "reports" || has("reports.read"))
          .map(([id, label]) => (
            <button
              key={id}
              className={`button ${tab === id ? "" : "secondary"}`}
              onClick={() => {
                setTab(id);
                setPage(1);
                setValues({});
                setSelected(null);
              }}
            >
              {label}
            </button>
          ))}
      </div>
      <p className="metric">Все массы — в тоннах с точностью 0,001 т</p>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <div className="toolbar">
        <input
          aria-label="Поиск"
          placeholder="Номер / транспорт"
          value={filter.search}
          onChange={(e) => {
            setPage(1);
            setFilter({ ...filter, search: e.target.value });
          }}
        />
        <select
          aria-label="Склад"
          value={filter.warehouseId}
          onChange={(e) => {
            setPage(1);
            setFilter({ ...filter, warehouseId: e.target.value });
          }}
        >
          <option value="">Все доступные склады</option>
          {(refs.warehouses ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Дата от"
          type="date"
          value={filter.dateFrom}
          onChange={(e) => setFilter({ ...filter, dateFrom: e.target.value })}
        />
        <input
          aria-label="Дата до"
          type="date"
          value={filter.dateTo}
          onChange={(e) => setFilter({ ...filter, dateTo: e.target.value })}
        />
        <button
          className="button secondary"
          onClick={() => setRevision((x) => x + 1)}
        >
          Обновить
        </button>
      </div>
      {tab === "batches" && has("batches.manage") && (
        <details className="panel">
          <summary>Новая партия добычи</summary>
          <form
            className="ledger-form"
            onSubmit={(e) => {
              e.preventDefault();
              command("/ledger/batches", {
                ...values,
                measuredAt: new Date(values.measuredAt).toISOString(),
                fileIds: files,
              });
            }}
          >
            {select("counterpartyId", "Подрядчик", "counterparties")}
            {select("extractionSiteId", "Место добычи", "extraction-sites")}
            {select("materialTypeId", "Материал", "material-types")}
            {field("quantity", "Объём, т", "number")}
            {field("measurementMethod", "Способ измерения")}
            {field("measuredAt", "Дата и время", "datetime-local")}
            {documents}
            <button className="button" disabled={busy}>
              Создать черновик
            </button>
          </form>
        </details>
      )}
      {tab === "waybills" && has("waybills.manage") && (
        <details className="panel">
          <summary>Новая перевозка из партии</summary>
          <form
            className="ledger-form"
            onSubmit={(e) => {
              e.preventDefault();
              command("/ledger/waybills", {
                ...values,
                documentDate: new Date(values.documentDate).toISOString(),
              });
            }}
          >
            {batchSelect("batchId", "Партия добычи")}
            {select("vehicleId", "Транспорт", "vehicles")}
            {select("driverId", "Водитель", "drivers", false)}
            {select("destinationWarehouseId", "Склад назначения", "warehouses")}
            {field("quantity", "Объём, т", "number")}
            {field("documentDate", "Дата документа", "datetime-local")}
            <button disabled={busy} className="button">
              Создать
            </button>
          </form>
        </details>
      )}
      {tab === "operations" &&
        (has("inventory.manage") || has("operations.manage")) && (
          <details className="panel">
            <summary>Новая операция</summary>
            <form
              className="ledger-form"
              onSubmit={(e) => {
                e.preventDefault();
                command("/ledger/operations", {
                  ...values,
                  kind: operationKind,
                  inputs,
                  fileIds: files,
                });
              }}
            >
              <label>
                Операция
                <select
                  value={operationKind}
                  onChange={(e) => set("kind", e.target.value)}
                >
                  {Object.keys(names)
                    .filter((x) =>
                      [
                        "WASHING",
                        "PRODUCTION",
                        "TRANSFER",
                        "WRITE_OFF",
                        "SHIPMENT",
                        "RESERVE",
                        "RELEASE",
                        "CORRECTION",
                        "INVENTORY",
                        "RETURN",
                      ].includes(x),
                    )
                    .map((x) => (
                      <option key={x} value={x}>
                        {names[x]}
                      </option>
                    ))}
                </select>
              </label>
              {select("fromWarehouseId", "Исходный склад", "warehouses")}
              {["TRANSFER", "WASHING", "PRODUCTION"].includes(operationKind) &&
                select("toWarehouseId", "Склад назначения", "warehouses")}
              {inputs.map((i, n) => (
                <div className="toolbar" key={n}>
                  <select
                    required
                    aria-label="Входная партия"
                    value={i.batchId}
                    onChange={(e) =>
                      setInputs((v) =>
                        v.map((x, j) =>
                          j === n ? { ...x, batchId: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    <option value="">Выберите партию на складе</option>
                    {(refs["ledger/stocks"] ?? [])
                      .filter(
                        (x) =>
                          !values.fromWarehouseId ||
                          x.warehouseId === values.fromWarehouseId,
                      )
                      .map((x) => (
                        <option key={x.id} value={x.batchId}>
                          {x.batch.number} · {names[x.batch.state]} ·{" "}
                          {x.available} т
                        </option>
                      ))}
                  </select>
                  <input
                    required
                    aria-label="Количество партии"
                    type="number"
                    step="0.001"
                    placeholder={
                      operationKind === "INVENTORY"
                        ? "Фактический остаток, т"
                        : "Количество, т"
                    }
                    value={i.quantity}
                    onChange={(e) =>
                      setInputs((v) =>
                        v.map((x, j) =>
                          j === n ? { ...x, quantity: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  {n > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setInputs((v) => v.filter((_, j) => j !== n))
                      }
                    >
                      Убрать
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setInputs((v) => [...v, { batchId: "", quantity: "" }])
                }
              >
                Ещё входная партия
              </button>
              {["WASHING", "PRODUCTION"].includes(operationKind) && (
                <>
                  {field("outputQuantity", "Выход, т", "number")}
                  {field("wasteQuantity", "Отходы, т", "number", false)}
                  {field("lossQuantity", "Потери, т", "number", false)}
                  {field("defectQuantity", "Брак, т", "number", false)}
                  {field("shift", "Смена")}
                  {field("line", "Линия", "text", false)}
                  {field("packaging", "Упаковка", "text", false)}
                  {operationKind === "PRODUCTION" &&
                    select("productTypeId", "Продукция", "product-types")}
                </>
              )}
              {operationKind === "SHIPMENT" && (
                <>
                  {field("recipient", "Получатель")}
                  {select("vehicleId", "Транспорт", "vehicles")}
                  {field("documentNumber", "Номер документа")}
                </>
              )}
              {operationKind === "RETURN" &&
                field("reversesOperationId", "ID исходной отгрузки")}
              {field("reason", "Причина / комментарий", "text", false)}
              {documents}
              <button className="button" disabled={busy}>
                Создать черновик
              </button>
            </form>
          </details>
        )}
      {selected && (
        <form
          className="panel ledger-form"
          onSubmit={(e) => {
            e.preventDefault();
            command(`/ledger/waybills/${selected.id}/${selected.action}`, {
              ...values,
              fileIds: files,
              ...(selected.action === "receipt"
                ? { partial: values.partial === true }
                : {}),
            });
          }}
        >
          <h3>
            {selected.action === "load" ? "Погрузка" : "Приёмка"}:{" "}
            {selected.number}
          </h3>
          {selected.action === "receipt" &&
            select("warehouseId", "Склад приёмки", "warehouses")}
          {field("grossWeight", "Брутто, т", "number")}
          {field("tareWeight", "Тара, т", "number")}
          {field("reason", "Причина расхождения", "text", false)}
          {selected.action === "receipt" && (
            <label>
              <input
                type="checkbox"
                checked={values.partial ?? false}
                onChange={(e) => set("partial", e.target.checked)}
              />
              Частичная приёмка
            </label>
          )}
          {documents}
          <button disabled={busy} className="button">
            Сохранить
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => setSelected(null)}
          >
            Закрыть
          </button>
        </form>
      )}
      {tab === "reports" && (
        <div className="toolbar">
          <select
            aria-label="Тип отчёта"
            value={report}
            onChange={(e) => setReport(e.target.value)}
          >
            {reports.map((r, i) => (
              <option key={r} value={r}>
                {reportNames[i]}
              </option>
            ))}
          </select>
          {["csv", "xlsx", "pdf"].map((format) => (
            <button
              key={format}
              className="button secondary"
              onClick={async () => {
                try {
                  const q = new URLSearchParams({
                    ...Object.fromEntries(
                      Object.entries(filter).filter(([, v]) => v),
                    ),
                    format,
                  });
                  const u = URL.createObjectURL(
                    await downloadReport(
                      `/ledger/reports/${report}/export?${q}`,
                      token,
                    ),
                  );
                  const a = document.createElement("a");
                  a.href = u;
                  a.download = `bioflow-${report}.${format}`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(u), 1000);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Скачать {format.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      <div className="ledger-rows">
        {rows.map((row, i) => (
          <article className="panel" key={row.id ?? i}>
            <h3>
              {row.number ??
                row.batch?.number ??
                row.fullName ??
                row.batchId ??
                `Запись ${i + 1}`}
            </h3>
            {Object.entries(row)
              .filter(
                ([k, v]) =>
                  v !== null &&
                  (tab === "reports" ||
                    [
                      "status",
                      "state",
                      "quantity",
                      "reserved",
                      "available",
                      "availableSourceQuantity",
                      "declaredWeight",
                      "receivedWeight",
                      "kind",
                      "createdAt",
                      "capacity",
                      "warehouseId",
                      "body",
                      "title",
                      "email",
                      "warehouseScopeIds",
                      "extractionScopeIds",
                    ].includes(k)),
              )
              .map(([k, v]) => (
                <div className="ledger-value" key={k}>
                  <span>
                    {(
                      {
                        quantity: "Остаток, т",
                        reserved: "Резерв, т",
                        available: "Доступно, т",
                        warehouseId: "Склад",
                        opening: "На начало, т",
                        incoming: "Приход, т",
                        outgoing: "Расход, т",
                        closing: "На конец, т",
                        batchNumber: "Партия",
                        wasteQuantity: "Отходы, т",
                        lossQuantity: "Потери, т",
                        defectQuantity: "Брак, т",
                        freeQuantity: "Доступно, т",
                        state: "Материал",
                        status: "Статус",
                        availableSourceQuantity: "Не распределено, т",
                        declaredWeight: "Отправлено, т",
                        receivedWeight: "Принято, т",
                        batchId: "ID партии",
                        id: "ID",
                        kind: "Операция",
                        createdAt: "Создано",
                      } as Row
                    )[k] ?? k}
                  </span>
                  <span>
                    {typeof v === "object"
                      ? ((v as Row).name ??
                        (v as Row).number ??
                        JSON.stringify(v))
                      : k === "warehouseId"
                        ? ((refs.warehouses ?? []).find((x) => x.id === v)
                            ?.name ?? String(v))
                        : (names[String(v)] ?? String(v))}
                  </span>
                </div>
              ))}
            <div className="toolbar">
              {tab === "batches" && has("batches.manage") && (
                <>
                  {row.status === "DRAFT" &&
                    action(row, "Подтвердить", "confirm", {}, true)}
                  {action(row, "Закрыть", "close", {}, true)}
                  {action(row, "Отменить", "cancel", {}, true)}
                </>
              )}
              {["batches", "stocks"].includes(tab) && (
                <button
                  className="button secondary"
                  onClick={async () => {
                    try {
                      setTrace(
                        await call<Row>(
                          `/ledger/batches/${row.batchId ?? row.id}/trace`,
                        ),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Происхождение
                </button>
              )}
              {tab === "waybills" && (
                <>
                  {has("loading.manage") && row.status === "CREATED" && (
                    <button
                      className="button"
                      onClick={() => {
                        setValues({});
                        setSelected({ ...row, action: "load" });
                      }}
                    >
                      Погрузка
                    </button>
                  )}
                  {has("waybills.manage") &&
                    row.status === "LOADED" &&
                    action(row, "В путь", "status", { status: "IN_TRANSIT" })}
                  {has("waybills.manage") &&
                    row.status === "IN_TRANSIT" &&
                    action(row, "Прибыла", "status", { status: "ARRIVED" })}
                  {has("waybills.accept") &&
                    row.status === "ARRIVED" &&
                    action(
                      row,
                      "На проверку",
                      "status",
                      { status: "REVIEW" },
                      true,
                    )}
                  {has("waybills.accept") &&
                    ["ARRIVED", "REVIEW"].includes(row.status) &&
                    action(
                      row,
                      "Отклонить",
                      "status",
                      { status: "REJECTED" },
                      true,
                    )}
                  {has("waybills.manage") &&
                    row.status === "REVIEW" &&
                    action(row, "Вернуть к приёмке", "status", {
                      status: "ARRIVED",
                    })}
                  {has("waybills.accept") &&
                    ["ARRIVED", "PARTIALLY_ACCEPTED"].includes(row.status) && (
                      <button
                        className="button"
                        onClick={() => {
                          setValues({
                            warehouseId: row.destinationWarehouseId,
                          });
                          setSelected({ ...row, action: "receipt" });
                        }}
                      >
                        Принять
                      </button>
                    )}
                  {has("waybills.accept") &&
                    ["ACCEPTED", "ACCEPTED_WITH_DIFFERENCE"].includes(
                      row.status,
                    ) &&
                    action(row, "Разгрузить", "unload")}
                  {has("waybills.manage") &&
                    row.status === "UNLOADED" &&
                    action(row, "Завершить", "status", { status: "COMPLETED" })}
                  {has("waybills.manage") &&
                    action(
                      row,
                      "Отменить",
                      "status",
                      { status: "CANCELLED" },
                      true,
                    )}
                </>
              )}
              {tab === "operations" &&
                (has("operations.manage") || has("inventory.manage")) && (
                  <>
                    {row.status === "DRAFT" &&
                      action(row, "Подтвердить", "confirm")}
                    {action(row, "Отменить", "cancel", {}, true)}
                  </>
                )}
              {tab === "access" && has("users.manage") && (
                <button
                  className="button"
                  onClick={() => {
                    setValues({
                      userId: row.id,
                      accessAllObjects: row.accessAllObjects ?? false,
                      warehouseScopeIds: (row.warehouseScopeIds ?? []).join(
                        ",",
                      ),
                      extractionScopeIds: (row.extractionScopeIds ?? []).join(
                        ",",
                      ),
                      counterpartyScopeId: row.counterpartyScopeId ?? "",
                    });
                  }}
                >
                  Назначить доступ
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <p className="metric">Нет записей по выбранным условиям</p>
      )}
      {tab === "access" && values.userId && (
        <form
          className="panel ledger-form"
          onSubmit={(e) => {
            e.preventDefault();
            command(`/ledger/users/${values.userId}/access`, {
              accessAllObjects: values.accessAllObjects,
              warehouseScopeIds: String(values.warehouseScopeIds)
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
              extractionScopeIds: String(values.extractionScopeIds)
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
              ...(values.counterpartyScopeId
                ? { counterpartyScopeId: values.counterpartyScopeId }
                : {}),
              reason: values.reason,
            });
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={values.accessAllObjects}
              onChange={(e) => set("accessAllObjects", e.target.checked)}
            />
            Все объекты
          </label>
          {field(
            "warehouseScopeIds",
            "ID складов через запятую",
            "text",
            false,
          )}
          {field(
            "extractionScopeIds",
            "ID мест добычи через запятую",
            "text",
            false,
          )}
          {select("counterpartyScopeId", "Подрядчик", "counterparties", false)}
          {field("reason", "Причина назначения")}
          <button className="button" disabled={busy}>
            Сохранить
          </button>
        </form>
      )}
      {["batches", "waybills", "operations"].includes(tab) && (
        <div className="toolbar">
          <button
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage((x) => x - 1)}
          >
            Назад
          </button>
          <span>
            {page} · всего {total}
          </span>
          <button
            className="button secondary"
            disabled={page * 20 >= total}
            onClick={() => setPage((x) => x + 1)}
          >
            Далее
          </button>
        </div>
      )}
      {trace && (
        <section className="panel">
          <h3>История происхождения партии</h3>
          <TraceTree node={trace} />
          <button className="button secondary" onClick={() => setTrace(null)}>
            Закрыть
          </button>
        </section>
      )}
      {result && (
        <section className="panel" role="status">
          <p>Операция сохранена: {result.number ?? result.id ?? "готово"}</p>
          {result.qrImage && (
            <div>
              <img
                src={result.qrImage}
                width="220"
                height="220"
                alt="QR документа"
              />
              <button
                className="button secondary"
                onClick={() => window.print()}
              >
                Печать QR
              </button>
            </div>
          )}
          {result.qrToken && (
            <p>
              QR-токен: <code>{result.qrToken}</code>
            </p>
          )}
          <button className="button secondary" onClick={() => setResult(null)}>
            Закрыть
          </button>
        </section>
      )}
    </>
  );
}

function TraceTree({ node }: { node: Row }) {
  return (
    <details open className="panel">
      <summary>
        {node.batch?.number ?? node.id} · {names[node.batch?.state] ?? "Партия"}
      </summary>
      {node.batch && (
        <p>
          Объём: {node.batch.initialQuantity} т · измерение:{" "}
          {node.batch.measurementMethod}
        </p>
      )}
      {node.operation && (
        <p>
          {names[node.operation.kind]}: {node.operation.number}
        </p>
      )}
      {(node.trips ?? []).map((t: Row) => (
        <p key={t.id}>
          {t.number} · {t.vehicle?.plateNumber} · {t.counterparty?.name} ·{" "}
          {t.extractionSite?.name} · {t.declaredWeight} т
        </p>
      ))}
      {(node.inputs ?? []).map((i: Row, n: number) => (
        <div key={n}>
          <p>Использовано {i.quantity} т</p>
          <TraceTree node={i.source} />
        </div>
      ))}
    </details>
  );
}
