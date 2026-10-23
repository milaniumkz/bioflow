"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, MapPin, Clock, Check } from "lucide-react";
import { webRequest } from "./session";
import { dateTime } from "./workflow-ui";
import { RecordDrawer } from "./design-system";
type Row = Record<string, any>;
export function NotificationWorkbench({
  token,
  onFleet,
}: {
  token: string;
  onFleet?: () => void;
}) {
  const [status, setStatus] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Row | null>(null);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications", token, page, status, search],
    queryFn: () =>
      webRequest<Row>(
        `/notifications?${new URLSearchParams({ page: String(page), pageSize: "20", ...(status ? { status } : {}), ...(search ? { search } : {}) })}`,
        token,
      ),
    refetchInterval: 30000,
  });
  const read = useMutation({
    mutationFn: (id: string) =>
      webRequest(`/notifications/${id}/read`, token, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const Icon = ({ type }: { type: string }) =>
    type === "DRIVER_IDLE" ? (
      <Clock size={22} />
    ) : type === "DRIVER_GPS_STALE" ? (
      <MapPin size={22} />
    ) : (
      <Bell size={22} />
    );
  return (
    <div className="workflow-stack">
      <div className="registry-filters">
        <label>
          Поиск
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Рейс или текст уведомления"
          />
        </label>
        <label>
          Состояние
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Все уведомления</option>
            <option value="UNREAD">Непрочитанные</option>
            <option value="READ">Прочитанные</option>
          </select>
        </label>
      </div>
      {q.isPending ? (
        <p role="status">Загружаем уведомления…</p>
      ) : q.error ? (
        <p role="alert" className="error">
          {q.error.message}
        </p>
      ) : (
        <>
          <p className="metric">В доступной области: {q.data!.total}</p>
          {!q.data!.data.length && (
            <div className="empty-state">
              <strong>
                {search || status ? "Нет совпадений" : "Уведомлений пока нет"}
              </strong>
              {search || status
                ? "Измените фильтры."
                : "Здесь появятся события ваших рабочих объектов."}
            </div>
          )}
          {q.data!.data.map((n: Row) => (
            <article key={n.id} className="panel notification-card">
              <span className="registry-icon">
                <Icon type={n.type} />
              </span>
              <div>
                <span className="status">
                  {n.readAt ? "Прочитано" : "Новое"}
                </span>
                <h2>{n.title}</h2>
                <p>{n.body}</p>
                <small>{dateTime(n.createdAt)}</small>
                <div className="toolbar">
                  <button
                    className="button secondary"
                    onClick={() => setSelected(n)}
                  >
                    Открыть детали
                  </button>
                  <button
                    className="button secondary"
                    disabled={!!n.readAt || read.isPending}
                    onClick={() => read.mutate(n.id)}
                  >
                    <Check size={18} />
                    Прочитано
                  </button>
                </div>
              </div>
            </article>
          ))}
          <div className="toolbar">
            <button
              className="button secondary"
              disabled={page === 1}
              onClick={() => setPage((v) => v - 1)}
            >
              Назад
            </button>
            <span>Страница {page}</span>
            <button
              className="button secondary"
              disabled={page * 20 >= q.data!.total}
              onClick={() => setPage((v) => v + 1)}
            >
              Далее
            </button>
          </div>
        </>
      )}
      {read.error && (
        <p role="alert" className="error">
          {read.error.message}
        </p>
      )}
      {selected && (
        <RecordDrawer title={selected.title} onClose={() => setSelected(null)}>
          <p>{selected.body}</p>
          <p className="metric">{dateTime(selected.createdAt)}</p>
          {selected.type === "DRIVER_GPS_STALE" && (
            <p className="notice">
              Отсутствие координат не доказывает остановку. Последняя известная
              точка относится к указанному времени.
            </p>
          )}
          {selected.type === "DRIVER_IDLE" && (
            <p className="notice">
              Стоянка подтверждена последовательностью пригодных GPS-точек.
              Пробелы связи не добавляются к длительности простоя.
            </p>
          )}
          {onFleet &&
            ["DRIVER_IDLE", "DRIVER_GPS_STALE"].includes(selected.type) && (
              <button className="button" onClick={onFleet}>
                Открыть контроль водителей
              </button>
            )}
        </RecordDrawer>
      )}
    </div>
  );
}
