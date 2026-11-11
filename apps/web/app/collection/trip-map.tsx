"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as Leaflet from "leaflet";
import { webRequest } from "../session";
import "leaflet/dist/leaflet.css";
export type Point = {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  recordedAt: string;
  receivedAt: string;
};
type Page = { points: Point[]; nextCursor: string | null; total: number };
export function TripMap({ id, token }: { id: string; token: string }) {
  const [open, setOpen] = useState(false);
  const route = useQuery({
    queryKey: ["collection-route", id, token],
    enabled: open && !!token,
    refetchInterval: 10000,
    queryFn: async () => {
      const points = new Map<string, Point>();
      let cursor: string | null = null;
      do {
        const page: Page = await webRequest<Page>(
          `/collection/trips/${encodeURIComponent(id)}/route${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`,
          token,
        );
        for (const p of page.points) points.set(p.id, p);
        cursor = page.nextCursor;
      } while (cursor);
      return [...points.values()].sort(
        (a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt),
      );
    },
  });
  return (
    <div className="c-route">
      <button
        type="button"
        className="secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Скрыть карту" : "Маршрут на карте"}
      </button>
      {open ? (
        <section aria-label="Карта маршрута" className="c-route-panel">
          <div className="c-heading">
            <div>
              <h4>Весь маршрут поездки</h4>
              <p className="c-muted">
                Фактические GPS-точки · обновление каждые 10 секунд
              </p>
            </div>
            <span className="c-tag">{route.data?.length ?? 0} точек</span>
          </div>
          {route.isError ? (
            <p role="alert">
              Не удалось загрузить маршрут.{" "}
              <button
                className="secondary"
                onClick={() => void route.refetch()}
              >
                Повторить
              </button>
            </p>
          ) : null}
          {route.isPending ? (
            <p role="status">Загружаем весь маршрут…</p>
          ) : null}
          {route.data?.length ? (
            <RouteCanvas points={route.data} />
          ) : !route.isPending ? (
            <p>
              Координат пока нет. Они появятся после запуска отслеживания
              водителем. Записанные офлайн точки добавятся после восстановления
              связи.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
export function RouteCanvas({ points }: { points: Point[] }) {
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.FeatureGroup | null>(null);
  const engine = useRef<typeof Leaflet | null>(null);
  const [ready, setReady] = useState(false);
  const [viewMode, setViewMode] = useState<"all" | "last" | "free">("all");
  const [tilesError, setTilesError] = useState(false);
  const fitted = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let removeZoomListener: (() => void) | undefined;
    void import("leaflet").then((L) => {
      if (cancelled || !node.current) return;
      engine.current = L;
      const instance = L.map(node.current, { scrollWheelZoom: false }).setView(
        [points[0].latitude, points[0].longitude],
        13,
      );
      map.current = instance;
      const tiles = L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
        },
      ).addTo(instance);
      tiles.on("tileerror", () => setTilesError(true));
      tiles.on("tileload", () => setTilesError(false));
      layer.current = L.featureGroup().addTo(instance);
      setReady(true);
    });
    return () => {
      cancelled = true;
      removeZoomListener?.();
      map.current?.remove();
      map.current = null;
      layer.current = null;
      engine.current = null;
      fitted.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      !ready ||
      !map.current ||
      !layer.current ||
      !engine.current ||
      !points.length
    )
      return;
    const L = engine.current;
    const group = layer.current;
    group.clearLayers();
    const ll = (p: Point): Leaflet.LatLngTuple => [p.latitude, p.longitude];
    let segment: Leaflet.LatLngTuple[] = [];
    points.forEach((p, i) => {
      if (
        i &&
        Date.parse(p.recordedAt) - Date.parse(points[i - 1].recordedAt) > 600000
      ) {
        if (segment.length > 1)
          L.polyline(segment, { color: "#117c63", weight: 5 }).addTo(group);
        L.polyline([ll(points[i - 1]), ll(p)], {
          color: "#7d9089",
          weight: 3,
          dashArray: "6 8",
        })
          .bindTooltip("Перерыв в координатах более 10 минут")
          .addTo(group);
        segment = [];
      }
      segment.push(ll(p));
    });
    if (segment.length > 1)
      L.polyline(segment, { color: "#117c63", weight: 5 }).addTo(group);
    const first = points[0],
      last = points[points.length - 1];
    L.circleMarker(ll(first), {
      radius: 7,
      color: "#fff",
      weight: 3,
      fillColor: "#17684f",
      fillOpacity: 1,
    })
      .bindTooltip("Начало записи")
      .addTo(group);
    L.circle(ll(last), {
      radius: Math.max(last.accuracy, 5),
      color: "#2179c2",
      weight: 1,
      fillOpacity: 0.1,
    }).addTo(group);
    L.circleMarker(ll(last), {
      radius: 8,
      color: "#fff",
      weight: 3,
      fillColor: "#2179c2",
      fillOpacity: 1,
    })
      .bindTooltip(
        "Последняя позиция · " +
          new Date(last.recordedAt).toLocaleString("ru-RU"),
      )
      .addTo(group);
    if (!fitted.current || viewMode === "all") {
      map.current.fitBounds(group.getBounds(), {
        padding: [24, 24],
        maxZoom: 16,
      });
      fitted.current = true;
    } else if (viewMode === "last") {
      map.current.panTo(ll(last));
    }
  }, [points, ready, viewMode]);
  const fit = () => {
    setViewMode("all");
    if (map.current && layer.current?.getBounds().isValid())
      map.current.fitBounds(layer.current.getBounds(), {
        padding: [24, 24],
        maxZoom: 16,
      });
  };
  const latest = () => {
    setViewMode("last");
    const p = points[points.length - 1];
    map.current?.setView([p.latitude, p.longitude], 16);
  };
  const gap = points.some(
    (p, i) =>
      i > 0 &&
      Date.parse(p.recordedAt) - Date.parse(points[i - 1].recordedAt) > 600000,
  );
  return (
    <>
      <div className="c-actions">
        <button className="secondary" type="button" onClick={fit}>
          Весь маршрут
        </button>
        <button className="secondary" type="button" onClick={latest}>
          Последняя позиция
        </button>
      </div>
      <div
        ref={node}
        className="c-route-map"
        role="img"
        aria-label={`Карта сохранённого маршрута, ${points.length} GPS-точек`}
      />
      {tilesError ? (
        <p role="status">
          Подложка карты временно недоступна. GPS-трек сохранён; проверьте
          интернет.
        </p>
      ) : null}
      <p className="c-muted">
        Зелёная точка — начало записи. Синяя — последняя позиция; окружность
        показывает точность GPS.
        {gap
          ? " Пунктир — перерыв в координатах, а не подтверждённый путь."
          : ""}
      </p>
      <p className="c-muted">
        Последняя координата:{" "}
        {new Date(points[points.length - 1].recordedAt).toLocaleString("ru-RU")}
      </p>
    </>
  );
}
