// Search the stored document number using the same short Russian label shown in UI.
export function documentSearch(value: string) {
  const match = value
    .trim()
    .match(/^(партия|рейс|обработка|операция|доставка)\s*№?\s*(\d+)$/iu);
  if (!match) return value;
  const code: Record<string, string> = {
    доставка: "DEL",
    партия: "LOT",
    рейс: "WB",
    обработка: "PROC",
    операция: "OP",
  };
  return `${code[match[1].toLowerCase()]}-${match[2].replace(/^0+(?=\d)/, "").padStart(6, "0")}`;
}

export function documentLabel(value: string) {
  const names: Record<string, string> = {
    WB: "Рейс",
    LOT: "Партия",
    PROC: "Обработка",
    OP: "Операция",
    DEL: "Доставка",
  };
  return value.replace(
    /(?:[a-z0-9]{20,}-)?\b(WB|LOT|PROC|OP|DEL)-(\d+)\b/g,
    (_all, code, number) => `${names[code]} №${Number(number)}`,
  );
}
