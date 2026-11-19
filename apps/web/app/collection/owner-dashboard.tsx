"use client";
import { useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { webRequest } from "../session";
import { kgAsTonnes, tonnesToKg } from "./weight-units";
import { LaboratoryResult } from "./laboratory";
import { DryingIntakeResult, DryingBagResult } from "./drying-laboratory";
import { TripMap } from "./trip-map";
import "./collector-reports.css";
import "./owner-dashboard.css";
type Row = Record<string, any>;
type Filters = Record<string, string>;
const defaults: Filters = {
  from: "",
  to: "",
  basis: "delivery",
  collectorId: "",
  warehouseId: "",
  factoryId: "",
  driverPhone: "",
  driverPlate: "",
  kind: "",
  status: "",
  laboratory: "all",
  search: "",
  minTonnes: "",
  maxTonnes: "",
  minKg: "",
  maxKg: "",
  pageSize: "20",
};
const kinds: Record<string, string> = {
  RAW: "Сырьё от сборщика",
  FACTORY: "Отправка с мойки на завод",
  GP: "Доставка ГП",
  PRODUCTION: "Сушка и выпуск",
  WASH: "Мойка",
  OTHER: "Другие движения и изменения",
};
const statuses: Record<string, string> = {
  CREATED: "QR создан",
  LOADED: "Загрузился",
  IN_TRANSIT: "В пути",
  ARRIVED: "Прибыл",
  ACCEPTED: "Принято",
  CANCELLED: "Отменено",
  RETURNED_TO_WASH: "Возвращено на мойку",
  COMPLETED: "Выполнено",
};
const materials: Record<string, string> = {
  RAW: "Немытое",
  WASHED: "Мытое",
  FINISHED: "Готовая продукция",
  REJECT: "Некондиция",
  REDRY: "Повторная сушка",
};
const bases: Record<string, string> = {
  delivery: "Доставка / получение",
  dispatch: "Создание отправки / операции",
  acceptance: "Подтверждение приёмки",
};
const mass = (v: unknown) => kgAsTonnes(v ?? 0);
const day = (v: string) => v.split("-").reverse().join(".");
const time = (v: string) =>
  new Date(v).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" });
function qs(f: Filters, page: number) {
  const q = new URLSearchParams();
  for (const key of [
    "from",
    "to",
    "basis",
    "collectorId",
    "warehouseId",
    "factoryId",
    "driverPhone",
    "driverPlate",
    "kind",
    "status",
    "laboratory",
    "search",
    "minKg",
    "maxKg",
    "pageSize",
  ])
    if (f[key]) q.set(key, f[key]);
  q.set("page", String(page));
  return q.toString();
}
function MetricGroup({
  title,
  summary,
  items,
}: {
  title: string;
  summary: Row;
  items: [string, string][];
}) {
  return (
    <section className="od-metric-group">
      <h3>{title}</h3>
      <div className="cr-metrics">
        {items.map(([key, label]) => (
          <article key={key}>
            <span>{label}</span>
            <strong>
              {mass(summary[key])}
              <small> т</small>
            </strong>
          </article>
        ))}
      </div>
    </section>
  );
}
export function OwnerDashboard({ token }: { token: string }) {
  const [filters, setFilters] = useState<Filters>({ ...defaults }),
    [draft, setDraft] = useState<Filters>({ ...defaults }),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [group, setGroup] = useState("collectors"),
    [routes, setRoutes] = useState<string[]>([]);
  const filterPanel = useRef<HTMLDetailsElement>(null),
    breakdownPanel = useRef<HTMLDetailsElement>(null);
  const request = useQuery({
    queryKey: ["owner-dashboard", token, filters, page],
    queryFn: () =>
      webRequest<Row>("/collection/dashboard?" + qs(filters, page), token),
    placeholderData: (previous) =>
      previous ? { options: previous.options } : undefined,
    refetchInterval: 5000,
  });
  const data = request.data?.summary ? request.data : null,
    options: Row = request.data?.options ?? {
      collectors: [],
      warehouses: [],
      factories: [],
      drivers: [],
    };
  function apply(next: Filters) {
    try {
      if (next.from && next.to && next.from > next.to)
        throw Error("Дата «с» не должна быть позже даты «по»");
      const f = {
        ...next,
        minKg: next.minTonnes ? tonnesToKg(next.minTonnes) : "",
        maxKg: next.maxTonnes ? tonnesToKg(next.maxTonnes) : "",
      };
      if (f.minKg && f.maxKg && Number(f.minKg) > Number(f.maxKg))
        throw Error("Минимальный вес не должен превышать максимальный");
      setFilters(f);
      setDraft(f);
      setError("");
      setPage(1);
      setRoutes([]);
      if (filterPanel.current) filterPanel.current.open = false;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    apply({ ...draft });
  }
  function preset(kind: string) {
    const t = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Almaty",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      shift = (n: number) =>
        new Date(new Date(t + "T12:00:00Z").getTime() + n * 86400000)
          .toISOString()
          .slice(0, 10);
    const dates =
      kind === "today"
        ? [t, t]
        : kind === "yesterday"
          ? [shift(-1), shift(-1)]
          : kind === "week"
            ? [shift(-6), t]
            : kind === "month"
              ? [t.slice(0, 8) + "01", t]
              : ["", ""];
    apply({ ...draft, from: dates[0], to: dates[1] });
  }
  function choose(key: string, id: string) {
    apply({ ...filters, [key]: id });
  }
  const entityLabels = [
    options.collectors.find((x: Row) => x.id === filters.collectorId)?.name,
    options.warehouses.find((x: Row) => x.id === filters.warehouseId)?.name,
    options.factories.find((x: Row) => x.id === filters.factoryId)?.name,
    filters.driverPhone,
  ].filter(Boolean);
  const breakdownColumns: Record<string, [string, string][]> = {
    collectors: [
      ["rawDeliveredKg", "Доставлено"],
      ["rawLaboratoryKg", "Лаборатория"],
      ["rawDeductionKg", "Вычеты"],
      ["rawAcceptedKg", "Принято"],
    ],
    warehouses: [
      ["rawAcceptedKg", "Приход сырья"],
      ["washedKg", "Вымыто"],
      ["factorySentKg", "Отправлено на завод"],
    ],
    factories: [
      ["factoryAcceptedKg", "Принято на сушку"],
      ["finishedKg", "Выпущено ГП"],
      ["rejectedKg", "Некондиция"],
      ["redryKg", "На пересушку"],
    ],
    drivers: [
      ["rawDeliveredKg", "Доставлено сырья"],
      ["gpDeliveredKg", "Доставлено ГП"],
    ],
  };
  const filteredPerson = !!(
    filters.collectorId ||
    filters.driverPhone ||
    filters.driverPlate
  );
  const activeFilters = [
    filters.from || filters.to,
    filters.collectorId,
    filters.warehouseId,
    filters.factoryId,
    filters.driverPhone,
    filters.driverPlate,
    filters.kind,
    filters.status,
    filters.laboratory !== "all",
    filters.search,
    filters.minKg || filters.maxKg,
    filters.basis !== "delivery",
  ].filter(Boolean).length;
  const stockTotal = (state: string) =>
    data?.stock
      .filter((row: Row) => row.state === state)
      .reduce((sum: number, row: Row) => sum + Number(row.weightKg), 0) ?? 0;
  const fastCards = data
    ? filteredPerson
      ? [
          ["Сырьё доставлено", data.summary.rawDeliveredKg, "За период"],
          ["Вычеты лаборатории", data.summary.rawDeductionKg, "За период"],
          ["Принято сырья", data.summary.rawAcceptedKg, "За период"],
          filters.collectorId
            ? [
                "Ожидает лаборатории",
                data.summary.rawPendingLabKg,
                "Сейчас в выборке",
              ]
            : ["ГП доставлено", data.summary.gpDeliveredKg, "За период"],
        ]
      : [
          ["Немытое", stockTotal("RAW"), "Сейчас"],
          ["Мытое", stockTotal("WASHED"), "Сейчас"],
          ["Готовая продукция", stockTotal("FINISHED"), "Сейчас"],
          ["Некондиция", stockTotal("REJECT"), "Сейчас"],
          ["На пересушке", stockTotal("REDRY"), "Сейчас"],
          ["Принято сырья", data.summary.rawAcceptedKg, "За период"],
        ]
    : [];
  function openGroup(id: string) {
    setGroup(id);
    if (breakdownPanel.current) {
      breakdownPanel.current.open = true;
      requestAnimationFrame(() =>
        breakdownPanel.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
    }
  }
  return (
    <section
      className="cr-report od-dashboard"
      aria-label="Главный дашборд владельца"
    >
      <header className="cr-heading od-compact-heading">
        <div>
          <h2>
            {entityLabels.length ? entityLabels.join(" · ") : "Вся система"}
          </h2>
          <p>
            {filters.from || filters.to
              ? `${filters.from ? day(filters.from) : "Начало учёта"} — ${filters.to ? day(filters.to) : "Сегодня"}`
              : "Весь период"}{" "}
            · данные обновляются
          </p>
        </div>
        {activeFilters > 0 ? (
          <button
            type="button"
            aria-label="Сбросить фильтры"
            onClick={() => apply({ ...defaults })}
          >
            Сбросить
          </button>
        ) : null}
      </header>
      {data ? (
        <>
          <section className="od-fast-grid" aria-label="Ключевые показатели">
            {fastCards.map(([label, value, note]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>
                  {mass(value)}
                  <small> т</small>
                </strong>
                <small>{note}</small>
              </article>
            ))}
          </section>
          <div className="od-fast-status">
            <span>
              Водители в пути: <b>{data.summary.driverActive}</b>
            </span>
            <span>
              Ожидает лаборатории: <b>{mass(data.summary.rawPendingLabKg)} т</b>
            </span>
          </div>
          <nav className="od-shortcuts" aria-label="Быстрый просмотр">
            {[
              ["collectors", "Сборщики"],
              ["warehouses", "Мойки"],
              ["factories", "Заводы"],
              ["drivers", "Водители"],
            ].map(([key, label]) => (
              <button type="button" key={key} onClick={() => openGroup(key)}>
                {label}
              </button>
            ))}
          </nav>
        </>
      ) : null}
      <details ref={filterPanel} className="od-filter-panel">
        <summary>
          Фильтры{activeFilters > 0 ? <b>{activeFilters}</b> : null}
          <span>
            {activeFilters ? "Настроены" : "Выбрать период или объект"}
          </span>
        </summary>
        <form className="od-filter" onSubmit={submit}>
          <div className="od-filter-grid">
            <label>
              Дата с
              <input
                type="date"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </label>
            <label>
              Дата по
              <input
                type="date"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </label>
            <label>
              Период по дате
              <select
                aria-label="Период по дате"
                value={draft.basis}
                onChange={(e) => setDraft({ ...draft, basis: e.target.value })}
              >
                {Object.entries(bases).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {[
              ["collectorId", "Сборщик", "collectors"],
              ["warehouseId", "Мойка", "warehouses"],
              ["factoryId", "Завод", "factories"],
              ["driverPhone", "Водитель", "drivers"],
            ].map(([key, label, list]) => (
              <label key={key}>
                {label}
                <select
                  aria-label={label}
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                >
                  <option value="">Все</option>
                  {options[list].map((item: Row) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.phone && list === "collectors"
                        ? ` · ${item.phone}`
                        : ""}
                      {item.plates?.length
                        ? ` · ${item.plates.join(", ")}`
                        : ""}
                      {item.active === false ? " · архив / неактивен" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <details className="od-advanced">
            <summary>Дополнительные фильтры</summary>
            <div className="od-filter-grid">
              <label>
                Вид операции
                <select
                  aria-label="Вид операции"
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                >
                  <option value="">Все операции</option>
                  {Object.entries(kinds).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Статус
                <select
                  aria-label="Статус"
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({ ...draft, status: e.target.value })
                  }
                >
                  <option value="">Все статусы</option>
                  {Object.entries(statuses).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Лаборатория
                <select
                  aria-label="Лаборатория"
                  value={draft.laboratory}
                  onChange={(e) =>
                    setDraft({ ...draft, laboratory: e.target.value })
                  }
                >
                  <option value="all">Все</option>
                  <option value="checked">Сохранён анализ</option>
                  <option value="pending">Ожидает приёмки / лаборатории</option>
                  <option value="rework">
                    Возврат на мойку / повторная сушка
                  </option>
                </select>
              </label>
              <label>
                Госномер
                <input
                  value={draft.driverPlate}
                  onChange={(e) =>
                    setDraft({ ...draft, driverPlate: e.target.value })
                  }
                />
              </label>
              <label>
                Масса от, тонн
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={draft.minTonnes}
                  onChange={(e) =>
                    setDraft({ ...draft, minTonnes: e.target.value })
                  }
                />
              </label>
              <label>
                Масса до, тонн
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={draft.maxTonnes}
                  onChange={(e) =>
                    setDraft({ ...draft, maxTonnes: e.target.value })
                  }
                />
              </label>
              <label>
                Поиск операции
                <input
                  placeholder="Номер, ФИО, госномер, получатель"
                  value={draft.search}
                  onChange={(e) =>
                    setDraft({ ...draft, search: e.target.value })
                  }
                />
              </label>
              <label>
                Записей на странице
                <select
                  aria-label="Записей на странице"
                  value={draft.pageSize}
                  onChange={(e) =>
                    setDraft({ ...draft, pageSize: e.target.value })
                  }
                >
                  {[20, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          <div className="od-filter-actions">
            <button>Показать</button>
            <div className="cr-presets">
              {[
                ["today", "Сегодня"],
                ["yesterday", "Вчера"],
                ["week", "7 дней"],
                ["month", "Этот месяц"],
                ["all", "Весь период"],
              ].map(([key, label]) => (
                <button key={key} type="button" onClick={() => preset(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="cr-range">
            {bases[filters.basis]}:{" "}
            {filters.from ? day(filters.from) : "начало учёта"} —{" "}
            {filters.to ? day(filters.to) : "всё время"}. Дни UTC+5, дата «по»
            включительно. Фильтры сочетаются по одной операции.
          </p>
          <p className="cr-range">
            Сборщик — его поставки сырья; мойка / завод — операции объекта;
            водитель — перевозки по телефону. Движение показывается за период,
            остатки — на текущий момент.
          </p>
          {error ? (
            <p role="alert" className="cr-error">
              {error}
            </p>
          ) : null}
        </form>
      </details>
      {request.error ? (
        <p role="alert" className="cr-error">
          {request.error.message}
        </p>
      ) : null}
      {!data && !request.error ? <p role="status">Загружаем дашборд…</p> : null}
      {data ? (
        <>
          <details className="od-section">
            <summary>Приёмка, лаборатория и выпуск</summary>
            <div className="od-counts">
              <span>
                Операций: <b>{data.summary.eventCount}</b>
              </span>
              <span>
                Отменено: <b>{data.summary.cancelledCount}</b> — масса исключена
              </span>
              <span>
                Рейсов водителей: <b>{data.summary.driverTrips}</b>, доставлено{" "}
                <b>{data.summary.driverDelivered}</b>, ещё не доставлено{" "}
                <b>{data.summary.driverActive}</b>
              </span>
            </div>
            <MetricGroup
              title="Сырьё от сборщиков"
              summary={data.summary}
              items={[
                ["rawDeliveredKg", "Доставлено на мойки"],
                ["rawLaboratoryKg", "Проверено лабораторией"],
                ["rawDeductionKg", "Вычеты лаборатории"],
                ["rawAcceptedKg", "Итоговое принятое сырьё"],
              ]}
            />
            <p className="cr-note">
              Отправлено сырья {mass(data.summary.rawSentKg)} т. Ожидает
              лаборатории {mass(data.summary.rawPendingLabKg)} т; в пути / не
              доставлено {mass(data.summary.rawInTransitKg)} т. Приёмок{" "}
              {data.summary.rawAcceptedCount}, из них исторических без
              сохранённого анализа {data.summary.rawLegacyCount}.
            </p>
            <MetricGroup
              title="Мойки и приёмка на сушку"
              summary={data.summary}
              items={[
                ["washedKg", "Вымыто за период"],
                ["factorySentKg", "Отправлено с моек"],
                ["factoryAcceptedKg", "Принято на сушку"],
                ["factoryReturnedKg", "Полным весом на повторную мойку"],
              ]}
            />
            <p className="cr-range">
              Вычеты при приёмке на сушку:{" "}
              {mass(data.summary.factoryDeductionKg)} т.
            </p>
            <MetricGroup
              title="Выпуск и доставка готовой продукции"
              summary={data.summary}
              items={[
                ["finishedKg", "Выпущено ГП"],
                ["rejectedKg", "Выпущено некондиции"],
                ["redryKg", "Направлено на повторную сушку"],
                ["gpDeliveredKg", "ГП доставлено получателям"],
              ]}
            />
            <p className="cr-range">
              Отправлено ГП: {mass(data.summary.gpSentKg)} т. Повторные проходы
              сушки отражаются отдельными операциями.
            </p>
          </details>
          <details ref={breakdownPanel} className="od-breakdown od-section">
            <summary>Сборщики, мойки, заводы и водители</summary>
            <nav className="cr-presets" aria-label="Разрезы дашборда">
              {[
                ["collectors", "Сборщики"],
                ["warehouses", "Мойки"],
                ["factories", "Заводы"],
                ["drivers", "Водители"],
              ].map(([key, label]) => (
                <button
                  type="button"
                  aria-pressed={group === key}
                  key={key}
                  onClick={() => setGroup(key)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="cr-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      {group === "drivers"
                        ? "Телефон / госномера"
                        : "Сотрудник / объект"}
                    </th>
                    {breakdownColumns[group].map(([key, label]) => (
                      <th key={key}>{label}, т</th>
                    ))}
                    <th>Операций</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.breakdowns[group]
                    .filter((row: Row) => {
                      const key =
                        group === "collectors"
                          ? "collectorId"
                          : group === "warehouses"
                            ? "warehouseId"
                            : group === "factories"
                              ? "factoryId"
                              : "driverPhone";
                      return !filters[key] || row.id === filters[key];
                    })
                    .map((row: Row) => (
                      <tr key={row.id}>
                        <td>
                          <b>{row.name}</b>
                          {row.phone && group !== "drivers" ? (
                            <small>{row.phone}</small>
                          ) : null}
                          {row.plates?.length ? (
                            <small>{row.plates.join(", ")}</small>
                          ) : null}
                        </td>
                        {breakdownColumns[group].map(([key]) => (
                          <td key={key}>{mass(row.summary[key])}</td>
                        ))}
                        <td>{row.summary.eventCount}</td>
                        <td>
                          <button
                            type="button"
                            aria-label={`Открыть: ${row.name}`}
                            onClick={() =>
                              choose(
                                group === "collectors"
                                  ? "collectorId"
                                  : group === "warehouses"
                                    ? "warehouseId"
                                    : group === "factories"
                                      ? "factoryId"
                                      : "driverPhone",
                                row.id,
                              )
                            }
                          >
                            Открыть →
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
          {data.stock.length ? (
            <details className="od-section">
              <summary>Остатки по объектам</summary>
              <p className="cr-range">
                На {time(data.stockAsOf)}. Не изменяются при выборе
                исторического периода.
              </p>
              <div className="cr-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Объект</th>
                      <th>Позиция</th>
                      <th>Остаток, т</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stock.map((s: Row) => (
                      <tr key={s.locationId + s.state}>
                        <td>{s.name}</td>
                        <td>{materials[s.state] ?? s.state}</td>
                        <td>{mass(s.weightKg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : filters.collectorId ||
            filters.driverPhone ||
            filters.driverPlate ? (
            <p className="cr-note">
              Для просмотра складских остатков выберите мойку или завод без
              фильтра по сборщику / водителю. Личный зачёт сборщика показан в
              итоговом принятом сырье.
            </p>
          ) : null}
          <details className="od-section">
            <summary>Динамика по дням</summary>
            <div className="cr-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>День</th>
                    <th>Операций</th>
                    <th>Принято сырья, т</th>
                    <th>Вычеты, т</th>
                    <th>Принято на сушку, т</th>
                    <th>Выпущено ГП, т</th>
                    <th>Доставлено ГП, т</th>
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((row: Row) => (
                    <tr key={row.day}>
                      <td>
                        {row.day === "pending" ? (
                          "Дата не указана"
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              apply({ ...filters, from: row.day, to: row.day })
                            }
                          >
                            {day(row.day)}
                          </button>
                        )}
                      </td>
                      <td>{row.summary.eventCount}</td>
                      {[
                        "rawAcceptedKg",
                        "rawDeductionKg",
                        "factoryAcceptedKg",
                        "finishedKg",
                        "gpDeliveredKg",
                      ].map((key) => (
                        <td key={key}>{mass(row.summary[key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details className="od-section">
            <summary>Операции, лаборатория и перевозки ({data.total})</summary>
            {!data.events.length ? (
              <p className="cr-empty">
                Нет операций, соответствующих выбранным фильтрам.
              </p>
            ) : null}
            <div className="cr-shipments">
              {data.events.map((e: Row) => (
                <article className="cr-shipment" key={e.kind + e.id}>
                  <header>
                    <div>
                      <p className="cr-eyebrow">{kinds[e.kind]}</p>
                      <h4>{e.number}</h4>
                    </div>
                    <span>{statuses[e.status] ?? e.status}</span>
                  </header>
                  <p>
                    {[
                      e.collectorName,
                      e.warehouseName,
                      e.factoryName,
                      e.recipientName,
                    ]
                      .filter(Boolean)
                      .join(" → ")}
                  </p>
                  <p className="cr-dates">
                    Создано: {time(e.createdAt)}
                    <br />
                    Доставлено / выполнено:{" "}
                    {e.deliveredAt ? time(e.deliveredAt) : "—"}
                    <br />
                    Принято: {e.acceptedAt ? time(e.acceptedAt) : "—"}
                  </p>
                  <p>
                    {e.kind === "OTHER" ? "Масса операции" : "Исходный вес"}:{" "}
                    <b>{mass(e.weightKg)} т</b>
                    {e.bagCount ? ` · ${e.bagCount} мешков / бигбегов` : ""}
                  </p>
                  {e.status === "CANCELLED" ? (
                    <p className="cr-note">Отменено — вес не входит в итоги.</p>
                  ) : null}
                  {e.kind === "RAW" && e.laboratory ? (
                    <LaboratoryResult laboratory={e.laboratory} />
                  ) : e.kind === "FACTORY" && e.laboratory ? (
                    <DryingIntakeResult laboratory={e.laboratory} />
                  ) : e.status === "ACCEPTED" ? (
                    <p>
                      Принято: <b>{mass(e.acceptedWeightKg ?? e.weightKg)} т</b>
                      . Лабораторные показатели не сохранены.
                    </p>
                  ) : null}
                  {e.kind === "PRODUCTION" ? (
                    <>
                      <p>
                        ГП {mass(e.output.FINISHED)} т · некондиция{" "}
                        {mass(e.output.REJECT)} т · повторная сушка{" "}
                        {mass(e.output.REDRY)} т.
                        {e.repeatDrying ? " Повторный проход сушки." : ""}
                      </p>
                      <details>
                        <summary>
                          Лаборатория каждого бигбега ({e.bags.length})
                        </summary>
                        {e.bags.map((bag: Row) => (
                          <section key={bag.id}>
                            <h4>
                              Бигбег {bag.index} · {mass(bag.weightKg)} т ·{" "}
                              {materials[bag.state]}
                            </h4>
                            {bag.laboratory ? (
                              <DryingBagResult laboratory={bag.laboratory} />
                            ) : (
                              <p>
                                Историческая запись без лабораторных
                                показателей.
                              </p>
                            )}
                          </section>
                        ))}
                      </details>
                    </>
                  ) : null}
                  {e.reason ? <p>{e.reason}</p> : null}
                  {e.driverPhone ? (
                    <p>
                      Водитель: {e.driverPhone} · {e.driverPlate}
                    </p>
                  ) : null}
                  {e.driverPhone && ["RAW", "GP"].includes(e.kind) ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setRoutes((ids) =>
                            ids.includes(e.id)
                              ? ids.filter((id) => id !== e.id)
                              : [...ids, e.id],
                          )
                        }
                      >
                        {routes.includes(e.id)
                          ? "Скрыть маршрут"
                          : "Маршрут водителя"}
                      </button>
                      {routes.includes(e.id) ? (
                        <TripMap id={e.id} token={token} />
                      ) : null}
                    </>
                  ) : null}
                </article>
              ))}
            </div>
            <nav className="cr-pagination" aria-label="Страницы операций">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => {
                  setPage((p) => p - 1);
                  setRoutes([]);
                }}
              >
                Назад
              </button>
              <span>
                Страница {page} из{" "}
                {Math.max(1, Math.ceil(data.total / data.pageSize))} · записей{" "}
                {data.total}
              </span>
              <button
                type="button"
                disabled={page * data.pageSize >= data.total}
                onClick={() => {
                  setPage((p) => p + 1);
                  setRoutes([]);
                }}
              >
                Далее
              </button>
            </nav>
          </details>
        </>
      ) : null}
    </section>
  );
}
