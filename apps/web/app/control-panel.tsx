"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { webRequest } from "./session";
import { RouteMap } from "./route-map";
import { EvidenceFiles, dateTime, labels, tonnes } from "./workflow-ui";
type Row = Record<string, any>;
export function FleetPanel({
  token,
  owner = false,
}: {
  token: string;
  owner?: boolean;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [trip, setTrip] = useState("");
  const list = useQuery({
    queryKey: ["fleet", token, page, search],
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
  const [traceId, setTraceId] = useState("");
  const trace = useQuery({
    queryKey: ["owner-trace", token, traceId],
    enabled: !!traceId && owner,
    queryFn: () => webRequest<Row>(`/processing/trace/${traceId}`, token),
  });
  return (
    <div className="workflow-stack">
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
                {r.number} · {tonnes(r.declaredWeight)} · {r.bagCount ?? "—"}{" "}
                мешков
              </p>
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
                  title="Пробелы в GPS"
                  value={`${Math.round(route.data.metrics.signalGapSeconds / 60)} мин`}
                />
                <Metric
                  title="По GPS-точкам"
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
          {trace.error && <p className="error">{trace.error.message}</p>}
          {trace.data && (
            <>
              <h3>{trace.data.root.number}</h3>
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
                    {r.createdByName ?? r.createdById}
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
export function ControlPanel({ token }: { token: string }) {
  const q = useQuery({
    queryKey: ["control", token],
    queryFn: () => webRequest<Row>("/processing/overview", token),
    refetchInterval: 30000,
  });
  if (q.isPending) return <p>Собираем данные всех этапов…</p>;
  if (q.error) return <p className="error">{q.error.message}</p>;
  const d = q.data!;
  return (
    <div className="workflow-stack">
      <div className="overview-metrics">
        <Metric title="Всего собрано" value={tonnes(d.collected)} />
        <Metric title="В пути" value={`${d.inTransitCount} рейсов`} />
        <Metric title="Принято на мойку" value={tonnes(d.received)} />
        <Metric
          title="Отпущено материала"
          value={tonnes(Number(d.soldWashed) + Number(d.soldFinished))}
        />
      </div>
      <div className="overview-layout">
        <section className="panel">
          <h2>Материал по этапам</h2>
          <p className="metric">Текущее местонахождение · фактический вес, т</p>
          <div className="stage-chart">
            {d.currentStages.map((s: Row) => (
              <div className="stage-bar-row" key={s.label}>
                <span>{s.label}</span>
                <div className="stage-bar-track">
                  <div
                    className="stage-bar-fill"
                    style={{
                      width: `${(Math.max(0, Number(s.quantity)) / Math.max(1, ...d.currentStages.map((x: Row) => Number(x.quantity)))) * 100}%`,
                    }}
                  />
                </div>
                <strong>{tonnes(s.quantity)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Требует внимания</h2>
          {d.alerts.length ? (
            d.alerts.slice(0, 4).map((a: Row) => (
              <article className="workflow-event" key={a.id}>
                <strong>{a.title}</strong>
                <p>{a.body}</p>
                <small>{dateTime(a.createdAt)}</small>
              </article>
            ))
          ) : (
            <p className="empty-state">Уведомлений о задержках пока нет.</p>
          )}
          <p className="metric">
            Операций с отклонениями: {d.deviations}. Это сравнение фактов, а не
            автоматическое списание.
          </p>
        </section>
      </div>
      <details className="panel">
        <summary>Полная детализация движения материала</summary>
        <p className="eyebrow">Владелец · обновление каждые 30 секунд</p>
        <h2>Движение материала</h2>
        <p>
          Всего за время учёта. Остатки по складам ниже показывают текущее
          наличие.
        </p>
        <div className="workflow-grid">
          <Metric
            title="Всего собрано по партиям"
            value={tonnes(d.collected)}
          />
          <Metric title="Отправлено в рейсах" value={tonnes(d.sent)} />
          <Metric title="Принято на мойку" value={tonnes(d.received)} />
          {d.stages.map((s: Row) => (
            <Metric
              key={s.kind}
              title={`${labels[s.kind]}: вход → выход`}
              value={`${tonnes(s.inputQuantity)} → ${tonnes(s.outputQuantity)}`}
            />
          ))}
          <Metric title="Продано мытого" value={tonnes(d.soldWashed)} />
          <Metric title="Продано готового" value={tonnes(d.soldFinished)} />
          <Metric title="Водителей в пути" value={String(d.driversInTransit)} />
          <Metric title="Рейсов в пути" value={String(d.inTransitCount)} />
          <Metric
            title="Ожидают приёмки после завода"
            value={`${d.awaitingFinishedReceipt} биг-бэгов`}
          />
          <Metric
            title="Упаковано за всё время"
            value={`${d.packedBigBags} биг-бэгов`}
          />
          <Metric
            title="Операций с отклонениями"
            value={String(d.deviations)}
          />
        </div>
      </details>
      <section className="panel">
        <h2>Где находится материал сейчас</h2>
        <p className="metric">
          Вес включает все складские остатки. Количество биг-бэгов учитывается
          по индивидуальным QR.
        </p>
        <div className="workflow-grid">
          {d.currentStages.map((s: Row) => (
            <Metric key={s.label} title={s.label} value={tonnes(s.quantity)} />
          ))}
        </div>
        <div className="workflow-grid">
          {d.warehouses.map((w: Row) => (
            <article className="workflow-event" key={w.id}>
              <h3>{w.name}</h3>
              {w.byState.map((s: Row) => (
                <p key={s.state}>
                  {labels[s.state]}: <strong>{tonnes(s.quantity)}</strong>
                  {s.bigBags ? ` · ${s.bigBags} биг-бэгов` : ""}
                </p>
              ))}
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Задержки водителей</h2>
        {d.alerts.length ? (
          d.alerts.map((a: Row) => (
            <article className="workflow-event" key={a.id}>
              <strong>{a.title}</strong>
              <p>{a.body}</p>
              <small>{dateTime(a.createdAt)}</small>
            </article>
          ))
        ) : (
          <p>Подтверждённых задержек более 10 минут нет.</p>
        )}
      </section>
      <FleetPanel token={token} owner />
    </div>
  );
}
