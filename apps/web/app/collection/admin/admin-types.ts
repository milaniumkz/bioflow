export type Row = Record<string, any>;
export const roleLabels: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  COLLECTOR: "Сборщик",
  WAREHOUSE_MANAGER: "Мойка / склад",
  FACTORY_MANAGER: "Завод",
};
export const stateLabels: Record<string, string> = {
  RAW: "Немытое сырьё",
  WASHED: "Мытое сырьё",
  FINISHED: "Готовая продукция",
  REJECT: "Некондиция",
};
export const statusLabels: Record<string, string> = {
  CREATED: "QR создан",
  LOADED: "Загрузился",
  IN_TRANSIT: "В пути",
  ARRIVED: "Прибыл",
  ACCEPTED: "Принят",
  CANCELLED: "Отменён",
  ACTIVE: "Доступно",
  PENDING: "Ожидает",
  AVAILABLE: "На остатке",
  DELIVERED: "Доставлен",
  WRITTEN_OFF: "Списан",
  SENT: "Доставлено",
  FAILED: "Ошибка",
  PROCESSING: "Отправляется",
};
export const actionLabels: Record<string, string> = {
  OPENING: "Начальные остатки",
  WASH: "Мойка",
  PRODUCTION: "Производство",
  RAW_RECEIPT: "Приход сырья",
  FACTORY_SHIPMENT: "Отправка на завод",
  FACTORY_RECEIPT: "Приход на завод",
  GP_SHIPMENT: "Отправка ГП",
  WEIGHT_CORRECTION: "Исправление веса",
  STOCK_ADJUSTMENT: "Корректировка остатка",
  BAGS_ADJUSTMENT: "Корректировка бигбегов",
  BAG_WRITE_OFF: "Списание бигбега",
  BAG_RESTORE: "Восстановление бигбега",
  OPERATION_REVERSED: "Отмена операции",
  TRIP_CANCELLED: "Отмена рейса",
  SHIPMENT_CANCELLED: "Отмена отправки",
  DRIVER_CLAIM: "Водитель подключился",
  ADMIN_TRIP_STAGE: "Изменение этапа рейса",
};
export function stockKg(data: Row, locationId: string, state: string): string {
  return String(
    data.stock?.find(
      (s: Row) => s.locationId === locationId && s.state === state,
    )?._sum?.remainingKg ?? "0",
  );
}
export function tonnesInput(kg: unknown): string {
  return (Number(kg ?? 0) / 1000).toString();
}
export function stamp(value: string): string {
  return new Date(value).toLocaleString("ru-RU");
}
