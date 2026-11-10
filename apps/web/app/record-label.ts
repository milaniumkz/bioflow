// Keep stored numbers and QR payloads unchanged. Organization IDs are internal;
// the sequence is the number people need to read on cards and printed labels.
export function recordLabel(value: unknown): string {
  const text = String(value ?? "");
  const names: Record<string, string> = {
    DEL: "Доставка",
    LOT: "Партия",
    WB: "Рейс",
    PROC: "Обработка",
    OP: "Операция",
  };
  return text.replace(
    /(?:[a-z0-9]{20,}-)?\b(LOT|WB|PROC|OP|DEL)-(\d+)\b/g,
    (_all, kind, digits) => `${names[kind]} №${Number(digits)}`,
  );
}
export function qrLabel(row: Record<string, any>): string {
  const ordinal = row.ordinal ?? row.bigBag?.ordinal;
  return ordinal != null ? `Биг-бэг №${ordinal}` : recordLabel(row.number);
}
export function qrStageLabel(row: Record<string, any>) {
  return (
    (
      {
        DIRTY: "Сырьё",
        WASHED: "После мойки",
        FINISHED: "После завода",
      } as Record<string, string>
    )[row.state] ?? ""
  );
}
export async function printableQr(row: Record<string, any>) {
  const image = new Image();
  image.src = row.qrImage;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("Не удалось подготовить QR к печати");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 800, 800);
  ctx.fillStyle = "black";
  ctx.textAlign = "center";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText(qrLabel(row), 400, 50, 600);
  const source = row.sourceNumber
    ? recordLabel(row.sourceNumber)
    : row.ordinal != null
      ? recordLabel(row.number)
      : "";
  ctx.font = "24px sans-serif";
  ctx.fillText(source, 400, 91, 600);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 120, 115, 560, 560);
  ctx.font = "20px sans-serif";
  ctx.fillText(qrStageLabel(row), 400, 706, 600);
  ctx.font = "24px sans-serif";
  ctx.fillText(
    `${Number(row.initialQuantity ?? row.declaredWeight ?? 0).toLocaleString("ru-RU")} т`,
    400,
    748,
    600,
  );
  return canvas.toDataURL("image/png");
}
