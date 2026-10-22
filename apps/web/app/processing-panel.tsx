"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { webRequest } from "./session";
import {
  ActionForm,
  EvidenceFiles,
  Field,
  PhotoUpload,
  QrCards,
  QrInput,
  Reference,
  dateTime,
  labels,
  localNow,
  tonnes,
  useReferences,
} from "./workflow-ui";
type Row = Record<string, any>;
export function ProcessingPanel({
  token,
  permissions,
  initialQr,
}: {
  token: string;
  permissions: string[];
  initialQr?: { token: string; nonce: number };
}) {
  const refs = useReferences(token);
  const [item, setItem] = useState<Row | null>(null),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [outputs, setOutputs] = useState<Row[]>([]),
    [files, setFiles] = useState<string[]>([]),
    [selected, setSelected] = useState<Row[]>([]),
    [outputCount, setOutputCount] = useState(1),
    [showTrace, setShowTrace] = useState(false);
  const can = (p: string) => permissions.includes(p);
  const post = (path: string, data: Row) =>
    webRequest<Row>(path, token, {
      method: "POST",
      body: JSON.stringify(data),
    });
  async function scan(qr: string) {
    setError("");
    const r = await post("/processing/scan", { token: qr });
    setItem(r);
    setCode(qr);
    setFiles([]);
    setShowTrace(false);
    if (
      r.batch.bigBag?.stage === "WASHED" &&
      r.batch.bigBag.factoryStartedAt &&
      !r.batch.bigBag.soldAt &&
      r.batch.stocks.some((s: Row) => Number(s.quantity) > 0)
    )
      setSelected((old) =>
        old.some((b) => b.id === r.batch.id)
          ? old
          : old.length && old[0].rootBatchId !== r.rootBatchId
            ? [{ ...r.batch, rootBatchId: r.rootBatchId }]
            : [...old, { ...r.batch, rootBatchId: r.rootBatchId }],
      );
  }
  useEffect(() => {
    if (initialQr?.token)
      void scan(initialQr.token).catch((e) => setError(e.message));
  }, [initialQr?.nonce]);
  const trace = useQuery({
    queryKey: ["process-trace", item?.batch.id, token],
    queryFn: () =>
      webRequest<Row>(`/processing/trace/${item!.batch.id}`, token),
    enabled: showTrace && !!item,
  });
  async function action(path: string, data: Row, key: string) {
    const r = await post(path, { ...data, idempotencyKey: key });
    if (r.outputs) setOutputs(r.outputs);
    await scan(code);
    return r;
  }
  const rows = (name: string) => refs.data?.[name] ?? [];
  const b = item?.batch,
    t = item?.trip,
    bag = b?.bigBag;
  const currentStocks = (b?.stocks ?? []).filter(
    (s: Row) => Number(s.quantity) > 0,
  );
  const warehouseDefault =
    currentStocks[0]?.warehouseId ?? t?.destinationWarehouseId;
  function processForm(
    kind: "PREWASH" | "WASHING" | "DRYING",
    batchIds: string[],
  ) {
    return (
      <ActionForm
        key={`${kind}:${batchIds.join(",")}`}
        title={
          kind === "PREWASH"
            ? "Взвесить перед мойкой"
            : kind === "WASHING"
              ? "Выход с мойки"
              : "Выход после завода"
        }
        submit="Подтвердить фактический вес"
        onSubmit={async (f, key) => {
          const outputWeights = f
            .getAll("outputWeights")
            .map((x) => String(x).trim().replace(",", "."));
          await action(
            "/processing/runs",
            {
              kind,
              batchIds,
              fromWarehouseId: f.get("fromWarehouseId"),
              toWarehouseId: f.get("toWarehouseId"),
              outputWeights,
              ...(kind === "DRYING"
                ? { productTypeId: f.get("productTypeId") }
                : {}),
              reason: f.get("reason") || undefined,
              fileIds: files,
            },
            key,
          );
          setSelected([]);
          setOutputCount(1);
        }}
      >
        <Reference
          name="fromWarehouseId"
          label="Откуда берём материал"
          rows={rows("warehouses")}
          defaultValue={warehouseDefault}
        />
        <Reference
          name="toWarehouseId"
          label="Куда поступает результат"
          rows={rows("warehouses")}
        />
        {kind === "DRYING" && (
          <>
            <p>
              Выбрано мытых биг-бэгов: {selected.length}. Вес:{" "}
              {tonnes(
                selected.reduce((a, x) => a + Number(x.initialQuantity), 0),
              )}
              .
            </p>
            <Reference
              name="productTypeId"
              label="Вид готовой продукции"
              rows={rows("product-types")}
            />
          </>
        )}
        {kind !== "PREWASH" ? (
          <div className="workflow-stack">
            {Array.from({ length: outputCount }, (_, i) => (
              <Field
                key={i}
                name="outputWeights"
                label={`Биг-бэг №${i + 1}, вес, т`}
                type="number"
                min={0.001}
                step="0.001"
              />
            ))}
            <div className="toolbar">
              <button
                type="button"
                className="button secondary"
                disabled={outputCount >= 100}
                onClick={() => setOutputCount((n) => n + 1)}
              >
                ＋ Добавить биг-бэг
              </button>
              {outputCount > 1 && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setOutputCount((n) => n - 1)}
                >
                  Убрать последний
                </button>
              )}
            </div>
            <small>
              Будет создано QR: {outputCount}. Каждый биг-бэг получит свой код.
            </small>
          </div>
        ) : (
          <Field
            name="outputWeights"
            label="Фактический вес перед мойкой, т"
            type="number"
            min={0.001}
            step="0.001"
          />
        )}
        <p>
          {kind === "PREWASH"
            ? "Усушка от фактической приёмки: норма 21–27%. Потребуется объяснить отклонение."
            : kind === "DRYING"
              ? "Норма потери массы на заводе — 36% от мытого входа. Фактический процент будет рассчитан по весам."
              : "Общий выход равен сумме индивидуальных весов биг-бэгов."}
        </p>
        <Field
          name="reason"
          label="Причина отклонения / комментарий"
          required={false}
        />
        <PhotoUpload token={token} ids={files} setIds={setFiles} />
      </ActionForm>
    );
  }
  return (
    <div className="workflow-stack">
      <QrInput onScan={scan} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {refs.error && <p className="error">{refs.error.message}</p>}
      {item && (
        <>
          <article className="panel workflow-party">
            <p className="eyebrow">Карточка партии</p>
            <h2>{b.number}</h2>
            <p>
              {bag
                ? `Биг-бэг №${bag.ordinal} · ${labels[bag.stage] ?? bag.stage}`
                : t
                  ? (labels[t.status] ?? t.status)
                  : labels[b.state]}
            </p>
            <div className="workflow-metrics">
              <strong>
                {tonnes(b.actualCollectedQuantity ?? b.initialQuantity)}
              </strong>
              <strong>
                {bag
                  ? "1 биг-бэг"
                  : `${b.actualBagCount ?? t?.receivedBagCount ?? t?.bagCount ?? "—"} мешков`}
              </strong>
            </div>
            {t && (
              <p>
                Водитель: {t.driver?.fullName ?? "см. рейс"} · Отправлено{" "}
                {tonnes(t.declaredWeight)}, {t.bagCount ?? "—"} мешков
                {t.receivedWeight &&
                  ` · Принято ${tonnes(t.receivedWeight)}, ${t.receivedBagCount ?? "—"} мешков`}
              </p>
            )}
            {bag && !bag.soldAt && currentStocks.length === 0 && (
              <p>
                Материал этого QR уже использован. Текущий остаток — 0.
                Посмотрите историю партии.
              </p>
            )}
            {bag?.soldAt && (
              <p>
                Продан {dateTime(bag.soldAt)} · {bag.saleRecipient}
              </p>
            )}
            {bag?.receivedAt && (
              <p>На складе готовой продукции с {dateTime(bag.receivedAt)}</p>
            )}
            {bag?.packedAt && (
              <p>
                Упакован · смена {bag.packingShift} · {bag.packingDate}
              </p>
            )}
            {item.analyses.length > 0 ? (
              <p>
                Осадок: <strong>{item.analyses[0].sedimentPercent}%</strong> ·
                Фактический материал{" "}
                {tonnes(
                  item.rootFacts?.actualCollectedQuantity ??
                    item.analyses[0].actualQuantity,
                )}{" "}
                ·{" "}
                {item.rootFacts?.actualBagCount ??
                  item.analyses[0].actualBagCount}{" "}
                мешков · Влажность:{" "}
                <strong>{item.analyses[0].moisturePercent}%</strong> ·{" "}
                {dateTime(item.analyses[0].measuredAt)}
              </p>
            ) : (
              <p className="warning">Лабораторный анализ ещё не выполнен</p>
            )}
            <button
              className="button secondary"
              onClick={() => setShowTrace((v) => !v)}
            >
              Вся история партии
            </button>
          </article>
          {can("laboratory.manage") && item.analyses.length === 0 && (
            <ActionForm
              key={`lab:${b.id}`}
              title="Лабораторный анализ"
              submit="Сохранить влажность"
              onSubmit={async (f, key) =>
                action(
                  "/processing/laboratory",
                  {
                    batchId: b.id,
                    moisturePercent: f.get("moisturePercent"),
                    sedimentPercent: f.get("sedimentPercent"),
                    actualBagCount: Number(f.get("actualBagCount")),
                    measuredAt: new Date(
                      String(f.get("measuredAt")),
                    ).toISOString(),
                    notes: f.get("notes") || undefined,
                  },
                  key,
                )
              }
            >
              <Field
                name="moisturePercent"
                label="Влажность, %"
                type="number"
                min={0}
                max={100}
                step="0.01"
              />
              <Field
                name="sedimentPercent"
                label="Осадок, %"
                type="number"
                min={0}
                max={99.99}
                step="0.01"
              />
              <Field
                name="actualBagCount"
                label="Фактическое количество мешков"
                type="number"
                min={1}
                step="1"
                defaultValue={t?.receivedBagCount ?? t?.bagCount}
              />
              <Field
                name="measuredAt"
                label="Время анализа"
                type="datetime-local"
                defaultValue={localNow()}
              />
              <Field name="notes" label="Примечание" required={false} />
            </ActionForm>
          )}
          {can("processing.receive") &&
            t &&
            ["LOADED", "IN_TRANSIT", "ARRIVED"].includes(t.status) && (
              <ActionForm
                key={`receive:${t.id}`}
                title="Приёмка на мойку"
                submit="Принять фактически поступившее"
                onSubmit={async (f, key) =>
                  action(
                    `/processing/trips/${t.id}/receive`,
                    {
                      warehouseId: f.get("warehouseId"),
                      quantity: f.get("quantity"),
                      bagCount: Number(f.get("bagCount")),
                      reason: f.get("reason") || undefined,
                      fileIds: files,
                    },
                    key,
                  )
                }
              >
                <Reference
                  name="warehouseId"
                  label="Склад приёмки"
                  rows={rows("warehouses")}
                  defaultValue={t.destinationWarehouseId}
                />
                <Field
                  name="quantity"
                  label="Фактически принято, т"
                  type="number"
                  min={0.001}
                  step="0.001"
                  defaultValue={t.declaredWeight}
                />
                <Field
                  name="bagCount"
                  label="Фактически принято мешков"
                  type="number"
                  min={1}
                  step="1"
                  defaultValue={t.bagCount}
                />
                <Field
                  name="reason"
                  label="Причина расхождения"
                  required={false}
                />
                <PhotoUpload token={token} ids={files} setIds={setFiles} />
              </ActionForm>
            )}
          {can("processing.wash") &&
            !bag &&
            t?.receivedWeight &&
            !item.preparedBatchId &&
            processForm("PREWASH", [b.id])}
          {can("processing.wash") &&
            item.preparedBatchId &&
            item.preparedAvailable &&
            !bag &&
            processForm("WASHING", [item.preparedBatchId])}
          {can("processing.dry") &&
            bag?.stage === "WASHED" &&
            !bag.soldAt &&
            !bag.factoryStartedAt && (
              <ActionForm
                key={`intake:${b.id}`}
                title="Приём на завод"
                submit="Принять этот биг-бэг на завод"
                onSubmit={async (f, key) =>
                  action(
                    `/processing/bags/${b.id}/plant-intake`,
                    { warehouseId: f.get("warehouseId") },
                    key,
                  )
                }
              >
                <p>Будет принято 1 биг-бэг · {tonnes(bag.quantity)}.</p>
                <Reference
                  name="warehouseId"
                  label="Склад завода"
                  rows={rows("warehouses")}
                />
              </ActionForm>
            )}
          {can("processing.dry") &&
            bag?.stage === "WASHED" &&
            !bag.soldAt &&
            bag.factoryStartedAt && (
              <>
                <div className="panel">
                  <h3>Биг-бэги на завод</h3>
                  <p>Сканируйте каждый входной QR. Повторы не добавляются.</p>
                  {selected.map((x) => (
                    <p key={x.id}>
                      {x.number} · {tonnes(x.initialQuantity)}{" "}
                      <button
                        className="button secondary"
                        onClick={() =>
                          setSelected((old) => old.filter((y) => y.id !== x.id))
                        }
                      >
                        Убрать
                      </button>
                    </p>
                  ))}
                </div>
                {selected.length > 0 &&
                  processForm(
                    "DRYING",
                    selected.map((x) => x.id),
                  )}
              </>
            )}
          {can("processing.finished") &&
            bag?.stage === "DRIED" &&
            !bag.receivedAt &&
            !bag.soldAt && (
              <ActionForm
                key={`finished:${b.id}`}
                title="Склад готовой продукции"
                submit="Принять этот биг-бэг"
                onSubmit={async (f, key) =>
                  action(
                    `/processing/bags/${b.id}/receive`,
                    { warehouseId: f.get("warehouseId") },
                    key,
                  )
                }
              >
                <p>1 биг-бэг · {tonnes(bag.quantity)}</p>
                <Reference
                  name="warehouseId"
                  label="Склад назначения"
                  rows={rows("warehouses")}
                />
              </ActionForm>
            )}
          {can("processing.pack") &&
            bag?.stage === "DRIED" &&
            !bag.packedAt &&
            !bag.soldAt && (
              <ActionForm
                key={`pack:${b.id}`}
                title="Упаковка"
                submit="Биг-бэг упакован"
                onSubmit={async (f, key) =>
                  action(
                    `/processing/bags/${b.id}/pack`,
                    Object.fromEntries(f),
                    key,
                  )
                }
              >
                <Field
                  name="workDate"
                  label="Дата смены"
                  type="date"
                  defaultValue={localNow().slice(0, 10)}
                />
                <Field name="shift" label="Смена" defaultValue="Дневная" />
              </ActionForm>
            )}
          {can("processing.sell") &&
            bag &&
            !bag.soldAt &&
            ((bag.stage === "WASHED" && !bag.factoryStartedAt) ||
              bag.receivedAt) && (
              <ActionForm
                key={`sale:${b.id}`}
                title={
                  bag.stage === "WASHED"
                    ? "Продажа мытого материала"
                    : "Отпуск готовой продукции"
                }
                submit="Подтвердить продажу и списать"
                onSubmit={async (f, key) =>
                  action(
                    "/processing/sales",
                    { ...Object.fromEntries(f), batchIds: [b.id] },
                    key,
                  )
                }
              >
                <p>Будет списан 1 биг-бэг весом {tonnes(bag.quantity)}.</p>
                <Reference
                  name="warehouseId"
                  label="Склад отпуска"
                  rows={rows("warehouses")}
                  defaultValue={warehouseDefault}
                />
                <Field name="recipient" label="Покупатель" />
                <Field name="documentNumber" label="Номер документа продажи" />
              </ActionForm>
            )}
          {showTrace && (
            <section className="panel">
              <h2>История исходной партии</h2>
              {trace.error && <p className="error">{trace.error.message}</p>}
              {trace.data && (
                <>
                  <p>
                    {trace.data.root.number} · Собрано{" "}
                    {tonnes(trace.data.summary.collected)} · Готового
                    произведено {tonnes(trace.data.summary.finishedProduced)}
                  </p>
                  <p>
                    Ожидаемый готовый выход при общей потере 51%:{" "}
                    {tonnes(trace.data.summary.expectedFinished)}
                  </p>
                  {trace.data.summary.comparisonComplete ? (
                    <p>
                      Фактическая общая потеря:{" "}
                      {trace.data.summary.actualLossPercent}%
                    </p>
                  ) : (
                    <p>
                      Итоговое сравнение ещё не завершено: проверьте остатки в
                      обработке и продажи мытого материала.
                    </p>
                  )}
                  <EvidenceFiles token={token} files={trace.data.files ?? []} />
                  {trace.data.runs.map((r: Row) => (
                    <article className="workflow-event" key={r.id}>
                      <h3>
                        {labels[r.kind]} · {dateTime(r.createdAt)}
                      </h3>
                      <p>
                        {tonnes(r.inputQuantity)} → {tonnes(r.outputQuantity)} ·
                        Потеря {r.coefficientPercent}% · {labels[r.deviation]}
                      </p>
                      {r.reason && <p>{r.reason}</p>}
                      <p>Сотрудник: {r.createdByName ?? "Сотрудник"}</p>
                      {r.bags.map((x: Row) => (
                        <p key={x.id}>
                          Биг-бэг №{x.ordinal} · {tonnes(x.quantity)}
                          {x.soldAt
                            ? " · продан"
                            : x.receivedAt
                              ? " · на складе"
                              : ""}
                          {x.packedAt ? " · упакован" : ""}
                        </p>
                      ))}
                    </article>
                  ))}
                </>
              )}
            </section>
          )}
        </>
      )}
      <QrCards items={outputs} />
      {can("processing.pack") && <PackingStats token={token} />}
    </div>
  );
}
function PackingStats({ token }: { token: string }) {
  const [from, setFrom] = useState(localNow().slice(0, 10)),
    [to, setTo] = useState(localNow().slice(0, 10));
  const q = useQuery({
    queryKey: ["packing-stats", token, from, to],
    queryFn: () =>
      webRequest<Row[]>(
        `/processing/packing-stats?from=${from}&to=${to}`,
        token,
      ),
    enabled: !!from && !!to,
    refetchInterval: 30000,
  });
  return (
    <section className="panel">
      <h2>Упаковано за смену</h2>
      <label>
        С даты
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label>
        По дату
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      {q.error && <p className="error">{q.error.message}</p>}
      {q.data?.map((r, i) => (
        <p key={i}>
          {r.packingDate} · {r.packingShift} · {r.packedByName ?? "Сотрудник"}:{" "}
          <strong>
            {r._count._all} биг-бэгов · {tonnes(r._sum.quantity)}
          </strong>
        </p>
      ))}
    </section>
  );
}
