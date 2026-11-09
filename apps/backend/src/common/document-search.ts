// Search the stored document number using the same short Russian label shown in UI.
export function documentSearch(value: string) {
  const match = value
    .trim()
    .match(/^(партия|рейс|обработка|операция)\s*№?\s*(\d+)$/iu);
  if (!match) return value;
  const code: Record<string, string> = {
    партия: "LOT",
    рейс: "WB",
    обработка: "PROC",
    операция: "OP",
  };
  return `${code[match[1].toLowerCase()]}-${match[2].replace(/^0+(?=\d)/, "").padStart(6, "0")}`;
}
