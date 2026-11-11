"use client";
import { useEffect, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { RouteCanvas, type Point } from "../trip-map";
import { webRequest } from "../../session";
import "../collection.css";
export default function DriverRoutePage() {
  const [client] = useState(() => new QueryClient());
  const [token, setToken] = useState("");
  useEffect(() => {
    const receive = () =>
      setToken(
        (window as Window & { collectionDriverToken?: string })
          .collectionDriverToken ?? "",
      );
    receive();
    window.addEventListener("collection:driver-token", receive);
    return () => window.removeEventListener("collection:driver-token", receive);
  }, []);
  return (
    <QueryClientProvider client={client}>
      <main className="collection-app collection-driver-route">
        <p className="eyebrow">COLLECTION DRIVER</p>
        <h1>Мой маршрут</h1>
        {token ? (
          <DriverRoute token={token} />
        ) : (
          <p>
            Откройте карту кнопкой «Маршрут на карте» в Collection Driver после
            подключения к рейсу.
          </p>
        )}
      </main>
    </QueryClientProvider>
  );
}
function DriverRoute({ token }: { token: string }) {
  const route = useQuery({
    queryKey: ["driver-route", token],
    refetchInterval: 10000,
    queryFn: async () => {
      let cursor: string | null = null;
      const points: Point[] = [];
      do {
        const page: { points: Point[]; nextCursor: string | null } =
          await webRequest(
            "/collection-driver/route" +
              (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
            token,
          );
        points.push(...page.points);
        cursor = page.nextCursor;
      } while (cursor);
      return points;
    },
  });
  return (
    <>
      {route.isPending ? <p>Загружаем маршрут…</p> : null}
      {route.isError ? (
        <p role="alert">
          Не удалось загрузить маршрут. Проверьте связь. Доступ к истории
          ограничен сроком сессии рейса.
        </p>
      ) : null}
      {route.data?.length ? (
        <RouteCanvas points={route.data} />
      ) : !route.isPending && !route.isError ? (
        <p>
          Координаты ещё не поступили. Офлайн-точки появятся после
          восстановления связи.
        </p>
      ) : null}
    </>
  );
}
