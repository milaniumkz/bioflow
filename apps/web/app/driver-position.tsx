"use client";
import { useQuery } from "@tanstack/react-query";
import { webRequest } from "./session";

type Position = {
  status: "NOT_STARTED" | "WAITING" | "ACTIVE" | "STALE" | "STOPPED";
  driverPhone?: string;
  driverPlate?: string;
  point: {
    latitude: number;
    longitude: number;
    accuracy: number;
    recordedAt: string;
  } | null;
};
const labels: Record<Position["status"], string> = {
  NOT_STARTED: "Водитель ещё не сканировал QR",
  WAITING: "Ожидаем первую координату",
  ACTIVE: "Геолокация обновляется",
  STALE: "Данные устарели — проверьте связь с водителем",
  STOPPED: "Отслеживание завершено",
};
export function DriverPosition({
  waybillId,
  token,
}: {
  waybillId: string;
  token: string;
}) {
  const position = useQuery({
    queryKey: ["driver-position", token, waybillId],
    queryFn: () =>
      webRequest<Position>(
        `/driver-tracking/waybills/${encodeURIComponent(waybillId)}`,
        token,
      ),
    refetchInterval: 15000,
    retry: false,
  });
  if (position.isPending) return <p role="status">Загрузка геолокации…</p>;
  if (position.isError)
    return (
      <p role="status">
        Не удалось получить геолокацию.{" "}
        <button type="button" onClick={() => void position.refetch()}>
          Повторить
        </button>
      </p>
    );
  const { status, point } = position.data;
  return (
    <section aria-label="Местоположение водителя">
      {position.data.driverPlate ? (
        <p>
          Машина: {position.data.driverPlate} · Телефон водителя:{" "}
          {position.data.driverPhone}
        </p>
      ) : null}
      <p>
        <strong>Collection Driver:</strong> {labels[status]}
      </p>
      {point ? (
        <>
          <p>
            Последняя позиция:{" "}
            {new Date(point.recordedAt).toLocaleString("ru-RU")} · точность ±
            {Math.round(point.accuracy)} м
          </p>
          <p>
            {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
          </p>
          <a
            href={`https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=16/${point.latitude}/${point.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть последнюю позицию на карте ↗
          </a>
        </>
      ) : null}
    </section>
  );
}
