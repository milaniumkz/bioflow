export type CollectionLabInput = {
  sedimentPercent: string;
  moisturePercent: string;
  colorPercent: string;
};
export const COLLECTION_LAB_LIMITS = {
  sedimentPercent: 5,
  moisturePercent: 35,
  colorPercent: 40,
} as const;
function percent(value: string): number {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value))
    throw Error("Укажите процент от 0 до 100, до двух знаков после запятой");
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (result > 10000) throw Error("Процент не может превышать 100");
  return result;
}
function kilograms(grams: bigint): string {
  const part = (grams % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return (grams / 1000n).toString() + (part ? "." + part : "");
}
/** Deductions are added as percentage points of original mass; stored precision is 1 gram. */
export function calculateCollectionLaboratory(
  grossWeightKg: string,
  input: CollectionLabInput,
  sedimentLimit = 5,
) {
  if (!/^\d{1,10}(\.\d{1,3})?$/.test(grossWeightKg))
    throw Error("Некорректный исходный вес");
  const [whole, fraction = ""] = grossWeightKg.split(".");
  const gross = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  if (gross <= 0n) throw Error("Исходный вес должен быть больше нуля");
  const sediment = percent(input.sedimentPercent),
    moisture = percent(input.moisturePercent),
    color = percent(input.colorPercent);
  const sedimentDeduction = Math.max(0, sediment - sedimentLimit * 100) * 2;
  const moistureDeduction = Math.max(0, moisture - 3500);
  const colorDeduction = Math.max(0, color - 4000);
  const deduction = sedimentDeduction + moistureDeduction + colorDeduction;
  if (deduction > 10000)
    throw Error(
      "Суммарный вычет превышает 100%. Проверьте лабораторные показатели",
    );
  const accepted = (gross * BigInt(10000 - deduction) + 5000n) / 10000n;
  return {
    version: 1,
    sedimentPercent: (sediment / 100).toString(),
    moisturePercent: (moisture / 100).toString(),
    colorPercent: (color / 100).toString(),
    limits: { ...COLLECTION_LAB_LIMITS, sedimentPercent: sedimentLimit },
    sedimentDeductionPercent: (sedimentDeduction / 100).toString(),
    moistureDeductionPercent: (moistureDeduction / 100).toString(),
    colorDeductionPercent: (colorDeduction / 100).toString(),
    totalDeductionPercent: (deduction / 100).toString(),
    grossWeightKg: kilograms(gross),
    acceptedWeightKg: kilograms(accepted),
    deductionWeightKg: kilograms(gross - accepted),
  };
}

export type CollectionDryingIntakeInput = {
  sedimentPercent: string;
  moisturePercent: string;
  conductivity: string;
  waterTransparent: boolean;
  colorCompliant: boolean;
  packagingCompliant: boolean;
};
function nonnegative(value: string, label: string) {
  if (!/^\d{1,8}(\.\d{1,3})?$/.test(value))
    throw Error(`Некорректный показатель: ${label}`);
  return Number(value);
}
export function assessDryingIntake(
  grossWeightKg: string,
  input: CollectionDryingIntakeInput,
) {
  const mass = calculateCollectionLaboratory(
    grossWeightKg,
    {
      sedimentPercent: input.sedimentPercent,
      moisturePercent: input.moisturePercent,
      colorPercent: "0",
    },
    3,
  );
  const reasons: string[] = [];
  if (nonnegative(input.conductivity, "электропроводность") > 400)
    reasons.push("Электропроводность выше 400");
  if (!input.waterTransparent) reasons.push("Вода непрозрачная");
  if (!input.colorCompliant) reasons.push("Цвет не соответствует");
  if (!input.packagingCompliant)
    reasons.push("Качество упаковки не соответствует");
  return {
    ...mass,
    conductivity: input.conductivity,
    waterTransparent: input.waterTransparent,
    colorCompliant: input.colorCompliant,
    packagingCompliant: input.packagingCompliant,
    reasons,
    disposition: reasons.length ? "REWORK" : "ACCEPTED",
    calculatedAcceptedWeightKg: mass.acceptedWeightKg,
    acceptedWeightKg: reasons.length ? "0" : mass.acceptedWeightKg,
    returnedWeightKg: reasons.length ? mass.grossWeightKg : "0",
  };
}
export type CollectionDryingOutputInput = {
  sedimentPercent: string;
  moisturePercent: string;
  conductivity: string;
  waterTransparent: boolean;
  colorCompliant: boolean;
  bulkDensity: string;
};
export function assessDryingOutput(input: CollectionDryingOutputInput) {
  const sediment = percent(input.sedimentPercent) / 100,
    moisture = percent(input.moisturePercent) / 100;
  const reasons: string[] = [];
  if (sediment > 5) reasons.push("Осадок выше 5%");
  if (nonnegative(input.conductivity, "электропроводность") > 400)
    reasons.push("Электропроводность выше 400");
  if (!input.waterTransparent) reasons.push("Вода непрозрачная");
  if (!input.colorCompliant) reasons.push("Цвет не соответствует");
  if (nonnegative(input.bulkDensity, "насыпная плотность") > 450)
    reasons.push("Насыпная плотность выше 450 г/см³");
  const state = reasons.length
    ? "REJECT"
    : moisture > 0.5
      ? "REDRY"
      : "FINISHED";
  if (state === "REDRY") reasons.push("Влажность выше 0,5%");
  return {
    ...input,
    version: 1,
    state,
    reasons,
    limits: {
      sedimentPercent: 5,
      moisturePercent: 0.5,
      conductivity: 400,
      bulkDensity: 450,
      bulkDensityUnit: "г/см³",
    },
  };
}
