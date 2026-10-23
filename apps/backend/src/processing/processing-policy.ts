import { Prisma } from "@prisma/client";
export function lossPercent(input: Prisma.Decimal, output: Prisma.Decimal) {
  if (!input.isFinite() || input.lte(0) || !output.isFinite() || output.lt(0))
    throw new RangeError(
      "Для процента нужна положительная база и неотрицательный выход",
    );
  return input.minus(output).mul(100).div(input);
}
export function normDeviation(
  percent: Prisma.Decimal,
  min: number,
  max: number,
) {
  return percent.lt(min) ? "BELOW" : percent.gt(max) ? "ABOVE" : "NORMAL";
}
