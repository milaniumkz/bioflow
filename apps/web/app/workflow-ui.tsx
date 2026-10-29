"use client";
import {
  FormEvent,
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { QrScanner } from "./qr-scanner";
import { webRequest, networkFetch } from "./session";
import { createCommandId } from "./command-id.mjs";
import { isMobileWorkspace, mobileNotify, printQr } from "./mobile-bridge";
import { weightPreview, decimalError } from "./weight-preview.mjs";
type Row = Record<string, any>;
const UploadState = createContext<(busy: boolean) => void>(() => {});
export const labels: Record<string, string> = {
  CREATED: "Ожидает загрузки",
  LOADED: "Загрузился",
  IN_TRANSIT: "В пути",
  ARRIVED: "Прибыл",
  ACCEPTED: "Принят",
  ACCEPTED_WITH_DIFFERENCE: "Принят с расхождением",
  DIRTY: "Собранное сырьё",
  WASHED: "Мытое",
  FINISHED: "Готовая продукция",
  PREWASH: "Перед мойкой",
  WASHING: "Мойка",
  DRYING: "Завод",
  NORMAL: "В норме",
  ABOVE: "Выше нормы",
  BELOW: "Ниже нормы",
  DRIED: "Высушен",
};
export const tonnes = (value: unknown) =>
  `${Number(value ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т`;
export const dateTime = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString("ru-RU") : "—";
export const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function Field({
  name,
  label,
  type = "text",
  required = true,
  defaultValue,
  min,
  max,
  step,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type === "number" && step && step !== "1" ? "text" : type}
        inputMode={type === "number" ? "decimal" : undefined}
        data-decimal={
          type === "number" && step && step !== "1" ? "true" : undefined
        }
        onChange={
          type === "number" && step && step !== "1"
            ? (e) =>
                e.currentTarget.setCustomValidity(
                  decimalError(e.currentTarget.value, { min, max, step }),
                )
            : undefined
        }
        required={required}
        defaultValue={defaultValue}
        min={min}
        max={max}
        step={step}
      />
    </label>
  );
}
export function ActionForm({
  title,
  children,
  submit,
  onSubmit,
  lockOnSuccess = false,
  steps,
  comparison,
}: {
  title: string;
  children?: ReactNode;
  steps?: Array<{ title: string; content: ReactNode }>;
  comparison?: {
    input: number;
    min: number;
    max: number;
    basis: string;
    basesByWarehouse?: Record<string, number>;
    materialInput?: number;
  };
  submit: string;
  onSubmit: (values: FormData, key: string) => Promise<unknown>;
  lockOnSuccess?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [uploading, setUploading] = useState(false);
  const submitting = useRef(false);
  const key = useRef("");
  const formRef = useRef<HTMLFormElement>(null);
  const [comparisonInput, setComparisonInput] = useState(
    comparison?.input ?? 0,
  );
  const [preview, setPreview] =
    useState<ReturnType<typeof weightPreview>>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [summary, setSummary] = useState<Array<[string, string]>>([]);
  useEffect(() => {
    if (steps && stepIndex > 0)
      formRef.current?.querySelector<HTMLElement>("h3")?.focus();
  }, [stepIndex]);
  function nextStep() {
    const form = formRef.current;
    if (!form || !steps) return;
    const active = form.querySelector(`[data-step="${stepIndex}"]`);
    for (const input of Array.from(
      active?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        "input,select,textarea",
      ) ?? [],
    )) {
      if (!input.reportValidity()) return;
    }
    const values: Array<[string, string]> = [];
    for (const input of Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        "input[name],select[name]",
      ),
    )) {
      if (!input.value || input.type === "file" || input.type === "hidden")
        continue;
      const label =
        input.closest("label")?.firstChild?.textContent?.trim() || input.name;
      const value =
        input instanceof HTMLSelectElement
          ? input.selectedOptions[0]?.textContent || input.value
          : input.value;
      values.push([label, value]);
    }
    setSummary(values);
    setStepIndex(Math.min(stepIndex + 1, steps.length));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || busy || done || uploading) return;
    if (steps && stepIndex < steps.length) {
      nextStep();
      return;
    }
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    for (const input of Array.from(
      form.querySelectorAll<HTMLInputElement>("input[data-decimal=true]"),
    )) {
      // Repeated outputWeights values are normalized by each actual API adapter.
      if (values.getAll(input.name).length === 1)
        values.set(input.name, input.value.replace(",", "."));
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    key.current ||= createCommandId();
    try {
      await onSubmit(values, key.current);
      setDone(true);
      window.dispatchEvent(
        new CustomEvent("bioflow:saved", { detail: { form } }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      ref={formRef}
      noValidate
      className="panel workflow-form"
      onSubmit={save}
      onInvalidCapture={(event) => {
        const input = event.target as HTMLInputElement;
        const label =
          input.closest("label")?.firstChild?.textContent?.trim() ||
          input.name ||
          "Поле";
        setValidationError(`${label}: ${input.validationMessage}`);
      }}
      onInput={() => {
        setValidationError("");
        if (comparison && formRef.current) {
          const warehouse =
            formRef.current.querySelector<HTMLSelectElement>(
              "[name=fromWarehouseId]",
            )?.value ?? "";
          const base = comparison.basesByWarehouse
            ? (comparison.basesByWarehouse[warehouse] ?? 0)
            : comparison.input;
          setComparisonInput(base);
          setPreview(
            weightPreview(
              base,
              Array.from(
                formRef.current.querySelectorAll<HTMLInputElement>(
                  "[name=outputWeights]",
                ),
              ).map((i) => i.value),
            ),
          );
        }
      }}
      onChange={() => {
        if (!busy) {
          key.current = "";
          setDone(false);
          setError("");
        }
      }}
    >
      <h2>{title}</h2>
      <fieldset disabled={busy || (done && lockOnSuccess)}>
        <UploadState.Provider value={setUploading}>
          {steps ? (
            <>
              <div
                className="wizard-progress"
                aria-label={`Шаг ${stepIndex + 1} из ${steps.length + 1}`}
              >
                {[...steps, { title: "Проверка" }].map((s, i) => (
                  <span key={s.title} data-active={i <= stepIndex} />
                ))}
              </div>
              <h3 tabIndex={-1}>
                {stepIndex < steps.length
                  ? steps[stepIndex].title
                  : "Проверьте отправку"}
              </h3>
              {steps.map((s, i) => (
                <section
                  key={s.title}
                  className="wizard-step"
                  data-step={i}
                  hidden={i !== stepIndex}
                >
                  {s.content}
                </section>
              ))}
              {stepIndex === steps.length && (
                <>
                  <p className="notice">
                    Партия, рейс и первый QR появятся после подтверждения
                    сервера. Повторная попытка не создаёт вторую отправку.
                  </p>
                  <dl className="confirmation-list">
                    {summary.map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </>
          ) : (
            children
          )}
        </UploadState.Provider>
        {comparison && (
          <aside className="notice" aria-live="polite">
            <strong>Баланс операции</strong>
            <p>
              {comparison.basis}:{" "}
              {comparisonInput > 0
                ? tonnes(comparisonInput)
                : "не определена — завершите приёмку"}
            </p>
            {preview ? (
              <>
                <p>
                  Фактический выход: {tonnes(preview.output)}
                  <br />
                  Потеря: {tonnes(preview.loss)} ·{" "}
                  {preview.percent.toLocaleString("ru-RU")}%
                </p>
                <p>
                  {preview.percent < comparison.min ||
                  preview.percent > comparison.max
                    ? "Отклонение от ориентира — укажите причину"
                    : "В пределах ориентира"}
                </p>
              </>
            ) : (
              <p>
                Введите фактический вес для расчёта. Норма не подставляет выход
                автоматически.
              </p>
            )}
            <small>
              Ориентир:{" "}
              {comparison.min === comparison.max
                ? comparison.min
                : `${comparison.min}–${comparison.max}`}
              %. Итог подтверждает сервер.
            </small>
          </aside>
        )}
        <div className="toolbar">
          {steps && stepIndex > 0 && !done && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setStepIndex((i) => i - 1)}
            >
              Назад
            </button>
          )}
          {steps && stepIndex < steps.length ? (
            <button
              type="button"
              className="button workflow-primary"
              disabled={uploading}
              key="next-step"
              onClick={(event) => {
                event.preventDefault();
                nextStep();
              }}
            >
              Далее:{" "}
              {stepIndex + 1 < steps.length
                ? steps[stepIndex + 1].title.toLowerCase()
                : "проверка отправки"}
            </button>
          ) : (
            <button
              className="button workflow-primary"
              disabled={done || uploading}
            >
              {busy ? "Сохраняем…" : done ? "Сохранено ✓" : submit}
            </button>
          )}
        </div>
      </fieldset>
      {validationError && (
        <p className="error" role="alert">
          {validationError}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
export function useReferences(token: string) {
  return useQuery({
    queryKey: ["workflow-refs", token],
    queryFn: async () => {
      const out: Record<string, Row[]> = {};
      for (const name of [
        "counterparties",
        "extraction-sites",
        "warehouses",
        "material-types",
        "product-types",
        "vehicles",
        "drivers",
      ]) {
        const rows: Row[] = [];
        for (let page = 1; ; page++) {
          const r = await webRequest<Row>(
            `/${name}?pageSize=100&page=${page}`,
            token,
          );
          rows.push(...r.data);
          if (rows.length >= r.total || !r.data.length) break;
        }
        out[name] = rows.filter(
          (r) =>
            !r.archivedAt && (r.status === undefined || r.status === "ACTIVE"),
        );
      }
      return out;
    },
  });
}
export function Reference({
  name,
  label,
  rows,
  defaultValue,
  onChange,
}: {
  name: string;
  label: string;
  rows: Row[];
  defaultValue?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <label>
      {label}
      <select
        name={name}
        required
        defaultValue={defaultValue ?? (rows.length === 1 ? rows[0].id : "")}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value="" disabled>
          Выберите…
        </option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.plateNumber ?? r.fullName ?? r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function PhotoUpload({
  token,
  ids,
  setIds,
}: {
  token: string;
  ids: string[];
  setIds: (ids: string[]) => void;
}) {
  const setParentUploading = useContext(UploadState);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <label>
      Фото весов / документы
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple
        disabled={busy}
        onChange={async (e) => {
          const list = Array.from(e.target.files ?? []);
          setBusy(true);
          setParentUploading(true);
          setError("");
          try {
            const saved = [...ids];
            for (const f of list) {
              if (f.size > 20 * 1024 * 1024)
                throw Error("Файл должен быть не больше 20 МБ");
              const x = await webRequest<Row>("/files/upload-url", token, {
                method: "POST",
                body: JSON.stringify({
                  fileName: f.name,
                  mimeType: f.type,
                  size: f.size,
                }),
              });
              const r = await networkFetch(x.uploadUrl, {
                method: "PUT",
                headers: { "Content-Type": f.type },
                body: f,
              });
              if (!r.ok) throw Error("Не удалось загрузить файл");
              await webRequest(`/files/${x.file.id}/complete`, token, {
                method: "POST",
                body: "{}",
              });
              saved.push(x.file.id);
              setIds([...saved]);
            }
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
            setParentUploading(false);
          }
        }}
      />
      <small>{busy ? "Загрузка…" : `Загружено: ${ids.length}`}</small>
      {error && <span className="error">{error}</span>}
    </label>
  );
}
export function QrCards({ items }: { items: Row[] }) {
  const [print, setPrint] = useState("");
  return (
    <>
      <div className="workflow-grid">
        {items.map((r) => (
          <article className="panel qr-result" key={r.id}>
            <h3>{r.number}</h3>
            <p>{tonnes(r.initialQuantity ?? r.declaredWeight)}</p>
            <img
              src={r.qrImage}
              alt={`QR ${r.number}`}
              width="220"
              height="220"
            />
            <button
              className="button secondary"
              onClick={() => {
                setPrint(r.qrImage);
                if (isMobileWorkspace()) printQr(r.qrImage);
                else setTimeout(() => window.print(), 50);
              }}
            >
              Печатать QR
            </button>
          </article>
        ))}
      </div>
      {print &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="qr-print-sheet" aria-hidden="true">
            <img src={print} alt="" />
          </div>,
          document.body,
        )}
    </>
  );
}
export function QrInput({ onScan }: { onScan: (qr: string) => Promise<void> }) {
  const [qr, setQr] = useState("");
  const [scanner, setScanner] = useState(false);
  return (
    <>
      <ActionForm
        title="Открыть партию по QR"
        submit="Открыть партию"
        onSubmit={async () => {
          await onScan(qr);
        }}
      >
        {
          <button
            type="button"
            className="button"
            onClick={() =>
              isMobileWorkspace()
                ? mobileNotify({ action: "scanQr" })
                : setScanner(true)
            }
          >
            Сканировать камерой
          </button>
        }
        <label>
          QR-код
          <input
            required
            value={qr}
            onChange={(e) => setQr(e.target.value.trim())}
            placeholder="Сканируйте или вставьте код"
          />
        </label>
      </ActionForm>
      {scanner && (
        <QrScanner onScan={onScan} onClose={() => setScanner(false)} />
      )}
    </>
  );
}
export function CollectionPanel({ token }: { token: string }) {
  const [draftVersion, setDraftVersion] = useState(0);
  const refs = useReferences(token),
    qc = useQueryClient();
  const [files, setFiles] = useState<string[]>([]),
    [party, setParty] = useState(""),
    [qr, setQr] = useState<Row[]>([]);
  const rows = (name: string) => refs.data?.[name] ?? [];
  const trips = useQuery({
    queryKey: ["collection-trips", token],
    queryFn: () => webRequest<Row>("/collection/trips?pageSize=100", token),
    refetchInterval: 30000,
  });
  const send = (path: string, data: Row) =>
    webRequest<Row>(path, token, {
      method: "POST",
      body: JSON.stringify(data),
    });
  if (refs.isPending) return <p>Загружаем ваши машины и места сбора…</p>;
  if (refs.error) return <p role="alert">{refs.error.message}</p>;
  return (
    <div className="workflow-stack">
      <ActionForm
        key={draftVersion}
        lockOnSuccess
        title="Новая отправка"
        submit="Создать отправку и QR"
        onSubmit={async (f, key) => {
          const r = await send("/collection/dispatch", {
            idempotencyKey: key,
            ...Object.fromEntries(f),
            bagCount: Number(f.get("bagCount")),
            measuredAt: new Date(String(f.get("measuredAt"))).toISOString(),
            fileIds: files,
          });
          setQr([r]);
          await qc.invalidateQueries({ queryKey: ["collection-trips"] });
        }}
        steps={[
          {
            title: "Груз и отправитель",
            content: (
              <>
                <Reference
                  name="counterpartyId"
                  label="Контрагент"
                  rows={rows("counterparties")}
                  onChange={setParty}
                />
                <Reference
                  name="extractionSiteId"
                  label="Место сбора"
                  rows={rows("extraction-sites")}
                />
                <Reference
                  name="materialTypeId"
                  label="Материал"
                  rows={rows("material-types")}
                />
                <Field
                  name="bagCount"
                  label="Количество мешков"
                  type="number"
                  min={1}
                  max={1000000}
                  step="1"
                />
                <Field
                  name="quantity"
                  label="Вес, т"
                  type="number"
                  min={0.001}
                  step="0.001"
                />
                <Field
                  name="measuredAt"
                  label="Дата и время взвешивания"
                  type="datetime-local"
                  defaultValue={localNow()}
                />
                <PhotoUpload token={token} ids={files} setIds={setFiles} />
              </>
            ),
          },
          {
            title: "Машина и водитель",
            content: (
              <>
                <Reference
                  name="vehicleId"
                  label="Машина"
                  rows={rows("vehicles").filter(
                    (r) =>
                      r.status === "ACTIVE" &&
                      (!party || r.counterpartyId === party),
                  )}
                />
                <Reference
                  name="driverId"
                  label="Водитель"
                  rows={rows("drivers").filter(
                    (r) => r.userId && (!party || r.counterpartyId === party),
                  )}
                />
                <Reference
                  name="destinationWarehouseId"
                  label="Куда отправляем"
                  rows={rows("warehouses")}
                />
              </>
            ),
          },
        ]}
      ></ActionForm>
      <QrCards items={qr} />
      {qr.length > 0 && (
        <button
          className="button"
          onClick={() => {
            setDraftVersion((n) => n + 1);
            setFiles([]);
            setQr([]);
          }}
        >
          Создать следующую отправку
        </button>
      )}
      <details className="panel">
        <summary>Добавить водителя</summary>
        <ActionForm
          title="Новый водитель"
          submit="Создать водителя"
          onSubmit={async (f, key) => {
            await send("/collection/drivers", {
              ...Object.fromEntries(f),
              idempotencyKey: key,
            });
            await qc.invalidateQueries({ queryKey: ["workflow-refs"] });
          }}
        >
          <Reference
            name="counterpartyId"
            label="Контрагент"
            rows={rows("counterparties")}
          />
          <Field name="fullName" label="Имя водителя" />
          <Field name="phone" label="Номер телефона" type="tel" />
          <p>
            Временный пароль: 123456. При первом входе водитель задаст личный
            пароль.
          </p>
        </ActionForm>
      </details>
      <details className="panel">
        <summary>Добавить машину</summary>
        <ActionForm
          title="Новая машина"
          submit="Создать машину"
          onSubmit={async (f, key) => {
            await send("/collection/vehicles", {
              ...Object.fromEntries([...f].filter(([, value]) => value !== "")),
              idempotencyKey: key,
            });
            await qc.invalidateQueries({ queryKey: ["workflow-refs"] });
          }}
        >
          <Reference
            name="counterpartyId"
            label="Контрагент"
            rows={rows("counterparties")}
          />
          <Field name="plateNumber" label="Госномер" />
          <Field name="brand" label="Марка" />
          <Field name="type" label="Тип машины" />
          <Field name="model" label="Модель" required={false} />
          <Field
            name="capacity"
            label="Грузоподъёмность, т"
            type="number"
            step="0.001"
            min={0.001}
            required={false}
          />
          <Field
            name="tareWeight"
            label="Тара, т"
            type="number"
            step="0.001"
            min={0}
            required={false}
          />
        </ActionForm>
      </details>
      <h2>Мои отправки</h2>
      {trips.isPending && <p role="status">Загружаем отправки…</p>}
      {trips.error && (
        <p role="alert" className="error">
          {trips.error.message}
        </p>
      )}
      {trips.data?.data.length === 0 && (
        <div className="empty-state">
          <strong>Отправок пока нет</strong>Создайте первую отправку. Здесь
          появятся только подтверждённые сервером рейсы.
        </div>
      )}
      {trips.data?.data.map((r: Row) => (
        <article className="panel" key={r.id}>
          <h3>{r.number}</h3>
          <p>
            {r.bagCount} мешков · {tonnes(r.declaredWeight)}
          </p>
          <p>
            {r.vehicle.plateNumber} · {r.driver?.fullName} ·{" "}
            {labels[r.status] ?? r.status}
          </p>
        </article>
      ))}
    </div>
  );
}
export { DriverPanel } from "./driver-panel";

export function EvidenceFiles({
  token,
  files,
}: {
  token: string;
  files: Row[];
}) {
  const [image, setImage] = useState(""),
    [error, setError] = useState("");
  return (
    <section>
      <h3>Фото весов и документы</h3>
      {!files.length && <p>Вложений нет.</p>}
      {files.map((file) => (
        <button
          key={file.id}
          className="button secondary"
          onClick={async () => {
            setError("");
            try {
              const d = await webRequest<Row>(
                `/files/${file.id}/download-url`,
                token,
              );
              if (file.mimeType.startsWith("image/")) setImage(d.downloadUrl);
              else {
                const response = await networkFetch(d.downloadUrl);
                if (!response.ok) throw Error("Не удалось скачать документ");
                const { saveBlob } = await import("./mobile-bridge");
                await saveBlob(await response.blob(), file.fileName);
              }
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {file.fileName}
        </button>
      ))}
      {image && (
        <div className="panel">
          <img
            src={image}
            alt="Фото документа партии"
            style={{ maxWidth: "100%", maxHeight: 600 }}
          />
          <button className="button secondary" onClick={() => setImage("")}>
            Закрыть фото
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
