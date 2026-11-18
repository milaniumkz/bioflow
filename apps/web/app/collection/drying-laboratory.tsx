"use client";
import { useState, type FormEvent } from "react";
import {
  assessDryingIntake,
  assessDryingOutput,
  type CollectionDryingIntakeInput,
} from "@bioflow/shared-types";
import { kgAsTonnes } from "./weight-units";
type Row = Record<string, any>;
function yes(form: FormData, name: string) {
  const value = form.get(name);
  if (value !== "yes" && value !== "no")
    throw Error("Ответьте «Да» или «Нет» по всем показателям");
  return value === "yes";
}
export function dryingIntakeValues(f: FormData): CollectionDryingIntakeInput {
  return {
    sedimentPercent: String(f.get("sedimentPercent") ?? ""),
    moisturePercent: String(f.get("moisturePercent") ?? ""),
    conductivity: String(f.get("conductivity") ?? ""),
    waterTransparent: yes(f, "waterTransparent"),
    colorCompliant: yes(f, "colorCompliant"),
    packagingCompliant: yes(f, "packagingCompliant"),
  };
}
export function DryingIntakeResult({ laboratory: l }: { laboratory: Row }) {
  return (
    <div className="c-note">
      <strong>Лаборатория перед сушкой</strong>
      <p>
        Осадок {l.sedimentPercent}% · вычет {l.sedimentDeductionPercent}%<br />
        Влажность {l.moisturePercent}% · вычет {l.moistureDeductionPercent}%
        <br />
        Электропроводность: {l.conductivity}
        <br />
        Прозрачность воды: {l.waterTransparent ? "Да" : "Нет"}
        <br />
        Цвет соответствует: {l.colorCompliant ? "Да" : "Нет"}
        <br />
        Качество упаковки соответствует: {l.packagingCompliant ? "Да" : "Нет"}
      </p>
      <p>
        Отправлено: <b>{kgAsTonnes(l.grossWeightKg)} т</b>
        <br />
        {l.disposition === "REWORK" ? (
          <>
            Повторная мойка: <b>{kgAsTonnes(l.returnedWeightKg)} т</b>. Полный
            вес возвращается на исходную мойку. {l.reasons.join("; ")}
          </>
        ) : (
          <>
            Принято на сушку: <b>{kgAsTonnes(l.acceptedWeightKg)} т</b>
            <br />
            Вычет: {l.totalDeductionPercent}% ·{" "}
            {kgAsTonnes(l.deductionWeightKg)} т
          </>
        )}
      </p>
    </div>
  );
}
export function DryingIntakeFields({
  grossWeightKg,
}: {
  grossWeightKg: string;
}) {
  const [v, set] = useState<Record<string, string>>({
    sedimentPercent: "",
    moisturePercent: "",
    conductivity: "",
    waterTransparent: "",
    colorCompliant: "",
    packagingCompliant: "",
  });
  let preview: Row | undefined,
    error = "";
  if (Object.values(v).every(Boolean))
    try {
      preview = assessDryingIntake(grossWeightKg, {
        ...v,
        waterTransparent: v.waterTransparent === "yes",
        colorCompliant: v.colorCompliant === "yes",
        packagingCompliant: v.packagingCompliant === "yes",
      } as CollectionDryingIntakeInput);
    } catch (e) {
      error = (e as Error).message;
    }
  return (
    <fieldset>
      <legend>Лаборатория перед сушкой</legend>
      <p>
        Осадок: норма 3%, превышение × 2. Влажность: норма 35%, превышение один
        к одному.
      </p>
      <div className="c-columns">
        {[
          ["sedimentPercent", "Осадок, %"],
          ["moisturePercent", "Влажность, %"],
          ["conductivity", "Электропроводность"],
        ].map(([name, label]) => (
          <label key={name}>
            {label}
            <input
              name={name}
              aria-label={label}
              type="number"
              min="0"
              max={name === "conductivity" ? "99999999" : "100"}
              step={name === "conductivity" ? "0.001" : "0.01"}
              required
              value={v[name]}
              onChange={(e) => set({ ...v, [name]: e.target.value })}
            />
          </label>
        ))}
        {[
          ["waterTransparent", "Прозрачность воды"],
          ["colorCompliant", "Цвет соответствует"],
          ["packagingCompliant", "Качество упаковки соответствует"],
        ].map(([name, label]) => (
          <label key={name}>
            {label}
            <select
              name={name}
              aria-label={label}
              required
              value={v[name]}
              onChange={(e) => set({ ...v, [name]: e.target.value })}
            >
              <option value="">Выберите</option>
              <option value="yes">Да</option>
              <option value="no">Нет</option>
            </select>
          </label>
        ))}
      </div>
      {preview ? (
        <DryingIntakeResult laboratory={preview} />
      ) : (
        <p role={error ? "alert" : undefined}>
          {error || "Заполните все показатели для расчёта и решения о приёмке."}
        </p>
      )}
    </fieldset>
  );
}
export function DryingIntakeForm({
  grossWeightKg,
  busy,
  onConfirm,
}: {
  grossWeightKg: string;
  busy: boolean;
  onConfirm: (v: CollectionDryingIntakeInput) => void;
}) {
  const [error, setError] = useState("");
  return (
    <form
      className="c-form c-wide"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const v = dryingIntakeValues(new FormData(e.currentTarget));
          assessDryingIntake(grossWeightKg, v);
          setError("");
          onConfirm(v);
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <DryingIntakeFields grossWeightKg={grossWeightKg} />
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={busy}>Подтвердить результат лаборатории</button>
    </form>
  );
}
const stateName: Record<string, string> = {
  FINISHED: "Готовая продукция",
  REJECT: "Некондиция",
  REDRY: "Повторная сушка",
};
export function DryingBagResult({ laboratory: l }: { laboratory: Row }) {
  return (
    <div className="c-note">
      <strong>{stateName[l.state] ?? l.state}</strong>
      <p>
        Осадок {l.sedimentPercent}% · влажность {l.moisturePercent}%<br />
        Электропроводность {l.conductivity} · насыпная плотность {l.bulkDensity}{" "}
        г/см³
        <br />
        Прозрачность воды: {l.waterTransparent ? "Да" : "Нет"} · цвет:{" "}
        {l.colorCompliant ? "Да" : "Нет"}
      </p>
      {l.reasons.length ? (
        <p>{l.reasons.join("; ")}</p>
      ) : (
        <p>Все показатели в норме.</p>
      )}
    </div>
  );
}
function DryingBagFields({
  index,
  original,
}: {
  index: number;
  original?: Row;
}) {
  const p = `drying.${index}.`,
    [v, set] = useState<Record<string, string>>({
      sedimentPercent: "",
      moisturePercent: "",
      conductivity: "",
      waterTransparent: "",
      colorCompliant: "",
      bulkDensity: "",
    });
  let result: Row | undefined,
    error = "";
  if (Object.values(v).every(Boolean))
    try {
      result = assessDryingOutput({
        ...v,
        waterTransparent: v.waterTransparent === "yes",
        colorCompliant: v.colorCompliant === "yes",
      } as Parameters<typeof assessDryingOutput>[0]);
    } catch (e) {
      error = (e as Error).message;
    }
  return (
    <fieldset className="c-drying-bag">
      <legend>Бигбег {index + 1}</legend>
      <input type="hidden" name="dryingBagIndex" value={index} />
      {original ? (
        <>
          <input type="hidden" name={p + "redryBagId"} value={original.id} />
          <input
            type="hidden"
            name={p + "weightKg"}
            value={original.weightKg}
          />
          <p>Повторная сушка · вес {kgAsTonnes(original.weightKg)} т</p>
        </>
      ) : (
        <label>
          Вес бигбега
          <select
            name={p + "weightKg"}
            aria-label="Вес бигбега"
            defaultValue="500"
          >
            <option value="500">0,5 т — 500 кг</option>
            <option value="525">0,525 т — 525 кг</option>
          </select>
        </label>
      )}
      <div className="c-columns">
        {[
          ["sedimentPercent", "Осадок, %"],
          ["moisturePercent", "Влажность, %"],
          ["conductivity", "Электропроводность"],
          ["bulkDensity", "Насыпная плотность, г/см³"],
        ].map(([name, label]) => (
          <label key={name}>
            {label}
            <input
              name={p + name}
              aria-label={label}
              type="number"
              min="0"
              max={name.endsWith("Percent") ? "100" : "99999999"}
              step={name.endsWith("Percent") ? "0.01" : "0.001"}
              required
              value={v[name]}
              onChange={(e) => set({ ...v, [name]: e.target.value })}
            />
          </label>
        ))}
        {[
          ["waterTransparent", "Прозрачность воды"],
          ["colorCompliant", "Цвет соответствует"],
        ].map(([name, label]) => (
          <label key={name}>
            {label}
            <select
              name={p + name}
              aria-label={label}
              required
              value={v[name]}
              onChange={(e) => set({ ...v, [name]: e.target.value })}
            >
              <option value="">Выберите</option>
              <option value="yes">Да</option>
              <option value="no">Нет</option>
            </select>
          </label>
        ))}
      </div>
      {result ? (
        <DryingBagResult laboratory={result} />
      ) : (
        <p role={error ? "alert" : undefined}>
          {error ||
            "Заполните отдельный анализ этого бигбега. Нормы: осадок до 5%, влажность до 0,5%, электропроводность до 400, плотность до 450 г/см³."}
        </p>
      )}
    </fieldset>
  );
}
export function dryingProductionValues(f: FormData) {
  const redryBatchId = String(f.get("redryBatchId") ?? "");
  const bags = f.getAll("dryingBagIndex").map((id) => {
    const p = `drying.${id}.`,
      laboratory = {
        sedimentPercent: String(f.get(p + "sedimentPercent") ?? ""),
        moisturePercent: String(f.get(p + "moisturePercent") ?? ""),
        conductivity: String(f.get(p + "conductivity") ?? ""),
        bulkDensity: String(f.get(p + "bulkDensity") ?? ""),
        waterTransparent: yes(f, p + "waterTransparent"),
        colorCompliant: yes(f, p + "colorCompliant"),
      };
    assessDryingOutput(laboratory);
    return {
      weightKg: String(f.get(p + "weightKg") ?? ""),
      ...(redryBatchId
        ? { redryBagId: String(f.get(p + "redryBagId") ?? "") }
        : {}),
      laboratory,
    };
  });
  if (!bags.length) throw Error("Добавьте хотя бы один бигбег");
  return {
    locationId: String(f.get("locationId") ?? ""),
    ...(redryBatchId ? { redryBatchId } : {}),
    bags,
  };
}
export function DryingProductionFields({
  locations,
  batches,
}: {
  locations: Row[];
  batches: Row[];
}) {
  const [locationId, setLocation] = useState(
      locations.length === 1 ? locations[0].id : "",
    ),
    [source, setSource] = useState(""),
    [count, setCount] = useState("1");
  const redry = batches.filter(
    (b) =>
      b.locationId === locationId &&
      b.state === "REDRY" &&
      b.status === "ACTIVE" &&
      b.bags?.some((bag: Row) => bag.status === "AVAILABLE"),
  );
  const current = redry.find((b) => b.id === source);
  const originals =
    current?.bags.filter((b: Row) => b.status === "AVAILABLE") ?? [];
  const number = /^\d+$/.test(count) ? Math.min(1000, Number(count)) : 0;
  return (
    <>
      <label>
        Завод
        <select
          name="locationId"
          aria-label="Завод"
          required
          value={locationId}
          onChange={(e) => {
            setLocation(e.target.value);
            setSource("");
          }}
        >
          <option value="">Выберите завод</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Источник для сушки
        <select
          name="redryBatchId"
          aria-label="Источник для сушки"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">Мытое сырьё</option>
          {redry.map((b) => (
            <option key={b.id} value={b.id}>
              Повторная сушка · {b.id.slice(-8)} · {kgAsTonnes(b.remainingKg)} т
            </option>
          ))}
        </select>
      </label>
      <p>
        Результат каждого бигбега определяется лабораторией. Бигбеги на
        повторной сушке недоступны для отправки как ГП.
      </p>
      {!source ? (
        <label>
          Количество бигбегов
          <input
            type="number"
            min="1"
            max="1000"
            required
            value={count}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
      ) : null}
      <div key={source || "washed"}>
        {Array.from(
          { length: source ? originals.length : number },
          (_, index) => (
            <DryingBagFields
              key={index}
              index={index}
              original={source ? originals[index] : undefined}
            />
          ),
        )}
      </div>
    </>
  );
}
export function DryingProductionForm({
  locations,
  batches,
  busy,
  onSubmit,
}: {
  locations: Row[];
  batches: Row[];
  busy: boolean;
  onSubmit: (values: Row) => Promise<Row | null | undefined> | void;
}) {
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const values = dryingProductionValues(new FormData(e.currentTarget));
      setError("");
      const saved = await onSubmit(values);
      if (saved) setGeneration((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <form className="c-form c-wide" onSubmit={submit}>
      <h2>Лаборатория после сушки</h2>
      <DryingProductionFields
        key={generation}
        locations={locations}
        batches={batches}
      />
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={busy}>Сохранить лабораторию и выпуск</button>
    </form>
  );
}
