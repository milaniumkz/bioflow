import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export function decimal(value: string | Prisma.Decimal): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function positiveWeight(value: string | Prisma.Decimal, field: string): Prisma.Decimal {
  const weight = decimal(value);
  if (weight.lte(0)) throw new BadRequestException(`${field} must be positive`);
  return weight;
}

export function classifyAcceptance(declaredWeight: string | Prisma.Decimal, actualWeight: string | Prisma.Decimal, thresholdPercent = 3) {
  const declared = positiveWeight(declaredWeight, "Declared weight");
  const actual = positiveWeight(actualWeight, "Actual weight");
  const difference = actual.minus(declared);
  const threshold = declared.mul(thresholdPercent).div(100);
  return {
    actual,
    difference,
    status: difference.abs().gt(threshold) ? "ACCEPTED_WITH_DIFFERENCE" : "ACCEPTED"
  } as const;
}

export function validateWashingFormula(input: string, output: string, waste: string, loss: string) {
  const inputWeight = positiveWeight(input, "Input weight");
  const outputWeight = positiveWeight(output, "Output weight");
  const wasteWeight = decimal(waste);
  const lossWeight = decimal(loss);
  if (wasteWeight.lt(0) || lossWeight.lt(0)) throw new BadRequestException("Waste and loss cannot be negative");
  if (!outputWeight.plus(wasteWeight).plus(lossWeight).equals(inputWeight)) {
    throw new BadRequestException("DIRTY must equal WASHED + waste + loss");
  }
  return { inputWeight, outputWeight, wasteWeight, lossWeight };
}

export function validateProductionFormula(input: string, output: string, waste: string, loss: string) {
  const inputWeight = positiveWeight(input, "Input weight");
  const outputWeight = positiveWeight(output, "Output weight");
  const wasteWeight = decimal(waste);
  const lossWeight = decimal(loss);
  if (wasteWeight.lt(0) || lossWeight.lt(0)) throw new BadRequestException("Waste and loss cannot be negative");
  if (outputWeight.plus(wasteWeight).plus(lossWeight).gt(inputWeight)) {
    throw new BadRequestException("Output, waste and loss cannot exceed input");
  }
  return { inputWeight, outputWeight, wasteWeight, lossWeight };
}
