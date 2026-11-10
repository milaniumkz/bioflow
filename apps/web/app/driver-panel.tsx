"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { webRequest } from "./session";
import {
  browserPosition,
  flushBrowserGps,
  gpsState,
  startBrowserGps,
  stopBrowserGps,
} from "./browser-driver-gps";
import { labels, dateTime, tonnes } from "./workflow-ui";
import { isMobileWorkspace, mobileNotify } from "./mobile-bridge";
import { useRecordFocus } from "./use-record-focus";
import { recordLabel } from "./record-label";
type Row = Record<string, any>;
export function DriverPanel({
  token,
  initialTrip,
  onClearTrip,
}: {
  token: string;
  initialTrip?: { id: string; number: string; nonce: number };
  onClearTrip?: () => void;
}) {
  const partyRef = useRef<HTMLElement>(null);
  const qc = useQueryClient(),
    [gps, setGps] = useState(gpsState()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["driver-trips", token, initialTrip?.id],
    queryFn: () =>
      webRequest<Row>(
        `/tracking/trips?pageSize=100${initialTrip ? `&search=${encodeURIComponent(initialTrip.number)}` : ""}`,
        token,
      ),
    refetchInterval: 30000,
  });
  useRecordFocus(
    partyRef,
    q.data?.data.some((r: Row) => r.id === initialTrip?.id)
      ? initialTrip?.nonce
      : null,
  );
  useEffect(() => {
    const change = () => setGps(gpsState());
    window.addEventListener("collection:gps", change);
    return () => window.removeEventListener("collection:gps", change);
  }, []);
  async function act(r: Row, status: string) {
    if (busy) return;
    if (isMobileWorkspace()) {
      mobileNotify({ action: "driverHome" });
      return;
    }
    setBusy(true);
    setError("");
    try {
      let fix: GeolocationPosition | undefined;
      if (
        status === "IN_TRANSIT" &&
        gpsState().running &&
        gpsState().tripId !== r.id
      )
        throw Error("Сначала остановите отслеживание другого рейса.");
      if (status !== "ARRIVED") fix = await browserPosition();
      if (status === "ARRIVED") {
        if (
          !confirm(
            "Вы прибыли? Запись новых геопозиций этого рейса будет остановлена.",
          )
        )
          return;
        await flushBrowserGps(token);
      }
      await webRequest(`/tracking/trips/${r.id}/status`, token, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      if (status === "IN_TRANSIT" && fix) {
        const profile = await webRequest<Row>("/auth/me", token);
        startBrowserGps(profile.id, r.id, token, fix);
      }
      if (status === "ARRIVED" && gpsState().tripId === r.id) stopBrowserGps();
      await qc.invalidateQueries({ queryKey: ["driver-trips"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workflow-stack">
      <section className="panel">
        <h2>Мои рейсы</h2>
        <p>Загрузился → Выехал → Прибыл. Время каждой отметки сохраняется.</p>
        <p>
          В браузере маршрут передаётся, пока страница открыта. При сворачивании
          и блокировке экрана браузер может остановить передачу геопозиции. Для
          фоновой записи используйте Android-приложение.
        </p>
        {gps.running && (
          <>
            <p role="status">
              {gps.message} Неотправленных точек: {gps.pending}.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={stopBrowserGps}
            >
              Остановить геолокацию
            </button>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {q.error && <p role="alert">{q.error.message}</p>}
      </section>
      {q.data && !q.data.data.length && (
        <p className="empty-state">Назначенных рейсов пока нет.</p>
      )}
      {initialTrip && (
        <button className="button secondary" onClick={onClearTrip}>
          Показать все рейсы
        </button>
      )}
      {q.data?.data.map((r: Row) => (
        <article
          ref={r.id === initialTrip?.id ? partyRef : undefined}
          tabIndex={-1}
          className="panel scanned-record"
          key={r.id}
          aria-label={r.id === initialTrip?.id ? "Рейс по QR" : undefined}
        >
          <h2>{r.vehicle.plateNumber}</h2>
          <p>
            {recordLabel(r.number)} · {labels[r.status] ?? r.status}
          </p>
          <p>
            {r.bagCount ?? "—"}{" "}
            {r.tripKind === "CUSTOMER_DELIVERY" ? "биг-бэгов" : "мешков"} ·{" "}
            {tonnes(r.declaredWeight)} · {r.destinationWarehouse.name}
          </p>
          <p>
            Загрузился: {dateTime(r.loadedAt)}
            <br />
            Выехал: {dateTime(r.departedAt)}
            <br />
            Прибыл: {dateTime(r.arrivedAt)}
          </p>
          {r.status === "CREATED" && r.bagCount !== null && (
            <button
              className="button"
              disabled={busy}
              onClick={() => void act(r, "LOADED")}
            >
              Загрузился
            </button>
          )}
          {r.status === "LOADED" && (
            <button
              className="button"
              disabled={busy}
              onClick={() => void act(r, "IN_TRANSIT")}
            >
              Выехал · включить геолокацию
            </button>
          )}
          {r.status === "IN_TRANSIT" && (
            <div className="toolbar">
              {(!gps.running || gps.tripId !== r.id) && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void act(r, "IN_TRANSIT")}
                >
                  Включить геолокацию
                </button>
              )}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void act(r, "ARRIVED")}
              >
                Прибыл
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
