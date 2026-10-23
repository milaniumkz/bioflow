export function pushSummary(notice: {
  type: string;
  title: string;
  body: string;
}) {
  return {
    title: notice.title,
    body: ["DRIVER_IDLE", "DRIVER_GPS_STALE"].includes(notice.type)
      ? "Откройте Collection, чтобы посмотреть детали рабочего рейса."
      : notice.body,
  };
}
