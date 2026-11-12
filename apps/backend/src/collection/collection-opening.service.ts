import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CurrentUser } from "../common/current-user.decorator";
import { CollectionService, kg } from "./collection.service";
import { CollectionOpeningDto } from "./collection.dto";
import { displayTonnes } from "./collection-weights";
@Injectable()
export class CollectionOpeningService {
  constructor(private readonly collection: CollectionService) {}
  save(dto: CollectionOpeningDto, actor: CurrentUser) {
    this.collection.require(actor, ["FACTORY_MANAGER"]);
    const washed = new Prisma.Decimal(dto.washedKg);
    const finished = dto.finished.map((b) => kg(b.weightKg));
    const rejected = dto.rejected.map((b) => kg(b.weightKg));
    const sum = (values: Prisma.Decimal[]) =>
      values.reduce((a, b) => a.plus(b), new Prisma.Decimal(0));
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "factory.opening",
      dto,
      async (tx) => {
        await this.collection.location(tx, dto.locationId, actor, "FACTORY");
        const key = "collection.factory-opening." + dto.locationId;
        const where = {
          organizationId_key: { organizationId: actor.organizationId, key },
        };
        if (await tx.systemSetting.findUnique({ where }))
          throw new ConflictException(
            "Начальные остатки этого завода уже сохранены. Для исправления обратитесь к владельцу.",
          );
        const details = {
          washedKg: washed.toString(),
          finishedKg: sum(finished).toString(),
          rejectedKg: sum(rejected).toString(),
          finishedBags: finished.length,
          rejectedBags: rejected.length,
        };
        const total = washed.plus(sum(finished)).plus(sum(rejected));
        const action = await tx.collectionAction.create({
          data: {
            organizationId: actor.organizationId,
            locationId: dto.locationId,
            kind: "OPENING",
            quantityKg: total,
            createdById: actor.id,
            details,
          },
        });
        for (const [state, weights] of [
          ["WASHED", []],
          ["FINISHED", finished],
          ["REJECT", rejected],
        ] as const) {
          const quantity = state === "WASHED" ? washed : sum([...weights]);
          if (quantity.isZero()) continue;
          const batch = await tx.collectionBatch.create({
            data: {
              organizationId: actor.organizationId,
              locationId: dto.locationId,
              state,
              totalKg: quantity,
              remainingKg: quantity,
              bagCount: state === "WASHED" ? null : weights.length,
              bagWeights:
                state === "WASHED"
                  ? Prisma.DbNull
                  : weights.map((v) => v.toString()),
              sourceType: "OPENING",
              sourceId: action.id,
              createdById: actor.id,
            },
          });
          if (weights.length)
            await tx.collectionBag.createMany({
              data: weights.map((weightKg, i) => ({
                batchId: batch.id,
                index: i + 1,
                weightKg,
              })),
            });
        }
        const value = {
          id: action.id,
          locationId: dto.locationId,
          createdById: actor.id,
          savedAt: action.createdAt.toISOString(),
          ...details,
        };
        await tx.systemSetting.create({
          data: { organizationId: actor.organizationId, key, value },
        });
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.id,
            action: "collection.factory.opening",
            entity: "CollectionLocation",
            entityId: dto.locationId,
            reason: "Однократный ввод начальных остатков завода",
            newValue: value,
          },
        });
        await this.collection.notify(
          tx,
          actor.organizationId,
          await this.collection.managers(tx, dto.locationId),
          "Начальные остатки завода сохранены",
          `Мытое: ${displayTonnes(washed)} т; ГП: ${finished.length} бигбегов, ${displayTonnes(sum(finished))} т; некондиция: ${rejected.length} бигбегов, ${displayTonnes(sum(rejected))} т.`,
          "COLLECTION_OPENING",
          {
            section: "stock",
            entityId: dto.locationId,
            locationId: dto.locationId,
          },
        );
        return value;
      },
    );
  }
}
