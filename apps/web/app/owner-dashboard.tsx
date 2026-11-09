"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { webRequest } from "./session";
import { LabeledInput, LabeledSelect, RecordDrawer } from "./design-system";
import { FleetPanel } from "./fleet-panel";
import { dateTime, tonnes, labels } from "./workflow-ui";
type Row = Record<string, any>;
const statusLabels: Record<string, string> = {
  ...labels,
  CONFIRMED: "Подтверждена",
  PARTIALLY_SHIPPED: "Частично отправлена",
  FULLY_SHIPPED: "Отправлена",
  CLOSED: "Закрыта",
  COMPLETED: "Завершена",
  UNLOADED: "Разгружена",
  REJECTED: "Отклонена",
  REVIEW: "На проверке",
  SHIPMENT: "Отгрузка",
  RETURN: "Возврат покупателя",
  PRODUCTION: "Производство",
  PLANNED: "Запланирована",
  DELIVERED: "Вручена покупателю",
};
const stages = [
  ["collection", "Сбор"],
  ["transport", "Перевозки"],
  ["laboratory", "Лаборатория"],
  ["washing", "Мойка"],
  ["factory", "Завод"],
  ["finished", "Готовая продукция"],
  ["stocks", "Склады и остатки"],
  ["sales", "Продажи"],
  ["delivery", "Доставка покупателю"],
  ["losses", "Потери"],
  ["deviations", "Отклонения"],
  ["idle", "Простои"],
];
export function OwnerDashboardPanel({ token }: { token: string }) {
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    warehouseId: "",
    employeeId: "",
    driverId: "",
  });
  const [selected, setSelected] = useState("collection"),
    [detail, setDetail] = useState<Row | null>(null),
    [trace, setTrace] = useState(""),
    [trip, setTrip] = useState(""),
    [page, setPage] = useState(1);
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  ).toString();
  const q = useQuery({
    queryKey: ["owner-dashboard", token, query],
    queryFn: () =>
      webRequest<Row>(`/processing/owner-dashboard?${query}`, token),
    refetchInterval: 30000,
  });
  const update = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
    setDetail(null);
    setTrace("");
    setTrip("");
  };
  const group = q.data?.groups[selected];
  return (
    <div className="workflow-stack">
      <section className="panel">
        <p className="eyebrow">Collection · Владелец</p>
        <h2>Весь путь материала</h2>
        <p>
          Выберите показатель, чтобы открыть записи, маршрут и полную историю
          партии.
        </p>
        <div className="toolbar">
          {[
            ["dateFrom", "С даты"],
            ["dateTo", "По дату"],
          ].map(([key, label]) => (
            <LabeledInput
              key={key}
              type="date"
              placeholder={label}
              value={filters[key as keyof typeof filters]}
              onChange={(e) => update(key, e.target.value)}
            />
          ))}
          {[
            ["warehouseId", "Склад", "warehouses"],
            ["employeeId", "Сотрудник", "employees"],
            ["driverId", "Водитель", "drivers"],
          ].map(([key, label, source]) => (
            <LabeledSelect
              key={key}
              label={label}
              value={filters[key as keyof typeof filters]}
              onChange={(e) => update(key, e.target.value)}
            >
              <option value="">Все</option>
              {q.data?.filters[source].map((r: Row) => (
                <option key={r.id} value={r.id}>
                  {r.name ?? r.fullName}
                </option>
              ))}
            </LabeledSelect>
          ))}
          <button
            className="button secondary"
            onClick={() => {
              setFilters({
                dateFrom: "",
                dateTo: "",
                warehouseId: "",
                employeeId: "",
                driverId: "",
              });
              setPage(1);
            }}
          >
            Сбросить
          </button>
        </div>
      </section>
      {q.isPending && <p role="status">Загружаем этапы…</p>}
      {q.error && (
        <p className="error" role="alert">
          {q.error.message}
        </p>
      )}
      {q.data && (
        <>
          <p className="metric">{q.data.note}</p>
          <div className="workflow-grid">
            {stages.map(([key, title]) => {
              const g = q.data.groups[key];
              return (
                <button
                  className={`workflow-stat owner-metric ${selected === key ? "selected" : ""}`}
                  key={key}
                  aria-pressed={selected === key}
                  onClick={() => {
                    setSelected(key);
                    setPage(1);
                    setDetail(null);
                  }}
                >
                  <span>{title}</span>
                  <strong>
                    {key === "idle"
                      ? `${g.idleMinutes ?? 0} мин`
                      : key === "deviations"
                        ? `${g.records.length} операций`
                        : tonnes(g.quantity)}
                  </strong>
                  <span>
                    {g.batches} партий · {g.bags} биг-бэгов
                  </span>
                  {key === "transport" && (
                    <small>
                      В пути: {g.inTransitCount ?? 0} · водителей:{" "}
                      {g.drivers ?? 0}
                    </small>
                  )}
                  <small>{g.records.length} записей →</small>
                </button>
              );
            })}
          </div>
          <section className="panel">
            <h2>{stages.find(([key]) => key === selected)?.[1]}</h2>
            <p>
              {group.records.length} записей · {group.batches} партий
            </p>
            {!group.records.length && (
              <p className="empty-state">Нет записей по выбранным фильтрам.</p>
            )}
            <div className="owner-records">
              {group.records.slice((page - 1) * 20, page * 20).map((r: Row) => (
                <button
                  className="workflow-event owner-record"
                  key={r.id}
                  onClick={() => {
                    setDetail(r);
                    setTrace("");
                    setTrip("");
                  }}
                >
                  <strong>{r.number}</strong>
                  <span>
                    {dateTime(r.date)} · {r.employee}
                  </span>
                  <span>
                    {r.location} · {statusLabels[r.status] ?? r.status}
                  </span>
                  <span>
                    {tonnes(selected === "losses" ? r.loss : r.quantity)} ·{" "}
                    {r.bags} биг-бэгов
                  </span>
                  <small>{r.detail}</small>
                </button>
              ))}
            </div>
            <div className="toolbar">
              <button
                className="button secondary"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Назад
              </button>
              <span>
                Страница {page} /{" "}
                {Math.max(1, Math.ceil(group.records.length / 20))}
              </span>
              <button
                className="button secondary"
                disabled={page * 20 >= group.records.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее
              </button>
            </div>
          </section>
        </>
      )}
      {detail && (
        <RecordDrawer
          title={detail.number}
          onClose={() => {
            setDetail(null);
            setTrace("");
            setTrip("");
          }}
        >
          <p>{detail.detail}</p>
          {selected === "delivery" && (
            <DeliveryForm
              token={token}
              record={detail}
              drivers={q.data?.filters.drivers ?? []}
              onSaved={() => {
                setDetail(null);
                void q.refetch();
              }}
            />
          )}
          <p>
            {detail.location} · {detail.employee} · {dateTime(detail.date)}
          </p>
          <p>{statusLabels[detail.status] ?? detail.status}</p>
          <div className="toolbar">
            {detail.batchIds.map((id: string, i: number) => (
              <button
                className="button"
                key={id}
                onClick={() => {
                  setTrace(id);
                  setTrip("");
                }}
              >
                Полная история партии
                {detail.batchIds.length > 1 ? ` ${i + 1}` : ""}
              </button>
            ))}
            {detail.tripId && (
              <button
                className="button secondary"
                onClick={() => {
                  setTrip(detail.tripId);
                  setTrace("");
                }}
              >
                Маршрут и простои
              </button>
            )}
          </div>
          {(trace || trip) && (
            <FleetPanel
              key={`${trace}:${trip}`}
              token={token}
              owner
              detailOnly
              initialTraceId={trace}
              initialTripId={trip}
            />
          )}
        </RecordDrawer>
      )}
    </div>
  );
}

function DeliveryForm({
  token,
  record,
  drivers,
  onSaved,
}: {
  token: string;
  record: Row;
  drivers: Row[];
  onSaved: () => void;
}) {
  const [values, setValues] = useState({
    driverId: record.delivery?.driverId ?? "",
    destination: record.delivery?.destination ?? "",
    route: record.delivery?.route ?? "",
    status: record.delivery?.status ?? "PLANNED",
    notes: "",
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const titles: Record<string, string> = {
    PLANNED: "Запланирована",
    IN_TRANSIT: "В пути",
    DELIVERED: "Вручена покупателю",
  };
  return (
    <section className="panel">
      <h3>Доставка покупателю</h3>
      <p>Подтверждение доставки не списывает материал повторно.</p>
      {record.delivery?.events?.map((e: Row) => (
        <p key={e.id}>
          {dateTime(e.createdAt)} · {titles[e.status]} · {e.createdByName} ·{" "}
          {e.driverName} · {e.route} · {e.destination} · {e.notes}
        </p>
      ))}
      {record.delivery?.status !== "DELIVERED" && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await webRequest("/processing/deliveries", token, {
                method: "POST",
                body: JSON.stringify({
                  ...values,
                  sourceId: record.id,
                  version: record.delivery?.version ?? 0,
                }),
              });
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Не удалось сохранить");
            } finally {
              setBusy(false);
            }
          }}
        >
          <LabeledSelect
            label="Водитель доставки"
            value={values.driverId}
            onChange={(e) =>
              setValues((v) => ({ ...v, driverId: e.target.value }))
            }
          >
            <option value="">Не назначен</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </LabeledSelect>
          <LabeledInput
            placeholder="Адрес покупателя"
            required
            maxLength={500}
            value={values.destination}
            onChange={(e) =>
              setValues((v) => ({ ...v, destination: e.target.value }))
            }
          />
          <LabeledInput
            placeholder="Маршрут доставки"
            required
            maxLength={1000}
            value={values.route}
            onChange={(e) =>
              setValues((v) => ({ ...v, route: e.target.value }))
            }
          />
          <LabeledSelect
            label="Статус доставки"
            value={values.status}
            onChange={(e) =>
              setValues((v) => ({ ...v, status: e.target.value }))
            }
          >
            {(record.delivery?.status === "IN_TRANSIT"
              ? ["IN_TRANSIT", "DELIVERED"]
              : record.delivery
                ? ["PLANNED", "IN_TRANSIT"]
                : ["PLANNED"]
            ).map((s) => (
              <option key={s} value={s}>
                {titles[s]}
              </option>
            ))}
          </LabeledSelect>
          <LabeledInput
            placeholder="Комментарий к доставке"
            maxLength={2000}
            value={values.notes}
            onChange={(e) =>
              setValues((v) => ({ ...v, notes: e.target.value }))
            }
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить доставку"}
          </button>
        </form>
      )}
    </section>
  );
}
