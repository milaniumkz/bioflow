import { Prisma } from "@prisma/client";
export function lossPercent(input: Prisma.Decimal, output: Prisma.Decimal) {
  return input.minus(output).mul(100).div(input);
}
export function normDeviation(
  percent: Prisma.Decimal,
  min: number,
  max: number,
) {
  return percent.lt(min) ? "BELOW" : percent.gt(max) ? "ABOVE" : "NORMAL";
}
