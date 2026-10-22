"use client";
import { useEffect, useRef, useState } from "react";
import { dateTime } from "./workflow-ui";
type Row = Record<string, any>;
export function RouteMap({ points, stops }: { points: Row[]; stops: Row[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let gone = false;
    if (!points.length) return;
    void import("leaflet")
      .then((L) => {
        if (gone || !root.current) return;
        map = L.map(root.current, { scrollWheelZoom: false });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        const segments: import("leaflet").LatLngTuple[][] = [[]];
        for (let i = 0; i < points.length; i++) {
          if (
            i &&
            Date.parse(points[i].recordedAt) -
              Date.parse(points[i - 1].recordedAt) >
              120000
          )
            segments.push([]);
          segments[segments.length - 1].push([
            points[i].latitude,
            points[i].longitude,
          ]);
        }
        for (const segment of segments)
          L.polyline(segment, { color: "#2f7df6", weight: 5 }).addTo(map);
        for (const stop of stops) {
          const minutes =
            (Date.parse(stop.lastObservedAt) - Date.parse(stop.startedAt)) /
            60000;
          if (minutes < 1) continue;
          L.circleMarker([stop.latitude, stop.longitude], {
            radius: minutes > 10 ? 10 : 6,
            color: minutes > 10 ? "#ef5966" : "#f6b73c",
          })
            .bindPopup(
              document.createTextNode(
                `Остановка ${Math.floor(minutes)} мин · ${dateTime(stop.startedAt)} — ${dateTime(stop.lastObservedAt)}`,
              ) as any,
            )
            .addTo(map);
        }
        const last = points[points.length - 1];
        L.circleMarker([last.latitude, last.longitude], {
          radius: 7,
          color: "#ffffff",
          fillColor: "#00805a",
          fillOpacity: 1,
        })
          .bindPopup("Последняя записанная позиция")
          .addTo(map);
        map.fitBounds(
          L.latLngBounds(points.map((p) => [p.latitude, p.longitude])),
          { padding: [25, 25], maxZoom: 16 },
        );
      })
      .catch(() =>
        setError("Карта не загрузилась. Координаты и остановки доступны ниже."),
      );
    return () => {
      gone = true;
      map?.remove();
    };
  }, [points, stops]);
  if (!points.length)
    return (
      <div className="panel">
        Маршрут ещё не записан. Водитель должен включить геолокацию и начать
        рейс.
      </div>
    );
  return (
    <>
      {error && <p className="error">{error}</p>}
      <div
        ref={root}
        className="route-map"
        aria-label="Маршрут водителя на карте OpenStreetMap"
      />
      <p className="metric">
        Синяя линия — записанные GPS-точки. Красные точки — остановки более 10
        минут. Разрывы сигнала не соединяются.
      </p>
    </>
  );
}
