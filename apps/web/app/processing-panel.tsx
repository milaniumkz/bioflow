"use client";
import {
  SaleDeliveryFields,
  saleDeliveryPayload,
} from "./sale-delivery-fields";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useRecordFocus } from "./use-record-focus";
import { createCommandId } from "./command-id.mjs";
import { recordLabel } from "./record-label";
import { processingNextStep } from "./processing-next-step";
type Row = Record<string, any>;
export function ProcessingPanel({
  token,
  permissions,
  roles = [],
  initialQr,
  initialBatchId,
  embedded = false,
}: {
  token: string;
  permissions: string[];
  roles?: string[];
  initialQr?: { token: string; nonce: number; record?: Row };
  initialBatchId?: string;
  embedded?: boolean;
}) {
  const refs = useReferences(token);
  const queryClient = useQueryClient();
  const refreshRecords = () =>
    Promise.all(
      [
        "deliveries",
        "fleet",
        "packing-stats",
        "processing-registry",
        "owner-dashboard",
        "process-trace",
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );

  const partyRef = useRef<HTMLElement>(null),
    actionsRef = useRef<HTMLDivElement>(null),
    outputRef = useRef<HTMLDivElement>(null);
  const scanVersion = useRef(0);
  const [focusRequest, setFocusRequest] = useState<{
    version: number;
    target: "party" | "actions" | "outputs";
  } | null>(null);
  useRecordFocus(
    focusRequest?.target === "outputs"
      ? outputRef
      : focusRequest?.target === "actions"
        ? actionsRef
        : partyRef,
    focusRequest,
  );

  const [item, setItem] = useState<Row | null>(null),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [outputs, setOutputs] = useState<Row[]>([]),
    [files, setFiles] = useState<string[]>([]),
    [selected, setSelected] = useState<Row[]>([]),
    [outputCount, setOutputCount] = useState(1),
    [showTrace, setShowTrace] = useState(false);
  const can = (p: string) => permissions.includes(p) && !item?.readOnly;
  const packingMode =
    roles.includes("PACKER") &&
    !roles.includes("OWNER") &&
    !roles.includes("OPERATIONS_MANAGER") &&
    permissions.includes("processing.pack");
  const [packingDate, setPackingDate] = useState(localNow().slice(0, 10)),
    [packingShift, setPackingShift] = useState("Дневная"),
    [packingMessage, setPackingMessage] = useState("");

  const post = (path: string, data: Row) =>
    webRequest<Row>(path, token, {
      method: "POST",
      body: JSON.stringify(data),
    });
  async function scan(
    qr: string,
    afterAction = false,
    hasOutputs = false,
    resolved?: Row,
  ) {
    const version = ++scanVersion.current;
    setError("");
    let r =
      resolved ??
      (qr
        ? await post("/processing/scan", { token: qr })
        : await webRequest<Row>(
            `/processing/batches/${initialBatchId ?? item?.batch.id}`,
            token,
          ));
    if (version !== scanVersion.current) return;
    if (!afterAction) setPackingMessage("");
    if (
      packingMode &&
      !r.readOnly &&
      qr &&
      !afterAction &&
      r.batch.bigBag?.stage === "DRIED" &&
      r.batch.bigBag.receivedAt &&
      !r.batch.bigBag.soldAt &&
      r.batch.stocks.some((s: Row) => Number(s.quantity) > 0)
    ) {
      if (r.batch.bigBag.packedAt)
        setPackingMessage(
          "Этот биг-бэг уже упакован. Повторное сканирование не увеличивает счётчик.",
        );
      else {
        const result = await post(`/processing/bags/${r.batch.id}/pack`, {
          workDate: packingDate,
          shift: packingShift,
          idempotencyKey: createCommandId(),
        });
        if (version !== scanVersion.current) return;
        await refreshRecords();
        setPackingMessage(
          result.alreadyPacked
            ? "Этот биг-бэг уже упакован. Повтор не учтён."
            : `Биг-бэг №${r.batch.bigBag.ordinal} упакован и записан в вашу смену «${packingShift}».`,
        );
        r = await post("/processing/scan", { token: qr });
        if (version !== scanVersion.current) return;
      }
    }

    setItem(r);
    if (!afterAction) {
      setOutputs([]);
      setOutputCount(1);
    }
    setFocusRequest({
      version,
      target: afterAction ? (hasOutputs ? "outputs" : "actions") : "party",
    });
    setCode(qr || r.qrToken || "");
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
      void scan(initialQr.token, false, false, initialQr.record).catch((e) =>
        setError(e.message),
      );
  }, [initialQr?.nonce]);
  useEffect(() => {
    if (initialBatchId) void scan("").catch((e) => setError(e.message));
  }, [initialBatchId]);
  const trace = useQuery({
    queryKey: ["process-trace", item?.batch.id, token],
    queryFn: () =>
      webRequest<Row>(`/processing/trace/${item!.batch.id}`, token),
    enabled: showTrace && !!item,
  });
  async function action(path: string, data: Row, key: string) {
    const r = await post(path, { ...data, idempotencyKey: key });
    await refreshRecords();
    if (r.outputs && data.kind !== "PREWASH")
      setOutputs(
        r.outputs.map((output: Row) => ({
          ...output,
          sourceNumber: item?.rootFacts?.number ?? item?.batch.number,
        })),
      );
    if (data.kind === "PREWASH") setOutputs([]);
    await scan(code, true, data.kind !== "PREWASH" && !!r.outputs?.length);
    return r;
  }
  const rows = (name: string) => refs.data?.[name] ?? [];
  const b = item?.batch,
    t = item?.trip,
    bag = b?.bigBag;
  const nextStep = item ? processingNextStep(item, permissions, roles) : null;
  const currentStocks = (b?.stocks ?? []).filter(
    (s: Row) => Number(s.quantity) > 0,
  );
  const warehouseDefault =
    (item?.preparedAvailable ? item.preparedWarehouseId : undefined) ??
    currentStocks[0]?.warehouseId ??
    t?.destinationWarehouseId;
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
        comparison={{
          input:
            kind === "DRYING"
              ? selected.reduce((a, x) => a + Number(x.initialQuantity), 0)
              : kind === "PREWASH"
                ? Number(
                    item?.rootFacts?.physicalReceivedByWarehouse?.[
                      warehouseDefault
                    ] ??
                      t?.receivedWeight ??
                      0,
                  )
                : Number(item?.preparedQuantity ?? b?.initialQuantity ?? 0),
          min: kind === "PREWASH" ? 21 : kind === "DRYING" ? 36 : 0,
          max: kind === "PREWASH" ? 27 : kind === "DRYING" ? 36 : 100,
          basis:
            kind === "PREWASH"
              ? "Физически принято (база сравнения перед мойкой)"
              : "Вход этапа",
          ...(kind === "PREWASH"
            ? {
                basesByWarehouse: Object.fromEntries(
                  Object.entries(
                    item?.rootFacts?.physicalReceivedByWarehouse ?? {},
                  ).map(([k, v]) => [k, Number(v)]),
                ),
                materialInput: Number(
                  b?.actualCollectedQuantity ?? b?.initialQuantity ?? 0,
                ),
              }
            : {}),
        }}
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
              ...(kind !== "PREWASH"
                ? Object.fromEntries(
                    [
                      "wasteQuantity",
                      "lossQuantity",
                      "defectQuantity",
                      "shift",
                      "lineLabel",
                    ]
                      .filter((k) => String(f.get(k) ?? "").trim())
                      .map((k) => [k, String(f.get(k)).replace(",", ".")]),
                  )
                : {}),
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
        {kind !== "PREWASH" && (
          <details>
            <summary>Баланс, смена и участок</summary>
            <div className="formGrid compact">
              <Field
                name="wasteQuantity"
                label="Отходы, т"
                type="number"
                required={false}
                min={0}
                step="0.001"
              />
              <Field
                name="lossQuantity"
                label="Потери, т"
                type="number"
                required={false}
                min={0}
                step="0.001"
              />
              <Field
                name="defectQuantity"
                label="Брак, т"
                type="number"
                required={false}
                min={0}
                step="0.001"
              />
              <Field name="shift" label="Смена" required={false} />
              <Field
                name="lineLabel"
                label="Линия / участок"
                required={false}
              />
            </div>
            <p className="metric">
              Категории не пересекаются: вход = выпуск + отходы + потери + брак.
              Если категории не заполнены, разница записывается как потеря.
              Исполнитель — текущий сотрудник.
            </p>
          </details>
        )}
        <p>
          {kind === "PREWASH"
            ? "Потеря перед мойкой: ориентир 21–27% от физически принятого веса. Лабораторный осадок показан отдельно; при отклонении нужна причина."
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
      {packingMode && (
        <section className="panel">
          <h2>Упаковка по QR</h2>
          <p>
            Сканирование принятого на склад биг-бэга подтверждает упаковку за
            вами. Проверьте дату и смену перед сканированием.
          </p>
          <label>
            Дата смены
            <input
              type="date"
              required
              value={packingDate}
              onChange={(e) => setPackingDate(e.target.value)}
            />
          </label>
          <label>
            Смена
            <input
              required
              maxLength={80}
              value={packingShift}
              onChange={(e) => setPackingShift(e.target.value)}
            />
          </label>
        </section>
      )}
      {(!embedded || packingMode) && <QrInput onScan={scan} />}
      {packingMessage && (
        <p className="notice" role="status">
          {packingMessage}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {refs.error && <p className="error">{refs.error.message}</p>}
      {item && (
        <>
          <article
            ref={partyRef}
            tabIndex={-1}
            className="panel workflow-party scanned-record"
            aria-label="Открытая партия"
          >
            <p className="eyebrow">Карточка партии</p>
            <h2>{bag ? `Биг-бэг №${bag.ordinal}` : recordLabel(b.number)}</h2>
            {bag && <p>{recordLabel(item.rootFacts?.number ?? b.number)}</p>}
            <p>
              {bag
                ? labels[bag.stage]
                : t
                  ? (labels[t.status] ?? t.status)
                  : labels[b.state]}
            </p>
            <div className="workflow-metrics">
              <strong>
                {b.actualCollectedQuantity != null || b.initialQuantity != null
                  ? tonnes(b.actualCollectedQuantity ?? b.initialQuantity)
                  : "Вес доступен на вашем этапе"}
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
            {!item.readOnly &&
              bag &&
              !bag.soldAt &&
              currentStocks.length === 0 && (
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
            {item.analyses.length > 0 && (
              <p className="notice">
                Сохранённая база анализа:{" "}
                {tonnes(item.analyses[0].baseQuantity)}. Расчёт после осадка до
                округления:{" "}
                {(
                  Number(item.analyses[0].baseQuantity) *
                  (100 - Number(item.analyses[0].sedimentPercent)) *
                  10
                ).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}{" "}
                кг. Для учёта используется точность 1 кг; влажность повторно не
                вычитается.
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
            {item.qrImage && (
              <details>
                <summary>
                  {bag ? "QR биг-бэга · печать" : "QR партии · печать"}
                </summary>
                <QrCards
                  items={[
                    {
                      ...b,
                      ordinal: bag?.ordinal,
                      sourceNumber: item.rootFacts?.number,
                      qrImage: item.qrImage,
                    },
                  ]}
                />
              </details>
            )}
            {!item.readOnly && (
              <button
                className="button secondary"
                onClick={() => setShowTrace((v) => !v)}
              >
                Вся история партии
              </button>
            )}
          </article>
          <div
            ref={actionsRef}
            tabIndex={-1}
            className="workflow-stack scanned-record"
            aria-label="Действия по партии"
          >
            {nextStep && (
              <section className="panel" aria-label="Следующий шаг партии">
                <p className="eyebrow">Дальнейшие действия</p>
                <h3>{nextStep.title}</h3>
                <p>{nextStep.detail}</p>
                {!nextStep.available && nextStep.role && (
                  <p className="notice">
                    Этот шаг выполняет: {nextStep.role}. У вашей учётной записи
                    нет права на это действие.
                  </p>
                )}
              </section>
            )}
            {can("laboratory.manage") &&
              !bag &&
              !!t?.receivedWeight &&
              !item.preparedBatchId &&
              item.analyses.length === 0 && (
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
                        fileIds: files,
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
                  <PhotoUpload token={token} ids={files} setIds={setFiles} />
                  <p className="notice">
                    Расчёт после осадка не вычитает влажность повторно. Исходные
                    данные сохраняются. Учётная точность — 0,001 т (1 кг).
                  </p>
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
              item.analyses.length > 0 &&
              processForm("PREWASH", [b.id])}
            {can("processing.wash") &&
              item.preparedBatchId &&
              item.preparedAvailable &&
              !bag &&
              processForm("WASHING", [item.preparedBatchId])}
            {(can("processing.dispatch") || can("processing.dry")) &&
              bag?.stage === "WASHED" &&
              currentStocks.length > 0 &&
              !bag.soldAt &&
              !bag.factoryStartedAt && (
                <ActionForm
                  key={`intake:${b.id}`}
                  title={
                    can("processing.dry")
                      ? "Приём на завод"
                      : "Отправка на завод"
                  }
                  submit={
                    can("processing.dry")
                      ? "Принять этот биг-бэг на завод"
                      : "Отправить этот биг-бэг на завод"
                  }
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
              currentStocks.length > 0 &&
              !bag.soldAt &&
              bag.factoryStartedAt && (
                <>
                  <div className="panel">
                    <h3>Биг-бэги на завод</h3>
                    <p>Сканируйте каждый входной QR. Повторы не добавляются.</p>
                    {selected.map((x) => (
                      <p key={x.id}>
                        Биг-бэг №{x.bigBag?.ordinal ?? "—"} ·{" "}
                        {tonnes(x.initialQuantity)}{" "}
                        <button
                          className="button secondary"
                          onClick={() =>
                            setSelected((old) =>
                              old.filter((y) => y.id !== x.id),
                            )
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
              currentStocks.length > 0 &&
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
              currentStocks.length > 0 &&
              !bag.receivedAt &&
              !bag.soldAt && (
                <p className="notice">
                  Упаковка станет доступна после приёмки биг-бэга на склад
                  готовой продукции.
                </p>
              )}
            {can("processing.pack") &&
              bag?.stage === "DRIED" &&
              currentStocks.length > 0 &&
              !!bag.receivedAt &&
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
            {(can("processing.sell") ||
              (can("processing.sell.washed") && bag?.stage === "WASHED")) &&
              bag &&
              currentStocks.length > 0 &&
              !bag.soldAt &&
              ((bag.stage === "WASHED" && !bag.factoryStartedAt) ||
                (bag.receivedAt && bag.packedAt)) && (
                <ActionForm
                  key={`sale:${b.id}`}
                  title={
                    bag.stage === "WASHED"
                      ? "Продать с мойки"
                      : "Отпуск готовой продукции"
                  }
                  submit="Подтвердить продажу и списать"
                  onSubmit={async (f, key) =>
                    action(
                      "/processing/sales",
                      { ...saleDeliveryPayload(f), batchIds: [b.id] },
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
                  <Field
                    name="documentNumber"
                    label="Номер документа продажи"
                  />
                  <SaleDeliveryFields
                    drivers={rows("drivers")}
                    vehicles={rows("vehicles")}
                  />
                </ActionForm>
              )}
          </div>
          {showTrace && (
            <section className="panel">
              <h2>История исходной партии</h2>
              {trace.error && <p className="error">{trace.error.message}</p>}
              {trace.data && (
                <>
                  <p>
                    {recordLabel(trace.data.root.number)} · Собрано{" "}
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
                      {r.comparisonBaseQuantity && (
                        <p>
                          База сравнения: {tonnes(r.comparisonBaseQuantity)}{" "}
                          {r.coefficientBasis === "RECEIVED_LOSS"
                            ? "· физически принято"
                            : "· вход этапа"}
                        </p>
                      )}
                      {r.balance && (
                        <p>
                          Отходы {tonnes(r.balance.wasteQuantity)} · потери{" "}
                          {tonnes(r.balance.lossQuantity)} · брак{" "}
                          {tonnes(r.balance.defectQuantity)}
                        </p>
                      )}
                      {(r.shift || r.lineLabel) && (
                        <p>
                          Смена: {r.shift ?? "—"} · участок:{" "}
                          {r.lineLabel ?? "—"}
                        </p>
                      )}
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
      {outputs.length > 0 && (
        <div
          ref={outputRef}
          tabIndex={-1}
          className="scanned-record"
          aria-label="QR созданных биг-бэгов"
        >
          <h2>Созданы биг-бэги: {outputs.length}</h2>
          <p>Каждому биг-бэгу соответствует отдельный QR для печати.</p>
          <QrCards items={outputs} />
        </div>
      )}
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
