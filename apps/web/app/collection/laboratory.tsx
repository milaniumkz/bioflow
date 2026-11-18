"use client";
import { useState, type FormEvent } from "react";
import {
  calculateCollectionLaboratory,
  type CollectionLabInput,
} from "@bioflow/shared-types";
import { kgAsTonnes } from "./weight-units";
export function laboratoryValues(form: FormData): CollectionLabInput {
  return {
    sedimentPercent: String(form.get("sedimentPercent") ?? ""),
    moisturePercent: String(form.get("moisturePercent") ?? ""),
    colorPercent: String(form.get("colorPercent") ?? ""),
  };
}
export function LaboratoryFields({ grossWeightKg }: { grossWeightKg: string }) {
  const [values, setValues] = useState<CollectionLabInput>({
    sedimentPercent: "",
    moisturePercent: "",
    colorPercent: "",
  });
  let result: ReturnType<typeof calculateCollectionLaboratory> | undefined,
    error = "";
  if (Object.values(values).every(Boolean))
    try {
      result = calculateCollectionLaboratory(grossWeightKg, values);
    } catch (e) {
      error = (e as Error).message;
    }
  return (
    <fieldset className="c-laboratory">
      <legend>Лаборатория перед приёмкой</legend>
      <p>
        Отправлено: <b>{kgAsTonnes(grossWeightKg)} т</b>. Вычитается только
        превышение нормы от исходной массы.
      </p>
      <div className="c-columns">
        {(
          [
            [
              "sedimentPercent",
              "Осадок, %",
              "Норма до 5%. Только превышение × 2.",
            ],
            [
              "moisturePercent",
              "Влажность, %",
              "Норма до 35%. Вычет только за превышение.",
            ],
            [
              "colorPercent",
              "Цвет, %",
              "Норма до 40%. Вычет только за превышение.",
            ],
          ] as const
        ).map(([name, label, hint]) => (
          <label key={name}>
            {label}
            <input
              name={name}
              aria-label={label}
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={values[name]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [name]: e.target.value }))
              }
            />
            <small>{hint}</small>
          </label>
        ))}
      </div>
      {result ? (
        <LaboratoryResult laboratory={result} />
      ) : (
        <p role={error ? "alert" : undefined}>
          {error ||
            "Укажите все три показателя, чтобы увидеть фактически принимаемый вес."}
        </p>
      )}
    </fieldset>
  );
}
export function LaboratoryResult({
  laboratory: l,
}: {
  laboratory: Record<string, any>;
}) {
  return (
    <div className="c-note c-lab-result">
      <strong>Результаты лаборатории</strong>
      <p>
        Осадок: {l.sedimentPercent}% · вычет {l.sedimentDeductionPercent}%<br />
        Влажность: {l.moisturePercent}% · вычет {l.moistureDeductionPercent}%
        <br />
        Цвет: {l.colorPercent}% · вычет {l.colorDeductionPercent}%
      </p>
      <p>
        Отправлено: <b>{kgAsTonnes(l.grossWeightKg)} т</b>
        <br />
        Вычет:{" "}
        <b>
          {l.totalDeductionPercent}% · {kgAsTonnes(l.deductionWeightKg)} т
        </b>
        <br />
        Принято после лаборатории: <b>{kgAsTonnes(l.acceptedWeightKg)} т</b>
      </p>
    </div>
  );
}
export function RawAcceptanceForm({
  grossWeightKg,
  busy,
  onConfirm,
}: {
  grossWeightKg: string;
  busy: boolean;
  onConfirm: (values: CollectionLabInput) => void;
}) {
  const [error, setError] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const values = laboratoryValues(new FormData(e.currentTarget));
      calculateCollectionLaboratory(grossWeightKg, values);
      setError("");
      onConfirm(values);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <form className="c-form c-wide" onSubmit={submit}>
      <LaboratoryFields grossWeightKg={grossWeightKg} />
      {error ? (
        <p role="alert" className="c-error">
          {error}
        </p>
      ) : null}
      <button disabled={busy}>Подтвердить приход</button>
    </form>
  );
}
