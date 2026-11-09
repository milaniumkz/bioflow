"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { webRequest } from "./session";
import { RouteMap } from "./route-map";
import { EvidenceFiles, dateTime, labels, tonnes } from "./workflow-ui";
import { visibleText } from "./presentation";
import { recordLabel } from "./record-label";
type Row = Record<string, any>;
export function FleetPanel({
  token,
  owner = false,
  initialTraceId = "",
  initialTripId = "",
  detailOnly = false,
}: {
  token: string;
  owner?: boolean;
  initialTraceId?: string;
  initialTripId?: string;
  detailOnly?: boolean;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [trip, setTrip] = useState(initialTripId);
  const list = useQuery({
    queryKey: ["fleet", token, page, search],
    enabled: !detailOnly,
    queryFn: () =>
      webRequest<Row>(
        `/collection/trips?page=${page}&pageSize=20&search=${encodeURIComponent(search)}`,
        token,
      ),
    refetchInterval: 30000,
  });
  const route = useQuery({
    queryKey: ["route", token, trip],
    enabled: !!trip,
    refetchInterval: 30000,
    queryFn: async () => {
      const first = await webRequest<Row>(
        `/tracking/trips/${trip}/route?pageSize=100`,
        token,
      );
      const data = [...first.data];
      for (let page = 2; data.length < first.total; page++) {
        const r = await webRequest<Row>(
          `/tracking/trips/${trip}/route?pageSize=100&page=${page}`,
          token,
        );
        if (!r.data.length) break;
        data.push(...r.data);
      }
      return { ...first, data } as Row;
    },
  });
  const [traceId, setTraceId] = useState(initialTraceId);
  const trace = useQuery({
    queryKey: ["owner-trace", token, traceId],
    enabled: !!traceId && owner,
    queryFn: () => webRequest<Row>(`/processing/trace/${traceId}`, token),
  });
  return (
    <div className="workflow-stack">
      {!detailOnly && (
        <section className="panel">
          <h2>{owner ? "Рейсы и история партий" : "Мои водители и рейсы"}</h2>
          <label>
            Номер рейса
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          {list.error && <p className="error">{list.error.message}</p>}
          <div className="workflow-grid">
            {list.data?.data.map((r: Row) => (
              <article className="workflow-event" key={r.id}>
                <h3>{r.driver?.fullName ?? "Водитель не назначен"}</h3>
                <p>
                  {r.vehicle.plateNumber} · {labels[r.status] ?? r.status}
                </p>
                <p>
                  {recordLabel(r.number)} · {tonnes(r.declaredWeight)} ·{" "}
                  {r.bagCount ?? "—"} мешков
                </p>
                <p>Загрузился: {dateTime(r.loadedAt)}</p>
                <p>Выезд: {dateTime(r.departedAt)}</p>
                <p>
                  Последняя геопозиция: {dateTime(r.routePoints[0]?.recordedAt)}
                </p>
                {r.driver?.phone && (
                  <a href={`tel:${r.driver.phone}`}>
                    Позвонить: {r.driver.phone}
                  </a>
                )}
                <div className="toolbar">
                  <button className="button" onClick={() => setTrip(r.id)}>
                    Маршрут и остановки
                  </button>
                  {owner && r.batchId && (
                    <button
                      className="button secondary"
                      onClick={() => setTraceId(r.batchId)}
                    >
                      Вся история партии
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          <div className="toolbar">
            <button
              className="button secondary"
              disabled={page === 1}
              onClick={() => setPage((x) => x - 1)}
            >
              Назад
            </button>
            <span>Страница {page}</span>
            <button
              className="button secondary"
              disabled={!list.data || page * 20 >= list.data.total}
              onClick={() => setPage((x) => x + 1)}
            >
              Далее
            </button>
          </div>
        </section>
      )}
      {trip && (
        <section className="panel">
          <h2>Маршрут и время рейса</h2>
          {route.isPending && <p>Загружаем записанный маршрут…</p>}
          {route.error && <p className="error">{route.error.message}</p>}
          {route.data && (
            <>
              <div className="workflow-grid">
                <Metric
                  title="Время выезда"
                  value={dateTime(route.data.metrics.departedAt)}
                />
                <Metric
                  title="Время прибытия"
                  value={dateTime(route.data.metrics.arrivedAt)}
                />
                <Metric
                  title="Наблюдаемое движение"
                  value={`${Math.round(route.data.metrics.movingSeconds / 60)} мин`}
                />
                <Metric
                  title="Подтверждённые остановки"
                  value={`${Math.round(route.data.metrics.stoppedSeconds / 60)} мин`}
                />
                <Metric
                  title="Пробелы в геолокации"
                  value={`${Math.round(route.data.metrics.signalGapSeconds / 60)} мин`}
                />
                <Metric
                  title="По записанным координатам"
                  value={`${route.data.metrics.distanceKm} км`}
                />
              </div>
              <RouteMap points={route.data.data} stops={route.data.stops} />
              {route.data.stops
                .filter(
                  (s: Row) =>
                    Date.parse(s.lastObservedAt) - Date.parse(s.startedAt) >=
                    60000,
                )
                .map((s: Row) => (
                  <div className="workflow-event" key={s.id}>
                    <strong>
                      {Math.floor(
                        (Date.parse(s.lastObservedAt) -
                          Date.parse(s.startedAt)) /
                          60000,
                      )}{" "}
                      мин
                    </strong>{" "}
                    · {dateTime(s.startedAt)} — {dateTime(s.lastObservedAt)}
                    <p>
                      {s.latitude.toFixed(6)}, {s.longitude.toFixed(6)}
                      {s.notifiedAt ? " · Уведомление о задержке создано" : ""}
                    </p>
                  </div>
                ))}
            </>
          )}
        </section>
      )}
      {traceId && owner && (
        <section className="panel">
          <h2>Полная история партии</h2>
          {trace.isPending && (
            <p role="status">Загружаем всю историю партии…</p>
          )}
          {trace.error && <p className="error">{trace.error.message}</p>}
          {trace.data && (
            <>
              <h3>{recordLabel(trace.data.root.number)}</h3>
              <p>
                Сборщик: {trace.data.root.createdByName} ·{" "}
                {dateTime(trace.data.root.measuredAt)}
              </p>
              <div className="workflow-grid">
                <Metric
                  title="Собрано"
                  value={tonnes(trace.data.summary.collected)}
                />
                <Metric
                  title="Готового произведено"
                  value={tonnes(trace.data.summary.finishedProduced)}
                />
                <Metric
                  title="Продано после мойки"
                  value={tonnes(trace.data.summary.washedSold)}
                />
                <Metric
                  title="Ожидание при общей потере 51%"
                  value={tonnes(trace.data.summary.expectedFinished)}
                />
              </div>
              <p>
                {trace.data.summary.comparisonComplete
                  ? `Фактическая общая потеря ${trace.data.summary.actualLossPercent}%; норма 51%; отклонение ${trace.data.summary.deviationPercentagePoints} п.п.`
                  : "Обработка ещё не завершена или часть материала продана после мойки; итоговая потеря пока не сопоставима с нормой."}
              </p>
              {trace.data.root.laboratoryAnalyses.map((a: Row) => (
                <p key={a.id}>
                  Лаборатория: влажность {a.moisturePercent}%, осадок{" "}
                  {a.sedimentPercent}%, материал {tonnes(a.actualQuantity)},{" "}
                  {a.actualBagCount} мешков · {a.analystName} ·{" "}
                  {dateTime(a.measuredAt)}
                </p>
              ))}
              {trace.data.root.waybills.map((t: Row) => (
                <div className="workflow-event" key={t.id}>
                  <p>
                    Отправлено {tonnes(t.declaredWeight)} · {t.bagCount} мешков
                    · {t.driver?.fullName}
                  </p>
                  <p>
                    Принято {tonnes(t.receivedWeight)} ·{" "}
                    {t.receivedBagCount ?? "—"} мешков ·{" "}
                    {dateTime(t.acceptedAt)}
                  </p>
                  {t.discrepancyReason && <p>{t.discrepancyReason}</p>}
                </div>
              ))}
              <h3>Доставка покупателю</h3>
              {trace.data.deliveries?.map((d: Row) => (
                <article className="workflow-event" key={d.id}>
                  <strong>
                    {
                      (
                        {
                          PLANNED: "Запланирована",
                          IN_TRANSIT: "В пути",
                          DELIVERED: "Вручена покупателю",
                        } as Record<string, string>
                      )[d.status]
                    }
                  </strong>
                  <p>
                    {d.route} · {d.destination} · {d.driverName}
                  </p>
                  {d.events.map((e: Row) => (
                    <p key={e.id}>
                      {dateTime(e.createdAt)} ·{" "}
                      {
                        (
                          {
                            PLANNED: "План",
                            IN_TRANSIT: "Выезд",
                            DELIVERED: "Вручение",
                          } as Record<string, string>
                        )[e.status]
                      }{" "}
                      · {e.driverName} · {e.createdByName} · {e.notes}
                    </p>
                  ))}
                </article>
              ))}
              <h3>Движения, остатки и корректировки</h3>
              {trace.data.movements?.map((m: Row) => (
                <article className="workflow-event" key={m.id}>
                  <strong>
                    {labels[m.kind] ?? m.kind} · {tonnes(m.quantity)}
                  </strong>
                  <p>
                    {m.warehouseName} · {m.createdByName} ·{" "}
                    {dateTime(m.createdAt)}
                  </p>
                  <p>{visibleText(m.reason)}</p>
                </article>
              ))}
              {trace.data.root.stocks?.map((s: Row) => (
                <p key={s.id}>
                  {s.warehouseName} · Остаток: {tonnes(s.quantity)} · резерв{" "}
                  {tonnes(s.reserved)}
                </p>
              ))}
              <EvidenceFiles token={token} files={trace.data.files ?? []} />
              {trace.data.runs.map((r: Row) => (
                <div className="workflow-event" key={r.id}>
                  <h3>
                    {labels[r.kind]} · {dateTime(r.createdAt)}
                  </h3>
                  <p>
                    {tonnes(r.inputQuantity)} → {tonnes(r.outputQuantity)} ·
                    Потеря {r.coefficientPercent}% · {labels[r.deviation]}
                  </p>
                  <p>
                    {r.createdByName ?? "Сотрудник"}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                  {r.bags.map((b: Row) => (
                    <p key={b.id}>
                      Биг-бэг №{b.ordinal} · {tonnes(b.quantity)}
                      {b.receivedAt ? " · на складе" : ""}
                      {b.packedAt ? ` · упакован, смена ${b.packingShift}` : ""}
                      {b.soldAt
                        ? ` · продан ${b.saleRecipient}, документ ${b.saleDocument}`
                        : ""}
                    </p>
                  ))}
                </div>
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}
function Metric({ title, value }: { title: string; value: string }) {
  return (
    <article className="workflow-stat">
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}
