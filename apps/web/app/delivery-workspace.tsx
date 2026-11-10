"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { webRequest } from "./session";
import { DeliveryForm } from "./owner-dashboard";
import { FleetPanel } from "./fleet-panel";
import { useReferences, tonnes } from "./workflow-ui";
import { recordLabel } from "./record-label";
import { RecordDrawer } from "./design-system";
type Row = Record<string, any>;
export function DeliveryWorkspace({ token }: { token: string }) {
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<Row | null>(null),
    [route, setRoute] = useState("");
  const refs = useReferences(token);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["deliveries", token, page],
    queryFn: () =>
      webRequest<Row>(`/processing/deliveries?page=${page}&pageSize=20`, token),
    refetchInterval: 30000,
  });
  const status: Row = {
    PLANNED: "Запланирована",
    IN_TRANSIT: "В пути",
    ARRIVED: "Прибыла к покупателю",
    DELIVERED: "Вручена покупателю",
  };
  return (
    <div className="workflow-stack">
      <section className="panel">
        <h2>Доставка продукции</h2>
        <p>
          Доставка оформляется при продаже с мойки или отпуске готовой
          продукции. Отслеживание машины необязательно.
        </p>
        {q.error && (
          <p role="alert" className="error">
            {q.error.message}
          </p>
        )}
        {q.isPending && <p>Загружаем доставки…</p>}
        {q.data?.data.length === 0 && (
          <p>Доставок пока нет. При продаже выберите «Оформить доставку».</p>
        )}
        {q.data?.data.map((d: Row) => (
          <article className="workflow-event" key={d.id}>
            <h3>{recordLabel(d.number ?? "Доставка покупателю")}</h3>
            <p>
              {status[d.status]} · {d.destination} · {tonnes(d.quantity)} ·{" "}
              {d.bagCount} биг-бэг
            </p>
            <p>
              {d.driverName} · {d.vehiclePlate} · {d.route} ·{" "}
              {d.trackingEnabled ? "Отслеживание включено" : "Без отслеживания"}
            </p>
            <div className="toolbar">
              <button
                className="button"
                onClick={() => {
                  setSelected(d);
                  setRoute("");
                }}
              >
                Открыть доставку
              </button>
              {d.trackingEnabled && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setRoute(d.id);
                    setSelected(null);
                  }}
                >
                  Маршрут и остановки
                </button>
              )}
            </div>
          </article>
        ))}
        <div className="toolbar">
          <button
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Назад
          </button>
          <span>Страница {page}</span>
          <button
            className="button secondary"
            disabled={!q.data || page * 20 >= q.data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Далее
          </button>
        </div>
      </section>
      {selected && (
        <RecordDrawer
          title={recordLabel(selected.number ?? "Доставка")}
          onClose={() => setSelected(null)}
        >
          <DeliveryForm
            token={token}
            record={{ id: selected.sourceId, delivery: selected }}
            drivers={refs.data?.drivers ?? []}
            vehicles={refs.data?.vehicles ?? []}
            onSaved={() => {
              setSelected(null);
              void q.refetch();
            }}
          />
        </RecordDrawer>
      )}
      {route && (
        <FleetPanel
          token={token}
          detailOnly
          initialTripId={route}
          key={route}
        />
      )}
    </div>
  );
}
