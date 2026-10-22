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
import { webRequest, networkFetch } from "./session";
import { createCommandId } from "./command-id.mjs";
import { isMobileWorkspace, mobileNotify, printQr } from "./mobile-bridge";
type Row = Record<string, any>;
const UploadState = createContext<(busy: boolean) => void>(() => {});
export const labels: Record<string, string> = {
  LOADED: "Готов к выезду",
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
        type={type}
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
}: {
  title: string;
  children: ReactNode;
  submit: string;
  onSubmit: (values: FormData, key: string) => Promise<unknown>;
  lockOnSuccess?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const key = useRef("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || done || uploading) return;
    const form = event.currentTarget;
    const values = new FormData(form);
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
      setBusy(false);
    }
  }
  return (
    <form
      className="panel workflow-form"
      onSubmit={save}
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
          {children}
        </UploadState.Provider>
        <button
          className="button workflow-primary"
          disabled={done || uploading}
        >
          {busy ? "Сохраняем…" : done ? "Сохранено ✓" : submit}
        </button>
      </fieldset>
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
  return (
    <ActionForm
      title="Открыть партию по QR"
      submit="Открыть партию"
      onSubmit={async () => {
        await onScan(qr);
      }}
    >
      {isMobileWorkspace() && (
        <button
          type="button"
          className="button"
          onClick={() => mobileNotify({ action: "scanQr" })}
        >
          Сканировать камерой
        </button>
      )}
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
      >
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
        <Reference
          name="vehicleId"
          label="Машина"
          rows={rows("vehicles").filter(
            (r) =>
              r.status === "ACTIVE" && (!party || r.counterpartyId === party),
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
      </ActionForm>
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
          <Field name="plateNumber" label="Госномер" />
          <Field name="brand" label="Марка" />
          <Field name="type" label="Тип машины" />
        </ActionForm>
      </details>
      <h2>Мои отправки</h2>
      {trips.error && <p role="alert">{trips.error.message}</p>}
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
export function DriverPanel({ token }: { token: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["driver-trips", token],
    queryFn: () => webRequest<Row>("/tracking/trips?pageSize=100", token),
    refetchInterval: 30000,
  });
  return (
    <div className="workflow-stack">
      <p>
        Для фоновой передачи GPS используйте Android-приложение Collection и
        разрешите точную геолокацию.
      </p>
      {q.error && <p className="error">{q.error.message}</p>}
      {q.data?.data.map((r: Row) => (
        <article className="panel" key={r.id}>
          <h2>{r.vehicle.plateNumber}</h2>
          <p>
            {r.number} · {labels[r.status] ?? r.status}
          </p>
          <p>
            {r.bagCount ?? "—"} мешков · {tonnes(r.declaredWeight)} ·{" "}
            {r.destinationWarehouse.name}
          </p>
          {["LOADED", "IN_TRANSIT"].includes(r.status) && (
            <ActionForm
              title="Статус рейса"
              submit={r.status === "LOADED" ? "Выезжаю" : "Прибыл"}
              onSubmit={async (_, key) => {
                await webRequest(`/tracking/trips/${r.id}/status`, token, {
                  method: "POST",
                  body: JSON.stringify({
                    status: r.status === "LOADED" ? "IN_TRANSIT" : "ARRIVED",
                  }),
                });
                await qc.invalidateQueries({ queryKey: ["driver-trips"] });
              }}
            >
              <p>
                Будет сохранено время{" "}
                {r.status === "LOADED" ? "выезда" : "прибытия"}.
              </p>
            </ActionForm>
          )}
        </article>
      ))}
    </div>
  );
}
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
