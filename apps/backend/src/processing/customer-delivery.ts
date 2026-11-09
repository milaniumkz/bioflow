import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "../common/current-user.decorator";
import { scopedBatch } from "../ledger/ledger-policy";
export class CustomerDeliveryDto {
  @IsString() @MaxLength(100) sourceId!: string;
  @IsOptional() @IsString() @MaxLength(100) driverId?: string;
  @IsString() @MaxLength(500) destination!: string;
  @IsString() @MaxLength(1000) route!: string;
  @IsIn(["PLANNED", "IN_TRANSIT", "DELIVERED"]) status!: string;
  @IsInt() @Min(0) version!: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export function validDeliveryTransition(
  previous: string | undefined,
  next: string,
) {
  return previous === undefined
    ? next === "PLANNED"
    : previous === "PLANNED"
      ? ["PLANNED", "IN_TRANSIT"].includes(next)
      : previous === "IN_TRANSIT"
        ? ["IN_TRANSIT", "DELIVERED"].includes(next)
        : false;
}
@Injectable()
export class CustomerDeliveryService {
  constructor(private readonly prisma: PrismaService) {}
  async save(d: CustomerDeliveryDto, u: CurrentUser) {
    if (!d.destination.trim() || !d.route.trim())
      throw new BadRequestException("Укажите маршрут и адрес покупателя");
    return this.prisma
      .$transaction(async (tx) => {
        const source = await tx.bigBag.findFirst({
          where: {
            id: d.sourceId,
            soldAt: { not: null },
            batch: scopedBatch(u),
          },
        });
        const operation = source
          ? null
          : await tx.batchOperation.findFirst({
              where: {
                id: d.sourceId,
                organizationId: u.organizationId,
                kind: "SHIPMENT",
                status: "CONFIRMED",
                inputs: {
                  some: { batch: scopedBatch(u) },
                  every: { batch: scopedBatch(u) },
                },
              },
            });
        if (!source && !operation)
          throw new NotFoundException("Отпуск покупателю не найден");
        if (
          d.driverId &&
          !(await tx.driver.findFirst({
            where: { id: d.driverId, organizationId: u.organizationId },
          }))
        )
          throw new BadRequestException("Водитель не найден");
        if (d.status !== "PLANNED" && !d.driverId)
          throw new BadRequestException("Назначьте водителя перед отправкой");
        const old = await tx.customerDelivery.findUnique({
          where: {
            organizationId_sourceId: {
              organizationId: u.organizationId,
              sourceId: d.sourceId,
            },
          },
        });
        if ((old?.version ?? 0) !== d.version)
          throw new ConflictException("Доставка изменена. Обновите дашборд");
        if (!validDeliveryTransition(old?.status, d.status))
          throw new ConflictException(
            "Подтвердите план, отправку и вручение по порядку",
          );
        const data = {
          driverId: d.driverId || null,
          destination: d.destination.trim(),
          route: d.route.trim(),
          status: d.status,
        };
        let delivery;
        if (old) {
          const updated = await tx.customerDelivery.updateMany({
            where: { id: old.id, version: d.version },
            data: { ...data, version: { increment: 1 } },
          });
          if (updated.count !== 1)
            throw new ConflictException(
              "Доставка уже изменена другим сотрудником",
            );
          delivery = await tx.customerDelivery.findUniqueOrThrow({
            where: { id: old.id },
          });
        } else {
          delivery = await tx.customerDelivery.create({
            data: {
              ...data,
              organizationId: u.organizationId,
              sourceId: d.sourceId,
              createdById: u.id,
            },
          });
        }
        await tx.customerDeliveryEvent.create({
          data: {
            ...data,
            deliveryId: delivery.id,
            notes: d.notes,
            createdById: u.id,
          },
        });
        return delivery;
      })
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        )
          throw new ConflictException("Доставка уже создана. Обновите дашборд");
        throw error;
      });
  }
}
