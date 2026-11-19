"use client";
import { useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { webRequest } from "../session";
import { kgAsTonnes } from "./weight-units";
import { LaboratoryResult } from "./laboratory";
import "./collector-reports.css";
type Row = Record<string, any>;
type Period = {
  from: string;
  to: string;
  basis: "delivery" | "dispatch" | "acceptance";
};
const bases = {
  delivery: "Доставка на мойку",
  dispatch: "Создание отправки",
  acceptance: "Подтверждение приёмки",
};
const statuses: Record<string, string> = {
  CREATED: "QR создан",
  LOADED: "Загрузился",
  IN_TRANSIT: "В пути",
  ARRIVED: "Ожидает лаборатории",
  ACCEPTED: "Принято",
  CANCELLED: "Отменено",
};
const day = (value: string) => value.split("-").reverse().join(".");
const time = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })
    : "—";
function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function shifted(value: string, n: number) {
  return new Date(new Date(value + "T12:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
function query(period: Period, page?: number) {
  const p = new URLSearchParams({ basis: period.basis });
  if (period.from) p.set("from", period.from);
  if (period.to) p.set("to", period.to);
  if (page) {
    p.set("page", String(page));
    p.set("pageSize", "20");
  }
  return p.toString();
}
const measures = [
  ["deliveredKg", "Доставлено на мойку"],
  ["laboratoryKg", "Проверено лабораторией"],
  ["deductionKg", "Вычеты лаборатории"],
  ["acceptedKg", "Итоговое принятое сырьё"],
] as const;
function Metrics({ summary: s }: { summary: Row }) {
  return (
    <div className="cr-metrics">
      {measures.map(([key, label]) => (
        <article key={key}>
          <span>{label}</span>
          <strong>
            {kgAsTonnes(s[key])}
            <small> т</small>
          </strong>
        </article>
      ))}
    </div>
  );
}
export function CollectorReports({ token }: { token: string }) {
  const [period, setPeriod] = useState<Period>({
      from: "",
      to: "",
      basis: "delivery",
    }),
    [draft, setDraft] = useState<Period>(period),
    [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [formError, setFormError] = useState("");
  const filterPanel = useRef<HTMLDetailsElement>(null);
  const directory = useQuery({
    queryKey: ["collector-directory", token, period],
    queryFn: () =>
      webRequest<Row>("/collection/collectors?" + query(period), token),
    refetchInterval: 5000,
  });
  const report = useQuery({
    queryKey: ["collector-report", token, selected, period, page],
    queryFn: () =>
      webRequest<Row>(
        `/collection/collectors/${encodeURIComponent(selected)}?` +
          query(period, page),
        token,
      ),
    enabled: !!selected,
    refetchInterval: 5000,
  });
  function apply(values: Period) {
    if (values.from && values.to && values.from > values.to) {
      setFormError("Дата «с» не должна быть позже даты «по»");
      return;
    }
    setFormError("");
    setPeriod(values);
    setDraft(values);
    setPage(1);
    if (filterPanel.current) filterPanel.current.open = false;
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    apply({ ...draft });
  }
  function preset(kind: string) {
    const date = today();
    const range =
      kind === "today"
        ? [date, date]
        : kind === "yesterday"
          ? [shifted(date, -1), shifted(date, -1)]
          : kind === "week"
            ? [shifted(date, -6), date]
            : kind === "month"
              ? [date.slice(0, 8) + "01", date]
              : ["", ""];
    apply({ basis: draft.basis, from: range[0], to: range[1] });
  }
  const data = report.data,
    collectors: Row[] = directory.data?.collectors ?? [];
  const error = selected ? report.error : directory.error;
  const match = (u: Row) =>
    (u.fullName + " " + (u.phone ?? ""))
      .toLocaleLowerCase("ru")
      .replace(/[\s()+-]/g, "")
      .includes(search.toLocaleLowerCase("ru").replace(/[\s()+-]/g, ""));
  return (
    <section className="cr-report" aria-label="Отчёты по сборщикам">
      <header className="cr-heading">
        <div>
          <p className="cr-eyebrow">СБОР · ЛАБОРАТОРИЯ · ПРИЁМКА</p>
          <h2>
            {selected
              ? (data?.collector.fullName ??
                collectors.find((c) => c.id === selected)?.fullName ??
                "Карточка сборщика")
              : "Сборщики — подробные отчёты"}
          </h2>
          <p>
            {selected
              ? (data?.collector.phone ?? "")
              : "Откройте сборщика, чтобы увидеть его поставки, лабораторию и итоговое принятое сырьё."}
          </p>
        </div>
        {selected ? (
          <button
            type="button"
            onClick={() => {
              setSelected("");
              setPage(1);
            }}
          >
            ← К списку сборщиков
          </button>
        ) : null}
      </header>
      <details ref={filterPanel} className="cr-filter-panel">
        <summary>Фильтры по датам</summary>
        <form className="cr-filter" onSubmit={submit}>
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
            Дата для отчёта
            <select
              value={draft.basis}
              onChange={(e) =>
                setDraft({ ...draft, basis: e.target.value as Period["basis"] })
              }
            >
              {Object.entries(bases).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button>Показать</button>
          <div className="cr-presets">
            {[
              ["today", "Сегодня"],
              ["yesterday", "Вчера"],
              ["week", "7 дней"],
              ["month", "Этот месяц"],
              ["all", "Весь период"],
            ].map(([key, title]) => (
              <button key={key} type="button" onClick={() => preset(key)}>
                {title}
              </button>
            ))}
          </div>
          <p className="cr-range">
            {bases[period.basis]} ·{" "}
            {period.from ? day(period.from) : "начало учёта"} —{" "}
            {period.to ? day(period.to) : "всё время"}. Дни по местному времени
            UTC+5, дата «по» включительно.
          </p>
          {formError ? <p role="alert">{formError}</p> : null}
        </form>
      </details>
      {error ? (
        <p role="alert" className="cr-error">
          {error.message}
        </p>
      ) : null}
      {!selected ? (
        <>
          <label className="cr-search">
            Найти сборщика
            <input
              type="search"
              placeholder="ФИО или номер телефона"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {directory.isPending ? (
            <p role="status">Загружаем сборщиков…</p>
          ) : null}
          <div className="cr-directory">
            {collectors.filter(match).map((user) => (
              <article className="cr-person" key={user.id}>
                <h3>{user.fullName}</h3>
                <p>
                  {user.phone ?? "Телефон не указан"}
                  {user.isBlocked ? " · доступ заблокирован" : ""}
                </p>
                <dl>
                  <div>
                    <dt>Доставлено</dt>
                    <dd>{kgAsTonnes(user.summary.deliveredKg)} т</dd>
                  </div>
                  <div>
                    <dt>Вычеты лаборатории</dt>
                    <dd>{kgAsTonnes(user.summary.deductionKg)} т</dd>
                  </div>
                  <div>
                    <dt>Итоговое принятое сырьё</dt>
                    <dd>{kgAsTonnes(user.summary.acceptedKg)} т</dd>
                  </div>
                </dl>
                <p>
                  {user.summary.deliveredCount} доставок ·{" "}
                  {user.summary.acceptedCount} приёмок
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(user.id);
                    setPage(1);
                  }}
                  aria-label={`Открыть отчёт: ${user.fullName}`}
                >
                  Открыть сборщика →
                </button>
              </article>
            ))}
          </div>
          {!directory.isPending && !collectors.filter(match).length ? (
            <p className="cr-empty">Сборщики не найдены.</p>
          ) : null}
        </>
      ) : (
        <>
          {report.isPending ? (
            <p role="status">Загружаем отчёт сборщика…</p>
          ) : null}
          {data ? (
            <>
              <Metrics summary={data.summary} />
              <p className="cr-note">
                {data.summary.shipmentCount} отправок ·{" "}
                {data.summary.deliveredCount} доставок ·{" "}
                {data.summary.acceptedCount} подтверждённых приёмок. Отправлено{" "}
                {kgAsTonnes(data.summary.dispatchedKg)} т. Ожидает лаборатории{" "}
                {kgAsTonnes(data.summary.pendingLabKg)} т; ещё в пути / не
                доставлено {kgAsTonnes(data.summary.pendingTransitKg)} т.
                Отменено: {data.summary.cancelledCount} — их вес исключён из
                итогов.
              </p>
              {data.summary.legacyCount > 0 ? (
                <p className="cr-note">
                  Исторических приёмок без сохранённых лабораторных показателей:{" "}
                  {data.summary.legacyCount}. Их принятый вес учитывается по
                  прежним записям.
                </p>
              ) : null}
              <h3>Итоги по дням</h3>
              <div className="cr-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>День</th>
                      <th>Доставок</th>
                      <th>Доставлено, т</th>
                      <th>Лаборатория, т</th>
                      <th>Вычеты, т</th>
                      <th>Принято, т</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((row: Row) => (
                      <tr key={row.day}>
                        <td>
                          {row.day === "pending" ? (
                            "Дата не указана"
                          ) : (
                            <>
                              {" "}
                              <button
                                type="button"
                                onClick={() =>
                                  apply({
                                    ...period,
                                    from: row.day,
                                    to: row.day,
                                  })
                                }
                              >
                                {day(row.day)}
                              </button>
                            </>
                          )}
                        </td>
                        <td>{row.deliveredCount}</td>
                        <td>{kgAsTonnes(row.deliveredKg)}</td>
                        <td>{kgAsTonnes(row.laboratoryKg)}</td>
                        <td>{kgAsTonnes(row.deductionKg)}</td>
                        <td>{kgAsTonnes(row.acceptedKg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.days.length ? (
                <p className="cr-empty">За выбранный период поставок нет.</p>
              ) : null}
              <h3>Поставки и лаборатория</h3>
              <div className="cr-shipments">
                {data.shipments.map((trip: Row) => (
                  <article key={trip.id} className="cr-shipment">
                    <header>
                      <h4>{trip.number}</h4>
                      <span>{statuses[trip.status] ?? trip.status}</span>
                    </header>
                    <p>
                      {trip.warehouseName ?? "Мойка"} · {trip.bagCount} мешков
                    </p>
                    <p className="cr-dates">
                      Создано: {time(trip.createdAt)}
                      <br />
                      Доставлено: {time(trip.arrivedAt)}
                      <br />
                      Принято: {time(trip.confirmedAt)}
                    </p>
                    {trip.status === "CANCELLED" ? (
                      <p className="cr-note">
                        Отменено. Вес этой поставки не входит в итоговый зачёт.
                      </p>
                    ) : null}
                    {trip.laboratory ? (
                      <LaboratoryResult laboratory={trip.laboratory} />
                    ) : (
                      <p>
                        Отправлено: <b>{kgAsTonnes(trip.weightKg)} т</b>
                        <br />
                        {trip.status === "ACCEPTED" ? (
                          <>
                            Принято по исторической записи:{" "}
                            <b>
                              {kgAsTonnes(
                                trip.acceptedWeightKg ?? trip.weightKg,
                              )}{" "}
                              т
                            </b>
                            . Лабораторные показатели не сохранены.
                          </>
                        ) : trip.status === "CANCELLED" ? (
                          "Поставка отменена."
                        ) : (
                          "Лабораторная приёмка ещё не подтверждена."
                        )}
                      </p>
                    )}
                  </article>
                ))}
              </div>
              <nav
                className="cr-pagination"
                aria-label="Страницы поставок сборщика"
              >
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
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
                  onClick={() => setPage((p) => p + 1)}
                >
                  Далее
                </button>
              </nav>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
