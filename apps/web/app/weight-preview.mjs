// Informational preview only. Server decimals and validations remain authoritative.
export function weightPreview(input, values) {
  const numbers = values.map((v) => Number(String(v).trim().replace(",", ".")));
  if (
    !(input > 0) ||
    !numbers.length ||
    numbers.some(
      (n, i) => !String(values[i]).trim() || !Number.isFinite(n) || n <= 0,
    )
  )
    return null;
  const output = Math.round(numbers.reduce((a, b) => a + b, 0) * 1000) / 1000;
  return {
    output,
    loss: Math.round((input - output) * 1000) / 1000,
    percent: Math.round(((input - output) / input) * 100000) / 1000,
  };
}
export function decimalError(value, { min, max, step } = {}) {
  if (!value) return "";
  const precision = (step?.split(".")[1] || "").length;
  if (!/^\d+(?:[.,]\d+)?$/.test(value))
    return "Введите положительное число. Дробную часть отделите запятой или точкой.";
  const n = Number(value.replace(",", "."));
  if (min !== undefined && n < min) return `Минимальное значение: ${min}`;
  if (max !== undefined && n > max) return `Максимальное значение: ${max}`;
  if (precision && (value.split(/[.,]/)[1] || "").length > precision)
    return `Допускается не более ${precision} знаков после запятой.`;
  return "";
}
