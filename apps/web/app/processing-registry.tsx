"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  SlidersHorizontal,
  FlaskConical,
  PackageCheck,
  X,
  ArrowRight,
  QrCode,
} from "lucide-react";
import { webRequest } from "./session";
import { ProcessingPanel } from "./processing-panel";
import { dateTime, tonnes } from "./workflow-ui";
type Row = Record<string, any>;
export function ProcessingRegistry({
  token,
  permissions,
  mode,
}: {
  token: string;
  permissions: string[];
  mode: "laboratory" | "bags";
}) {
  const [search, setSearch] = useState(""),
    [stage, setStage] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [batch, setBatch] = useState("");
  const modal = useRef<HTMLDialogElement>(null);
  const q = useQuery({
    queryKey: ["processing-registry", mode, token, search, stage, status, page],
    queryFn: () =>
      webRequest<Row>(
        `/processing/${mode}?${new URLSearchParams({ page: String(page), pageSize: "20", ...(search ? { search } : {}), ...(stage ? { stage } : {}), ...(status ? { status } : {}) })}`,
        token,
      ),
  });
  const filtered = !!(search || stage || status),
    lab = mode === "laboratory";
  useEffect(() => {
    if (batch) modal.current?.showModal();
  }, [batch]);
  const close = () => {
    if (
      !window.dispatchEvent(
        new CustomEvent("bioflow:navigate", {
          cancelable: true,
          detail: { container: modal.current },
        }),
      )
    )
      return;
    modal.current?.close();
    setBatch("");
  };
  return (
    <div className="workflow-stack">
      <div className="registry-intro">
        <div className="registry-icon">
          {lab ? <FlaskConical /> : <PackageCheck />}
        </div>
        <div>
          <h2>
            {lab ? "Лаборатория и контроль качества" : "Биг-бэги и упаковка"}
          </h2>
          <p className="metric">
            {lab
              ? "Анализы, исходная масса и результат после осадка — отдельно от влажности."
              : "Индивидуальные QR, фактический вес, приёмка, упаковка и отпуск."}
          </p>
        </div>
      </div>
      <div
        className="registry-filters"
        role="search"
        aria-label={lab ? "Поиск анализов" : "Поиск биг-бэгов"}
      >
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Номер партии"
            value={search}
            placeholder="Номер партии"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {!lab && (
          <>
            <label>
              Состояние материала
              <select
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Все состояния</option>
                <option value="WASHED">Мытое</option>
                <option value="DRIED">Готовая продукция</option>
              </select>
            </label>
            <label>
              Действия с биг-бэгом
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Все статусы</option>
                <option value="AVAILABLE">Не отпущен</option>
                <option value="PACKED">Упакован</option>
                <option value="SOLD">Отпущен</option>
              </select>
            </label>
          </>
        )}
        {filtered && (
          <button
            className="button secondary"
            onClick={() => {
              setSearch("");
              setStage("");
              setStatus("");
              setPage(1);
            }}
          >
            <SlidersHorizontal size={18} />
            Сбросить фильтры
          </button>
        )}
      </div>
      {q.isPending ? (
        <p role="status" className="notice">
          Загружаем {lab ? "результаты лаборатории" : "биг-бэги"}…
        </p>
      ) : q.error ? (
        <div className="error" role="alert">
          <p>{q.error.message}</p>
          <button className="button secondary" onClick={() => q.refetch()}>
            Повторить
          </button>
        </div>
      ) : (
        <>
          <div className="registry-summary">
            <strong>
              {q.data!.total} {lab ? "анализов" : "биг-бэгов"}
            </strong>
            <span>
              {filtered ? "По выбранным фильтрам" : "В доступной области"} ·{" "}
              {q.data!.data.length} на странице
            </span>
          </div>
          {!q.data!.data.length ? (
            <div className="empty-state">
              <strong>
                {q.data!.scopeEmpty
                  ? "Объекты не назначены"
                  : filtered
                    ? "Нет совпадений"
                    : lab
                      ? "Анализов пока нет"
                      : "Биг-бэгов пока нет"}
              </strong>
              {q.data!.scopeEmpty
                ? "Администратор назначит вам рабочий склад. Чужие записи не показываются."
                : filtered
                  ? "Измените номер или сбросьте фильтры."
                  : lab
                    ? "Откройте партию по QR, чтобы внести анализ при наличии права."
                    : "Подтверждённый выпуск мойки или завода создаёт индивидуальные биг-бэги."}
            </div>
          ) : (
            <section className="tableWrap">
              <h2>{lab ? "Журнал анализов" : "Реестр биг-бэгов"}</h2>
              <div
                className="tableScroll"
                tabIndex={0}
                role="region"
                aria-label={lab ? "Таблица анализов" : "Таблица биг-бэгов"}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{lab ? "Партия" : "Биг-бэг / партия"}</th>
                      {lab ? (
                        <>
                          <th scope="col">Анализ</th>
                          <th scope="col">Влажность / осадок</th>
                          <th scope="col">Исходная база</th>
                          <th scope="col">Расчёт после осадка</th>
                          <th scope="col">Для учёта</th>
                        </>
                      ) : (
                        <>
                          <th scope="col">Материал / вес</th>
                          <th scope="col">Местонахождение</th>
                          <th scope="col">Состояние</th>
                          <th scope="col">Упаковка</th>
                        </>
                      )}
                      <th scope="col">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data!.data.map((r: Row) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.batch.number}</strong>
                          {!lab && (
                            <small className="table-meta">
                              Биг-бэг №{r.ordinal}
                            </small>
                          )}
                        </td>
                        {lab ? (
                          <>
                            <td>
                              {dateTime(r.measuredAt)}
                              <small className="table-meta">
                                {r.analystName}
                              </small>
                            </td>
                            <td>
                              {r.moisturePercent}% / {r.sedimentPercent}%
                            </td>
                            <td>{tonnes(r.baseQuantity)}</td>
                            <td>
                              {(
                                Number(r.calculatedQuantity) * 1000
                              ).toLocaleString("ru-RU", {
                                maximumFractionDigits: 2,
                              })}{" "}
                              кг
                              <small className="table-meta">
                                Расчёт, до округления
                              </small>
                            </td>
                            <td>
                              {tonnes(r.actualQuantity)}
                              <small className="table-meta">
                                {r.actualBagCount} мешков
                              </small>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              {r.stage === "WASHED"
                                ? "Мытое"
                                : "Готовая продукция"}
                              <small className="table-meta">
                                {tonnes(r.quantity)}
                              </small>
                            </td>
                            <td>
                              {r.soldAt
                                ? "Отпущен"
                                : r.batch.stocks
                                    .filter((s: Row) => Number(s.quantity) > 0)
                                    .map(
                                      (s: Row) =>
                                        s.warehouse?.name ??
                                        "Назначенный объект",
                                    )
                                    .join(", ") || "Нет доступного остатка"}
                            </td>
                            <td>
                              <span className="status">
                                {r.soldAt
                                  ? "Отпущен"
                                  : r.receivedAt
                                    ? "На готовом складе"
                                    : r.factoryStartedAt
                                      ? "На заводе"
                                      : r.stage === "WASHED"
                                        ? "После мойки"
                                        : "Ожидает приёмки"}
                              </span>
                            </td>
                            <td>
                              {r.packedAt ? (
                                <>
                                  {r.packedByName}
                                  <small className="table-meta">
                                    {r.packingShift} · {r.packingDate}
                                  </small>
                                </>
                              ) : (
                                "Не упакован"
                              )}
                            </td>
                          </>
                        )}
                        <td>
                          <button
                            className="button secondary"
                            onClick={() => setBatch(r.batch.id)}
                          >
                            <ArrowRight size={16} />
                            Открыть
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <div className="toolbar">
            <button
              className="button secondary"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Назад
            </button>
            <span>
              Страница {page} из {Math.max(1, Math.ceil(q.data!.total / 20))}
            </span>
            <button
              className="button secondary"
              disabled={page * 20 >= q.data!.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Далее
            </button>
          </div>
        </>
      )}
      {batch && (
        <dialog
          ref={modal}
          className="record-drawer"
          aria-label="Паспорт партии"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
          onClose={() => setBatch("")}
        >
          <div className="drawer-heading">
            <div>
              <span className="eyebrow">Партия и происхождение</span>
              <h2>
                <QrCode size={20} />
                Паспорт партии
              </h2>
            </div>
            <button
              className="icon-button"
              aria-label="Закрыть паспорт"
              onClick={close}
            >
              <X />
            </button>
          </div>
          <ProcessingPanel
            key={batch}
            token={token}
            permissions={permissions}
            initialBatchId={batch}
            embedded
          />
        </dialog>
      )}
    </div>
  );
}
