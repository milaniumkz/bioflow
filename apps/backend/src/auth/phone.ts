/** Canonical international phone; Kazakhstan/Russia domestic 8 and 10-digit forms. */
export function normalizePhone(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let digits = value.replace(/[\s()+-]/g, "");
  if (/^8\d{10}$/.test(digits)) digits = "7" + digits.slice(1);
  if (/^\d{10}$/.test(digits)) digits = "7" + digits;
  return /^\d{7,15}$/.test(digits) ? "+" + digits : value.trim();
}
