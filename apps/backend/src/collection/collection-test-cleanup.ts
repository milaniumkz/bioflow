import {
  Body,
  ConflictException,
  Controller,
  Injectable,
  Post,
} from "@nestjs/common";
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from "class-validator";
import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { CollectionService } from "./collection.service";
import {
  CurrentUser,
  CurrentUser as User,
} from "../common/current-user.decorator";
class CleanupDto {
  @IsString() @MinLength(1) rootTripId!: string;
  @IsBoolean() dryRun!: boolean;
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  expectedPlanHash?: string;
}
const actors = [
  "collection-test-owner",
  "collection-test-collector",
  "collection-test-warehouse",
  "collection-test-factory",
];
@Injectable()
export class CollectionTestCleanupService {
  constructor(private readonly collection: CollectionService) {}
  async cleanup(dto: CleanupDto, user: CurrentUser) {
    this.collection.require(user);
    return this.collection.db.$transaction(
      async (tx) => {
        // Take the same location locks as stock operations, in a stable order.
        await tx.$queryRaw`SELECT id FROM "CollectionLocation" WHERE "organizationId"=${user.organizationId} ORDER BY id FOR UPDATE`;
        const where = { organizationId: user.organizationId };
        const [trips, batches, actions, shipments, factories, commands] =
          await Promise.all([
            tx.collectionTrip.findMany({ where, orderBy: { id: "asc" } }),
            tx.collectionBatch.findMany({ where, orderBy: { id: "asc" } }),
            tx.collectionAction.findMany({ where, orderBy: { id: "asc" } }),
            tx.collectionShipment.findMany({ where, orderBy: { id: "asc" } }),
            tx.collectionLocation.findMany({
              where: { ...where, kind: "FACTORY", name: "Тестовый завод" },
            }),
            tx.collectionCommand.findMany({ where, orderBy: { id: "asc" } }),
          ]);
        const root = trips.find((t) => t.id === dto.rootTripId);
        if (
          !root ||
          root.kind !== "RAW" ||
          !root.weightKg.eq(20000) ||
          root.createdById !== "collection-test-collector" ||
          factories.length !== 1
        )
          throw new ConflictException(
            "Тестовая цепочка не соответствует ожидаемой; удаление отменено",
          );
        const factory = factories[0];
        const operational = actions.filter((a) => a.kind !== "OPENING");
        const disposable = batches.filter((b) => b.sourceType !== "OPENING");
        if (
          trips.some(
            (t) =>
              !actors.includes(t.createdById) ||
              (t.id !== root.id &&
                (t.kind !== "GP" || t.fromLocationId !== factory.id)),
          ) ||
          operational.some((a) => !actors.includes(a.createdById)) ||
          disposable.some((b) => !actors.includes(b.createdById)) ||
          shipments.some(
            (s) =>
              !actors.includes(s.createdById) || s.toLocationId !== factory.id,
          )
        )
          throw new ConflictException(
            "Обнаружены операции вне тестовой цепочки; удаление отменено",
          );
        const ids = new Set([
          factory.id,
          ...trips.map((t) => t.id),
          ...disposable.map((b) => b.id),
          ...operational.map((a) => a.id),
          ...shipments.map((s) => s.id),
        ]);
        for (const batch of disposable)
          if (!ids.has(batch.sourceId))
            throw new ConflictException("Неизвестный источник партии");
        const restore = new Map<string, Prisma.Decimal>();
        for (const action of operational) {
          const details = action.details as {
            consumed?: { batchId: string; weightKg: string }[];
          };
          for (const consumed of details.consumed ?? []) {
            const batch = batches.find((b) => b.id === consumed.batchId);
            if (!batch)
              throw new ConflictException("Не найден источник расхода");
            if (batch.sourceType === "OPENING")
              restore.set(
                batch.id,
                (restore.get(batch.id) ?? new Prisma.Decimal(0)).plus(
                  consumed.weightKg,
                ),
              );
          }
        }
        const opening = batches.filter((b) => b.sourceType === "OPENING");
        if (
          opening.some(
            (b) =>
              b.createdById !== "SYSTEM_OPENING" ||
              !b.remainingKg.plus(restore.get(b.id) ?? 0).eq(b.totalKg),
          )
        )
          throw new ConflictException(
            "Начальные остатки содержат другие расходы; удаление отменено",
          );
        if (
          actions.some(
            (a) => a.kind === "OPENING" && a.createdById !== "SYSTEM_OPENING",
          )
        )
          throw new ConflictException("Неизвестный начальный остаток");
        const plan = {
          tripIds: trips.map((t) => t.id),
          batchIds: disposable.map((b) => b.id),
          actionIds: operational.map((a) => a.id),
          shipmentIds: shipments.map((s) => s.id),
          factoryId: factory.id,
          restore: [...restore].map(([id, kg]) => ({ id, kg: kg.toString() })),
          opening: opening.map((b) => ({
            id: b.id,
            totalKg: b.totalKg.toString(),
            remainingKg: b.remainingKg.toString(),
          })),
        };
        const planHash = createHash("sha256")
          .update(JSON.stringify(plan))
          .digest("hex");
        if (dto.dryRun) return { planHash, plan };
        if (dto.expectedPlanHash !== planHash)
          throw new ConflictException(
            "План изменился. Сначала получите новый предварительный просмотр",
          );
        const tripIds = plan.tripIds,
          batchIds = plan.batchIds;
        const sessions = await tx.collectionDriverSession.findMany({
          where: { tripId: { in: tripIds } },
          select: { id: true },
        });
        const sessionIds = sessions.map((s) => s.id);
        await tx.collectionDriverPoint.deleteMany({
          where: { sessionId: { in: sessionIds } },
        });
        await tx.collectionDriverEvent.deleteMany({
          where: { sessionId: { in: sessionIds } },
        });
        await tx.collectionDriverSession.deleteMany({
          where: { id: { in: sessionIds } },
        });
        await tx.collectionBag.deleteMany({
          where: { batchId: { in: batchIds } },
        });
        await tx.collectionBatch.deleteMany({
          where: { ...where, id: { in: batchIds } },
        });
        await tx.collectionTrip.deleteMany({
          where: { ...where, id: { in: tripIds } },
        });
        await tx.collectionShipment.deleteMany({
          where: { ...where, id: { in: plan.shipmentIds } },
        });
        await tx.collectionAction.deleteMany({
          where: { ...where, id: { in: plan.actionIds } },
        });
        for (const [id, kg] of restore)
          await tx.collectionBatch.update({
            where: { id },
            data: { remainingKg: { increment: kg } },
          });
        const notices = await tx.notification.findMany({
          where,
          select: { id: true },
        });
        const links = await tx.collectionNoticeLink.findMany({
          where: {
            notificationId: { in: notices.map((n) => n.id) },
            OR: [{ entityId: { in: [...ids] } }, { locationId: factory.id }],
          },
        });
        const noticeIds = links.map((n) => n.notificationId);
        await tx.pushDelivery.deleteMany({
          where: { notificationId: { in: noticeIds } },
        });
        await tx.collectionNoticeLink.deleteMany({
          where: { notificationId: { in: noticeIds } },
        });
        await tx.notification.deleteMany({
          where: { ...where, id: { in: noticeIds } },
        });
        const commandIds = commands
          .filter((c) =>
            [...ids].some((id) =>
              JSON.stringify(c.response).includes('"' + id + '"'),
            ),
          )
          .map((c) => c.id);
        await tx.collectionCommand.deleteMany({
          where: { ...where, id: { in: commandIds } },
        });
        await tx.collectionMembership.deleteMany({
          where: { locationId: factory.id },
        });
        await tx.collectionLocation.delete({ where: { id: factory.id } });
        await tx.auditLog.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            action: "collection.test.cleanup",
            entity: "CollectionTrip",
            entityId: root.id,
            reason:
              "Удаление тестовых 20 тонн и тестового завода по запросу владельца",
            newValue: JSON.parse(JSON.stringify({ planHash, ...plan })),
          },
        });
        return { deleted: true, planHash };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000,
      },
    );
  }
}
@Controller("collection/maintenance")
export class CollectionTestCleanupController {
  constructor(private readonly service: CollectionTestCleanupService) {}
  @Post("test-chain") cleanup(
    @Body() dto: CleanupDto,
    @User() user: CurrentUser,
  ) {
    return this.service.cleanup(dto, user);
  }
}
