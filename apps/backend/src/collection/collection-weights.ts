import { Prisma } from "@prisma/client";

/** Keep stored inventory unchanged and format all Collection messages in tonnes. */
export function displayTonnes(value: Prisma.Decimal.Value): string {
  return new Prisma.Decimal(value).div(1000).toString().replace(".", ",");
}
export function noticeInTonnes(body: string): string {
  return body.replace(
    /(\d+(?:[.,]\d+)?)\s+кг(?![\p{L}\p{N}_])/gu,
    (_, value: string) => `${displayTonnes(value.replace(",", "."))} т`,
  );
}
