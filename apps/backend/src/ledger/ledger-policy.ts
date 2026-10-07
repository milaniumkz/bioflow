import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CurrentUser } from "../common/current-user.decorator";

export function mass(value: string, positive = true): Prisma.Decimal {
  if (!/^-?\d{1,11}(\.\d{1,3})?$/.test(value))
    throw new BadRequestException(
      "Масса должна быть указана в тоннах с точностью до 0,001 т",
    );
  const n = new Prisma.Decimal(value);
  if (positive ? n.lte(0) : n.lt(0))
    throw new BadRequestException("Недопустимая масса");
  return n;
}
export function net(gross: string, tare: string) {
  const result = mass(gross).minus(mass(tare, false));
  if (result.lte(0))
    throw new BadRequestException("Брутто должно быть больше тары");
  return result;
}
export function allowed(user: CurrentUser, warehouseId: string) {
  if (
    user.accessAllObjects !== true &&
    !(user.warehouseScopeIds ?? []).includes(warehouseId)
  )
    throw new ForbiddenException("Склад не назначен пользователю");
}
export function scopedBatch(user: CurrentUser): Prisma.MaterialBatchWhereInput {
  const where: Prisma.MaterialBatchWhereInput = {
    organizationId: user.organizationId,
  };
  if (user.accessAllObjects) return where;
  const restrictions: Prisma.MaterialBatchWhereInput[] = [];
  if (user.counterpartyScopeId)
    restrictions.push({
      originCounterpartyIds: { equals: [user.counterpartyScopeId] },
    });
  if (user.extractionScopeIds?.length)
    restrictions.push({
      originExtractionSiteIds: { hasSome: user.extractionScopeIds },
    });
  if (!restrictions.length)
    restrictions.push({
      stocks: { some: { warehouseId: { in: user.warehouseScopeIds ?? [] } } },
    });
  return { ...where, AND: restrictions };
}
export function operationPermission(kind: string) {
  if (["WASHING", "PRODUCTION"].includes(kind)) return "operations.manage";
  if (
    ["RESERVE", "RELEASE", "CORRECTION", "INVENTORY", "RETURN"].includes(kind)
  )
    return "inventory.manage";
  return "inventory.manage";
}
