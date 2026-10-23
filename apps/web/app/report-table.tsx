"use client";
import { useEffect, useState } from "react";
import { RecordDrawer } from "./design-system";
type Row = Record<string, any>;
const fields: Record<string, string> = {
  number: "Документ",
  batchNumber: "Партия",
  "batch.number": "Партия",
  warehouseName: "Склад",
  fromWarehouseName: "Откуда",
  toWarehouseName: "Куда",
  kind: "Этап / операция",
  state: "Материал",
  status: "Статус",
  createdAt: "Дата",
  initialQuantity: "Собрано, т",
  declaredWeight: "Отправлено, т",
  receivedWeight: "Принято, т",
  difference: "Разница, т",
  differencePercent: "Разница, %",
  quantity: "Движение, т",
  reservedDelta: "Изменение резерва, т",
  opening: "На начало, т",
  incoming: "Приход, т",
  outgoing: "Расход, т",
  closing: "На конец, т",
  reserved: "Резерв, т",
  inputQuantity: "Вход, т",
  outputQuantity: "Выход, т",
  comparisonBaseQuantity: "База сравнения, т",
  coefficientPercent: "Потеря, %",
  sedimentPercent: "Осадок, %",
  moisturePercent: "Влажность, %",
  coefficientBasis: "База коэффициента",
  normMinPercent: "Норма от, %",
  normMaxPercent: "Норма до, %",
  wasteQuantity: "Отходы, т",
  lossQuantity: "Потери, т",
  defectQuantity: "Брак, т",
  deviation: "Отклонение",
  shift: "Смена",
  lineLabel: "Линия",
  reason: "Причина",
  entity: "Объект",
  action: "Действие",
  unit: "Единица",
};
const labels: Record<string, string> = {
  LABORATORY_SEDIMENT: "Осадок лаборатории",
  PREWASH: "Перед мойкой",
  WASHING: "Мойка",
  DRYING: "Завод",
  PRODUCTION: "Завод",
  DIRTY: "Сырьё",
  WASHED: "Мытое",
  FINISHED: "Готовая продукция",
  RECEIVED_LOSS: "Физическая приёмка",
  LOSS: "Вход операции",
  BELOW: "Ниже ориентира",
  ABOVE: "Выше ориентира",
  NORMAL: "В пределах ориентира",
  WITHIN: "В пределах ориентира",
  CONFIRMED: "Подтверждено",
  DRAFT: "Черновик",
  IN_TRANSIT: "В пути",
  ACCEPTED: "Принято",
  ACCEPTED_WITH_DIFFERENCE: "Принято с расхождением",
  PARTIALLY_ACCEPTED: "Частично принято",
  SHIPMENT: "Отгрузка",
  TRANSFER: "Перемещение",
  WRITE_OFF: "Списание",
  CORRECTION: "Корректировка",
  RETURN: "Возврат",
  INVENTORY: "Инвентаризация",
  "process.run": "Обработка партии",
  "batch.lab-sediment": "Лабораторный анализ",
  "batch.receive": "Приёмка партии",
};
function value(row: Row, key: string) {
  return key.split(".").reduce((v, k) => v?.[k], row);
}
function display(key: string, v: any) {
  if (v == null || v === "") return "—";
  if (key === "createdAt") return new Date(v).toLocaleString("ru-RU");
  if (
    /Quantity$|Weight$|^(quantity|opening|incoming|outgoing|closing|reserved|reservedDelta|difference)$/.test(
      key,
    ) &&
    Number.isFinite(Number(v))
  )
    return Number(v).toLocaleString("ru-RU", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  if (/Percent$/.test(key) && Number.isFinite(Number(v)))
    return Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
  return labels[String(v)] ?? String(v);
}
export function ReportTable({
  rows,
  totals,
  loading,
}: {
  rows: Row[];
  totals: Row;
  loading: boolean;
}) {
  const [selected, setSelected] = useState<Row | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
    setSelected(null);
  }, [rows]);
  const columns = Object.keys(fields).filter((k) =>
    rows.some((r) => value(r, k) != null),
  );
  const preferred = [
    "number",
    "batchNumber",
    "batch.number",
    "warehouseName",
    "fromWarehouseName",
    "toWarehouseName",
    "kind",
    "createdAt",
    "initialQuantity",
    "declaredWeight",
    "receivedWeight",
    "inputQuantity",
    "outputQuantity",
    "quantity",
    "opening",
    "incoming",
    "outgoing",
    "closing",
    "reserved",
    "lossQuantity",
    "coefficientPercent",
    "action",
  ];
  const tableColumns = preferred.filter((k) => columns.includes(k));
  if (loading)
    return (
      <p role="status" className="notice">
        Формируем отчёт…
      </p>
    );
  return (
    <section className="panel report-results">
      <h2>Результат отчёта</h2>
      <p className="metric">
        Строк: {totals.records ?? rows.length}. Фильтры и выгрузка относятся к
        доступной области.
      </p>
      <div className="summary-grid">
        {Object.entries(totals)
          .filter(([key]) => fields[key])
          .map(([key, v]) => (
            <div className="card" key={key}>
              <span className="metric">{fields[key]}</span>
              <strong>{display(key, v)}</strong>
            </div>
          ))}
      </div>
      {!rows.length ? (
        <p className="empty-state">Нет данных по выбранным условиям</p>
      ) : (
        <div
          className="tableScroll report-desktop-table"
          role="region"
          tabIndex={0}
          aria-label="Таблица отчёта"
        >
          <table>
            <thead>
              <tr>
                {tableColumns.map((k) => (
                  <th scope="col" key={k}>
                    {fields[k]}
                  </th>
                ))}
                <th scope="col">Подробности</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice((page - 1) * 20, page * 20).map((r, i) => (
                <tr key={r.processRunId ?? r.id ?? i}>
                  {tableColumns.map((k) => (
                    <td key={k}>{display(k, value(r, k))}</td>
                  ))}
                  <td>
                    <button
                      className="button secondary"
                      onClick={() => setSelected(r)}
                    >
                      Открыть
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="report-mobile-cards">
        {rows.slice((page - 1) * 20, page * 20).map((r, i) => (
          <article className="card" key={r.processRunId ?? r.id ?? i}>
            <span className="eyebrow">
              {display("kind", r.kind ?? r.action ?? r.state)}
            </span>
            <h3>
              {r.number ?? r.batchNumber ?? r.batch?.number ?? "Запись отчёта"}
            </h3>
            <p className="metric">
              {r.warehouseName ?? r.fromWarehouseName ?? ""} ·{" "}
              {display("createdAt", r.createdAt)}
            </p>
            <dl className="confirmation-list">
              {[
                "inputQuantity",
                "outputQuantity",
                "initialQuantity",
                "declaredWeight",
                "receivedWeight",
                "closing",
                "quantity",
                "lossQuantity",
                "difference",
                "coefficientPercent",
              ]
                .filter((k) => value(r, k) != null)
                .slice(0, 4)
                .map((k) => (
                  <div key={k}>
                    <dt>{fields[k]}</dt>
                    <dd>{display(k, value(r, k))}</dd>
                  </div>
                ))}
            </dl>
            <button className="button secondary" onClick={() => setSelected(r)}>
              Открыть
            </button>
          </article>
        ))}
      </div>
      {rows.length > 20 && (
        <div className="toolbar">
          <button
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Назад
          </button>
          <span>
            Страница {page} из {Math.ceil(rows.length / 20)}
          </span>
          <button
            className="button secondary"
            disabled={page * 20 >= rows.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Далее
          </button>
        </div>
      )}
      {selected && (
        <RecordDrawer
          title={selected.number ?? selected.batchNumber ?? "Строка отчёта"}
          onClose={() => setSelected(null)}
        >
          <dl className="confirmation-list">
            {columns
              .filter((k) => value(selected, k) != null)
              .map((k) => (
                <div key={k}>
                  <dt>{fields[k]}</dt>
                  <dd>{display(k, value(selected, k))}</dd>
                </div>
              ))}
          </dl>
        </RecordDrawer>
      )}
    </section>
  );
}
