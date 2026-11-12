/** API/storage use kilograms; Collection screens accept and display tonnes. */
export function tonnesToKg(value: string): string {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,6})?$/.test(normalized)) {
    throw Error("Укажите вес в тоннах, до шести знаков после запятой");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const grams = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  const decimal = (grams % 1000n)
    .toString()
    .padStart(3, "0")
    .replace(/0+$/, "");
  return (grams / 1000n).toString() + (decimal ? "." + decimal : "");
}
export function formatTonnes(value: unknown): string {
  return Number(value ?? 0).toLocaleString("ru-RU", {
    maximumFractionDigits: 6,
  });
}
export function kgAsTonnes(value: unknown): string {
  return formatTonnes(Number(value ?? 0) / 1000);
}
