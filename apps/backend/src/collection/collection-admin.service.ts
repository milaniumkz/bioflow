import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "crypto";
import * as argon2 from "argon2";
import { CurrentUser } from "../common/current-user.decorator";
import { PageDto } from "../common/page.dto";
import { CollectionService, kg } from "./collection.service";
import { displayTonnes } from "./collection-weights";
import {
  AdminBagStateDto,
  AdminBagsDto,
  AdminBlockDto,
  AdminCommandDto,
  AdminLocationDto,
  AdminNoticeDto,
  AdminPasswordDto,
  AdminSettingsDto,
  AdminStageDto,
  AdminStockDto,
  AdminTripDto,
  AdminUserDto,
} from "./collection-admin.dto";
type Tx = Prisma.TransactionClient;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const roles = [
  "OWNER",
  "ADMIN",
  "COLLECTOR",
  "WAREHOUSE_MANAGER",
  "FACTORY_MANAGER",
];
const safeUser = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  isBlocked: true,
  mustChangePassword: true,
  createdAt: true,
  userRoles: { select: { role: { select: { code: true, name: true } } } },
} as const;
@Injectable()
export class CollectionAdminService {
  constructor(private readonly collection: CollectionService) {}
  private audit(
    tx: Tx,
    actor: CurrentUser,
    action: string,
    entity: string,
    entityId: string,
    reason: string,
    oldValue: unknown,
    newValue: unknown,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.id,
        action: "collection.admin." + action,
        entity,
        entityId,
        reason,
        oldValue: oldValue == null ? Prisma.DbNull : json(oldValue),
        newValue: newValue == null ? Prisma.DbNull : json(newValue),
      },
    });
  }
  private async lockLocations(tx: Tx, actor: CurrentUser, ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))].sort();
    for (const id of unique) {
      const location = await tx.collectionLocation.findFirst({
        where: { id, organizationId: actor.organizationId },
      });
      if (!location) throw new NotFoundException("Объект не найден");
      await tx.$queryRaw`SELECT id FROM "CollectionLocation" WHERE id=${id} FOR UPDATE`;
    }
  }
  async state(actor: CurrentUser) {
    this.collection.require(actor);
    const where = { organizationId: actor.organizationId };
    const [
      business,
      users,
      locations,
      memberships,
      settings,
      notificationCount,
      failedPushes,
    ] = await Promise.all([
      this.collection.state(actor),
      this.collection.db.user.findMany({
        where,
        select: safeUser,
        orderBy: { createdAt: "desc" },
      }),
      this.collection.db.collectionLocation.findMany({
        where,
        orderBy: [{ kind: "desc" }, { name: "asc" }],
      }),
      this.collection.db.collectionMembership.findMany({
        where: { location: { organizationId: actor.organizationId } },
        select: { userId: true, locationId: true },
      }),
      this.collection.db.systemSetting.findUnique({
        where: {
          organizationId_key: {
            organizationId: actor.organizationId,
            key: "collection.registration.enabled",
          },
        },
      }),
      this.collection.db.notification.count({ where }),
      this.collection.db.$queryRaw<
        { count: bigint }[]
      >`SELECT COUNT(*) AS count FROM "PushDelivery" p JOIN "Notification" n ON n.id=p."notificationId" WHERE n."organizationId"=${actor.organizationId} AND p.status='FAILED'`,
    ]);
    return {
      ...business,
      users,
      locations,
      memberships,
      roles,
      settings: { registrationEnabled: settings?.value !== false },
      notificationCount,
      failedPushes: Number(failedPushes[0]?.count ?? 0),
    };
  }
  async operations(actor: CurrentUser, query: PageDto) {
    this.collection.require(actor);
    const search = query.search?.trim();
    const matchingSites = search
      ? await this.collection.db.collectionLocation.findMany({
          where: {
            organizationId: actor.organizationId,
            name: { contains: search, mode: "insensitive" },
          },
          select: { id: true },
        })
      : [];
    const matchingUsers = search
      ? await this.collection.db.user.findMany({
          where: {
            organizationId: actor.organizationId,
            fullName: { contains: search, mode: "insensitive" },
          },
          select: { id: true },
        })
      : [];
    const where: Prisma.CollectionActionWhereInput = {
      organizationId: actor.organizationId,
      ...(search
        ? {
            OR: [
              { id: { contains: search } },
              { kind: { contains: search, mode: "insensitive" } },
              { locationId: { in: matchingSites.map((l) => l.id) } },
              { createdById: { in: matchingUsers.map((u) => u.id) } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.collection.db.collectionAction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.collection.db.collectionAction.count({ where }),
    ]);
    const reversals = rows.length
      ? await this.collection.db.collectionAction.findMany({
          where: {
            organizationId: actor.organizationId,
            kind: "OPERATION_REVERSED",
            OR: rows.map((row) => ({
              details: { path: ["reversesActionId"], equals: row.id },
            })),
          },
          select: { details: true },
        })
      : [];
    const reversed = new Set(
      reversals.map(
        (r) => (r.details as { reversesActionId: string }).reversesActionId,
      ),
    );
    return {
      data: rows.map((row) => ({ ...row, reversed: reversed.has(row.id) })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async export(actor: CurrentUser) {
    const data = await this.state(actor);
    const actions = await this.collection.db.collectionAction.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: "desc" },
    });
    return {
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      ...data,
      actions,
    };
  }
  async history(actor: CurrentUser, query: PageDto) {
    this.collection.require(actor);
    const where = {
      organizationId: actor.organizationId,
      ...(query.search
        ? {
            OR: [
              {
                action: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
              {
                reason: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
              { entityId: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.collection.db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          userId: true,
          action: true,
          entity: true,
          entityId: true,
          reason: true,
          oldValue: true,
          newValue: true,
          createdAt: true,
        },
      }),
      this.collection.db.auditLog.count({ where }),
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }
  async notices(actor: CurrentUser, query: PageDto) {
    this.collection.require(actor);
    const where = {
      organizationId: actor.organizationId,
      ...(query.search
        ? {
            OR: [
              {
                title: { contains: query.search, mode: "insensitive" as const },
              },
              {
                body: { contains: query.search, mode: "insensitive" as const },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.collection.db.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.collection.db.notification.count({ where }),
    ]);
    const deliveries = await this.collection.db.pushDelivery.findMany({
      where: { notificationId: { in: data.map((n) => n.id) } },
      select: {
        id: true,
        notificationId: true,
        status: true,
        attempts: true,
        lastError: true,
        deliveredAt: true,
      },
    });
    return {
      data: data.map((n) => ({
        ...n,
        deliveries: deliveries.filter((d) => d.notificationId === n.id),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async saveUser(
    id: string | undefined,
    dto: AdminUserDto,
    actor: CurrentUser,
  ) {
    this.collection.require(actor);
    if (!roles.includes(dto.role))
      throw new BadRequestException("Неизвестная роль");
    if (!id && !dto.password) throw new BadRequestException("Укажите пароль");
    const passwordHash = dto.password
      ? await argon2.hash(dto.password)
      : undefined;
    try {
      return await this.collection.command(
        actor,
        dto.idempotencyKey,
        "admin.user.save",
        {
          id,
          ...dto,
          password: dto.password
            ? createHash("sha256").update(dto.password).digest("hex")
            : undefined,
        },
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.organizationId + ":admin-users"},0))`;
          const old = id
            ? await tx.user.findFirst({
                where: { id, organizationId: actor.organizationId },
                select: safeUser,
              })
            : null;
          if (id && !old) throw new NotFoundException("Пользователь не найден");
          if (
            (dto.role === "OWNER" ||
              old?.userRoles.some((r) => r.role.code === "OWNER")) &&
            !actor.roles?.includes("OWNER")
          )
            throw new ForbiddenException(
              "Управлять владельцами может только владелец",
            );
          if (id === actor.id && !["OWNER", "ADMIN"].includes(dto.role))
            throw new ConflictException(
              "Нельзя убрать у себя административный доступ",
            );
          const privileged = ["OWNER", "ADMIN"].includes(dto.role);
          const sites = [...new Set(dto.locationIds)];
          if (privileged && sites.length)
            throw new BadRequestException(
              "Владельцу и администратору доступны все объекты без отдельных назначений",
            );
          if (!privileged) {
            const kind =
              dto.role === "WAREHOUSE_MANAGER"
                ? "WAREHOUSE"
                : dto.role === "FACTORY_MANAGER"
                  ? "FACTORY"
                  : null;
            if ((!kind && sites.length) || (kind && !sites.length))
              throw new BadRequestException("Назначьте объекты согласно роли");
            if (
              kind &&
              (await tx.collectionLocation.count({
                where: {
                  id: { in: sites },
                  organizationId: actor.organizationId,
                  kind,
                },
              })) !== sites.length
            )
              throw new BadRequestException("Выбраны недоступные объекты");
          }
          const selected = await tx.role.findUniqueOrThrow({
            where: { code: dto.role },
          });
          const data = {
            fullName: dto.fullName,
            phone: dto.phone,
            ...(passwordHash
              ? { passwordHash, mustChangePassword: false }
              : {}),
            accessAllObjects: privileged,
          };
          const user = id
            ? await tx.user.update({ where: { id }, data, select: safeUser })
            : await tx.user.create({
                data: {
                  ...data,
                  passwordHash: passwordHash!,
                  organizationId: actor.organizationId,
                  mustChangePassword: false,
                },
                select: safeUser,
              });
          if (
            old?.userRoles.some((r) => r.role.code === "OWNER") &&
            dto.role !== "OWNER"
          ) {
            const other = await tx.user.count({
              where: {
                organizationId: actor.organizationId,
                id: { not: id },
                isBlocked: false,
                userRoles: { some: { role: { code: "OWNER" } } },
              },
            });
            if (!other)
              throw new ConflictException(
                "В системе должен остаться активный владелец",
              );
          }
          await tx.userRole.deleteMany({ where: { userId: user.id } });
          await tx.userRole.create({
            data: { userId: user.id, roleId: selected.id },
          });
          await tx.collectionMembership.deleteMany({
            where: { userId: user.id },
          });
          if (sites.length && !privileged)
            await tx.collectionMembership.createMany({
              data: sites.map((locationId) => ({
                userId: user.id,
                locationId,
              })),
            });
          if (
            old &&
            (passwordHash ||
              old.userRoles.some((r) => r.role.code !== dto.role))
          )
            await tx.refreshToken.updateMany({
              where: { userId: user.id, revokedAt: null },
              data: { revokedAt: new Date() },
            });
          const result = await tx.user.findUniqueOrThrow({
            where: { id: user.id },
            select: safeUser,
          });
          await this.audit(
            tx,
            actor,
            "user.save",
            "User",
            user.id,
            dto.reason,
            old,
            { ...result, locationIds: sites, passwordChanged: !!passwordHash },
          );
          await this.collection.notify(
            tx,
            actor.organizationId,
            [user.id],
            old ? "Изменена учётная запись" : "Создана учётная запись",
            `${dto.fullName}: роль и назначения сохранены. Пароль в уведомлениях не передаётся.`,
            "COLLECTION_ADMIN_USER",
          );
          return result;
        },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        throw new ConflictException("Номер телефона уже используется");
      throw e;
    }
  }
  async block(id: string, dto: AdminBlockDto, actor: CurrentUser) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.user.block",
      { id, ...dto },
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.organizationId + ":admin-users"},0))`;
        const target = await tx.user.findFirst({
          where: { id, organizationId: actor.organizationId },
          select: safeUser,
        });
        if (!target) throw new NotFoundException("Пользователь не найден");
        if (dto.blocked && id === actor.id)
          throw new ConflictException("Нельзя заблокировать себя");
        if (target.userRoles.some((r) => r.role.code === "OWNER")) {
          if (!actor.roles?.includes("OWNER"))
            throw new ForbiddenException(
              "Управлять владельцем может только владелец",
            );
          if (
            dto.blocked &&
            !(await tx.user.count({
              where: {
                organizationId: actor.organizationId,
                id: { not: id },
                isBlocked: false,
                userRoles: { some: { role: { code: "OWNER" } } },
              },
            }))
          )
            throw new ConflictException(
              "Нельзя заблокировать последнего владельца",
            );
        }
        await tx.user.update({
          where: { id },
          data: { isBlocked: dto.blocked },
        });
        if (dto.blocked) {
          await tx.refreshToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await tx.device.updateMany({
            where: { userId: id },
            data: { pushToken: null },
          });
        }
        await this.audit(
          tx,
          actor,
          "user.block",
          "User",
          id,
          dto.reason,
          { isBlocked: target.isBlocked },
          { isBlocked: dto.blocked },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          [],
          dto.blocked ? "Пользователь заблокирован" : "Доступ восстановлен",
          target.fullName,
          "COLLECTION_ADMIN_USER",
        );
        return { updated: true };
      },
    );
  }
  async password(id: string, dto: AdminPasswordDto, actor: CurrentUser) {
    this.collection.require(actor);
    const passwordHash = await argon2.hash(dto.password);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.user.password",
      {
        id,
        reason: dto.reason,
        passwordFingerprint: createHash("sha256")
          .update(dto.password)
          .digest("hex"),
      },
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.organizationId + ":admin-users"},0))`;
        const target = await tx.user.findFirst({
          where: { id, organizationId: actor.organizationId },
          select: safeUser,
        });
        if (!target) throw new NotFoundException("Пользователь не найден");
        if (
          target.userRoles.some((r) => r.role.code === "OWNER") &&
          !actor.roles?.includes("OWNER")
        )
          throw new ForbiddenException(
            "Управлять владельцем может только владелец",
          );
        await tx.user.update({
          where: { id },
          data: { passwordHash, mustChangePassword: false },
        });
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit(
          tx,
          actor,
          "user.password",
          "User",
          id,
          dto.reason,
          {},
          { passwordReset: true, sessionsRevoked: true },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          [id],
          "Пароль изменён администратором",
          "Войдите с новым паролем. Повторная смена не требуется.",
          "COLLECTION_ADMIN_PASSWORD",
        );
        return { updated: true };
      },
    );
  }
  async location(
    id: string | undefined,
    dto: AdminLocationDto,
    actor: CurrentUser,
  ) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.location.save",
      { id, ...dto },
      async (tx) => {
        const old = id
          ? await tx.collectionLocation.findFirst({
              where: { id, organizationId: actor.organizationId },
            })
          : null;
        if (id && !old) throw new NotFoundException("Объект не найден");
        if (old && old.kind !== dto.kind)
          throw new ConflictException(
            "Тип существующего объекта менять нельзя",
          );
        if (id) await this.lockLocations(tx, actor, [id]);
        const result = id
          ? await tx.collectionLocation.update({
              where: { id },
              data: { name: dto.name, active: dto.active },
            })
          : await tx.collectionLocation.create({
              data: {
                organizationId: actor.organizationId,
                code: dto.kind + "-" + randomUUID(),
                name: dto.name,
                kind: dto.kind,
                active: dto.active,
              },
            });
        await this.audit(
          tx,
          actor,
          "location.save",
          "CollectionLocation",
          result.id,
          dto.reason,
          old,
          result,
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          id ? await this.collection.managers(tx, id) : [],
          "Изменён объект",
          `${dto.name}: ${dto.active ? "активен" : "в архиве"}.`,
          "COLLECTION_ADMIN_LOCATION",
        );
        return result;
      },
    );
  }
  async stock(dto: AdminStockDto, actor: CurrentUser) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.stock.set",
      dto,
      async (tx) => {
        await this.lockLocations(tx, actor, [dto.locationId]);
        const location = await tx.collectionLocation.findUniqueOrThrow({
          where: { id: dto.locationId },
        });
        if (location.kind === "FACTORY" && dto.state === "RAW")
          throw new BadRequestException(
            "На заводе учитывается мытое сырьё, ГП и некондиция",
          );
        const sum = await tx.collectionBatch.aggregate({
          where: {
            organizationId: actor.organizationId,
            locationId: dto.locationId,
            state: dto.state,
            status: "ACTIVE",
          },
          _sum: { remainingKg: true },
        });
        const current = sum._sum.remainingKg ?? new Prisma.Decimal(0),
          target = new Prisma.Decimal(dto.targetKg);
        if (!current.eq(dto.expectedKg))
          throw new ConflictException(
            "Остаток уже изменился. Обновите данные и повторите",
          );
        const delta = target.minus(current);
        if (delta.isZero())
          throw new BadRequestException("Остаток не изменился");
        const consumed = delta.lt(0)
          ? await this.collection.consume(
              tx,
              actor,
              dto.locationId,
              dto.state,
              delta.negated(),
            )
          : [];
        const action = await tx.collectionAction.create({
          data: {
            organizationId: actor.organizationId,
            locationId: dto.locationId,
            kind: "STOCK_ADJUSTMENT",
            quantityKg: delta,
            createdById: actor.id,
            details: json({
              reason: dto.reason,
              previousKg: current,
              targetKg: target,
              consumed,
              state: dto.state,
            }),
          },
        });
        if (delta.gt(0))
          await tx.collectionBatch.create({
            data: {
              organizationId: actor.organizationId,
              locationId: dto.locationId,
              state: dto.state,
              totalKg: delta,
              remainingKg: delta,
              sourceType: "ADMIN_ADJUSTMENT",
              sourceId: action.id,
              createdById: actor.id,
            },
          });
        await this.audit(
          tx,
          actor,
          "stock.set",
          "CollectionLocation",
          dto.locationId,
          dto.reason,
          { state: dto.state, weightKg: current },
          { state: dto.state, weightKg: target, actionId: action.id },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          await this.collection.managers(tx, dto.locationId),
          "Администратор скорректировал остаток",
          `${location.name}: ${displayTonnes(current)} → ${displayTonnes(target)} т. ${dto.reason}`,
          "COLLECTION_ADMIN_STOCK",
          {
            section: "stock",
            entityId: dto.locationId,
            locationId: dto.locationId,
          },
        );
        return { actionId: action.id, weightKg: target };
      },
    );
  }
  async addBags(dto: AdminBagsDto, actor: CurrentUser) {
    this.collection.require(actor);
    if (!dto.bags.length) throw new BadRequestException("Добавьте бигбеги");
    const weights = dto.bags.map((b) => kg(b.weightKg)),
      total = weights.reduce((s, w) => s.plus(w), new Prisma.Decimal(0));
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.bags.add",
      dto,
      async (tx) => {
        await this.lockLocations(tx, actor, [dto.locationId]);
        const loc = await tx.collectionLocation.findUniqueOrThrow({
          where: { id: dto.locationId },
        });
        if (loc.kind !== "FACTORY")
          throw new BadRequestException(
            "ГП и некондиция учитываются на заводе",
          );
        const action = await tx.collectionAction.create({
          data: {
            organizationId: actor.organizationId,
            locationId: loc.id,
            kind: "BAGS_ADJUSTMENT",
            quantityKg: total,
            createdById: actor.id,
            details: json({ reason: dto.reason, state: dto.state, weights }),
          },
        });
        const batch = await tx.collectionBatch.create({
          data: {
            organizationId: actor.organizationId,
            locationId: loc.id,
            state: dto.state,
            totalKg: total,
            remainingKg: total,
            bagCount: weights.length,
            bagWeights: json(weights),
            sourceType: "ADMIN_ADJUSTMENT",
            sourceId: action.id,
            createdById: actor.id,
          },
        });
        await tx.collectionBag.createMany({
          data: weights.map((weightKg, index) => ({
            batchId: batch.id,
            index: index + 1,
            weightKg,
          })),
        });
        await this.audit(
          tx,
          actor,
          "bags.add",
          "CollectionBatch",
          batch.id,
          dto.reason,
          {},
          { state: dto.state, count: weights.length, weightKg: total },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          await this.collection.managers(tx, loc.id),
          "Добавлены бигбеги корректировкой",
          `${loc.name}: ${weights.length} бигбегов, ${displayTonnes(total)} т. ${dto.reason}`,
          "COLLECTION_ADMIN_STOCK",
        );
        return { batchId: batch.id };
      },
    );
  }
  async bag(id: string, dto: AdminBagStateDto, actor: CurrentUser) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.bag.state",
      { id, ...dto },
      async (tx) => {
        const bag = await tx.collectionBag.findFirst({
          where: { id, batch: { organizationId: actor.organizationId } },
          include: { batch: true },
        });
        if (!bag) throw new NotFoundException("Бигбег не найден");
        await this.lockLocations(tx, actor, [bag.batch.locationId]);
        const current = await tx.collectionBag.findUniqueOrThrow({
          where: { id },
          include: { batch: true },
        });
        if (
          current.batch.status !== "ACTIVE" ||
          current.tripId ||
          current.status !== (dto.available ? "WRITTEN_OFF" : "AVAILABLE")
        )
          throw new ConflictException("Бигбег уже перемещён или недоступен");
        const delta = dto.available
            ? current.weightKg
            : current.weightKg.negated(),
          remaining = current.batch.remainingKg.plus(delta);
        if (remaining.lt(0) || remaining.gt(current.batch.totalKg))
          throw new ConflictException("Не совпадает остаток партии");
        await tx.collectionBag.update({
          where: { id },
          data: { status: dto.available ? "AVAILABLE" : "WRITTEN_OFF" },
        });
        await tx.collectionBatch.update({
          where: { id: current.batchId },
          data: { remainingKg: remaining },
        });
        await tx.collectionAction.create({
          data: {
            organizationId: actor.organizationId,
            locationId: current.batch.locationId,
            kind: dto.available ? "BAG_RESTORE" : "BAG_WRITE_OFF",
            quantityKg: delta,
            createdById: actor.id,
            details: { bagId: id, reason: dto.reason },
          },
        });
        await this.audit(
          tx,
          actor,
          "bag.state",
          "CollectionBag",
          id,
          dto.reason,
          { status: current.status },
          { status: dto.available ? "AVAILABLE" : "WRITTEN_OFF" },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          await this.collection.managers(tx, current.batch.locationId),
          dto.available ? "Бигбег восстановлен" : "Бигбег списан",
          `${displayTonnes(current.weightKg)} т. ${dto.reason}`,
          "COLLECTION_ADMIN_STOCK",
        );
        return { updated: true };
      },
    );
  }
  private async lockTrip(tx: Tx, id: string, actor: CurrentUser) {
    const trip = await tx.collectionTrip.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!trip) throw new NotFoundException("Рейс не найден");
    await this.lockLocations(tx, actor, [
      trip.warehouseId ?? trip.fromLocationId ?? "",
    ]);
    await tx.$queryRaw`SELECT id FROM "CollectionDriverSession" WHERE "tripId"=${id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "CollectionTrip" WHERE id=${id} FOR UPDATE`;
    return tx.collectionTrip.findUniqueOrThrow({
      where: { id },
      include: { driver: true },
    });
  }
  async trip(id: string, dto: AdminTripDto, actor: CurrentUser) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.trip.save",
      { id, ...dto },
      async (tx) => {
        const old = await this.lockTrip(tx, id, actor);
        if (old.status === "CANCELLED")
          throw new ConflictException("Рейс отменён");
        if (
          old.kind === "GP" &&
          (dto.bagCount !== undefined || dto.warehouseId)
        )
          throw new BadRequestException(
            "Количество бигбегов ГП определяется выбранными бигбегами",
          );
        if (old.kind === "RAW" && (dto.recipientName || dto.recipientAddress))
          throw new BadRequestException("Получателем сырья является склад");
        if (dto.warehouseId && dto.warehouseId !== old.warehouseId) {
          if (old.status !== "CREATED" || old.driver)
            throw new ConflictException(
              "Склад можно поменять только до подключения водителя",
            );
          const site = await tx.collectionLocation.findFirst({
            where: {
              id: dto.warehouseId,
              organizationId: actor.organizationId,
              kind: "WAREHOUSE",
              active: true,
            },
          });
          if (!site)
            throw new BadRequestException("Выберите действующий склад");
        }
        const trip = await tx.collectionTrip.update({
          where: { id },
          data: {
            ...(dto.bagCount !== undefined ? { bagCount: dto.bagCount } : {}),
            ...(dto.warehouseId ? { warehouseId: dto.warehouseId } : {}),
            ...(dto.recipientName ? { recipientName: dto.recipientName } : {}),
            ...(dto.recipientAddress
              ? { recipientAddress: dto.recipientAddress }
              : {}),
          },
        });
        if (dto.bagCount !== undefined)
          await tx.collectionBatch.updateMany({
            where: {
              organizationId: actor.organizationId,
              sourceType: "TRIP",
              sourceId: id,
            },
            data: { bagCount: dto.bagCount },
          });
        if (dto.driverPlate || dto.driverPhone) {
          if (!old.driver)
            throw new ConflictException("Водитель ещё не подключён");
          await tx.collectionDriverSession.update({
            where: { id: old.driver.id },
            data: {
              ...(dto.driverPlate ? { driverPlate: dto.driverPlate } : {}),
              ...(dto.driverPhone ? { driverPhone: dto.driverPhone } : {}),
            },
          });
        }
        const { qrTokenHash: _, driver: __, ...before } = old;
        const { qrTokenHash: ___, ...after } = trip;
        await this.audit(
          tx,
          actor,
          "trip.save",
          "CollectionTrip",
          id,
          dto.reason,
          before,
          {
            ...after,
            driverPlate: dto.driverPlate,
            driverPhone: dto.driverPhone,
          },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          [
            trip.createdById,
            ...(await this.collection.managers(
              tx,
              trip.warehouseId ?? trip.fromLocationId!,
            )),
          ],
          "Администратор изменил рейс",
          `${trip.number}: ${dto.reason}`,
          "COLLECTION_ADMIN_TRIP",
          {
            section: trip.kind === "RAW" ? "inbound" : "gp",
            entityId: id,
            locationId: trip.warehouseId ?? trip.fromLocationId ?? undefined,
          },
        );
        return { updated: true };
      },
    );
  }
  async stage(id: string, dto: AdminStageDto, actor: CurrentUser) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.trip.stage",
      { id, ...dto },
      async (tx) => {
        const trip = await this.lockTrip(tx, id, actor);
        const order = [
          "CREATED",
          "LOADED",
          "IN_TRANSIT",
          "ARRIVED",
          "ACCEPTED",
        ];
        if (
          trip.status === "CANCELLED" ||
          order.indexOf(trip.status) >= order.indexOf(dto.status)
        )
          throw new ConflictException("Этап уже пройден или рейс отменён");
        const now = new Date();
        await tx.collectionTrip.update({
          where: { id },
          data: {
            status: dto.status,
            ...(!trip.loadedAt ? { loadedAt: now } : {}),
            ...(dto.status !== "LOADED" && !trip.departedAt
              ? { departedAt: now }
              : {}),
            ...(dto.status === "ARRIVED" ? { arrivedAt: now } : {}),
          },
        });
        if (dto.status === "ARRIVED") {
          if (trip.driver)
            await tx.collectionDriverSession.update({
              where: { id: trip.driver.id },
              data: {
                stoppedAt: now,
                tokenHash: createHash("sha256")
                  .update(randomBytes(32))
                  .digest("hex"),
              },
            });
          if (trip.kind === "RAW" && trip.warehouseId)
            await tx.collectionBatch.create({
              data: {
                organizationId: actor.organizationId,
                locationId: trip.warehouseId,
                state: "RAW",
                status: "PENDING",
                totalKg: trip.weightKg,
                remainingKg: 0,
                bagCount: trip.bagCount,
                sourceType: "TRIP",
                sourceId: id,
                createdById: trip.createdById,
              },
            });
          else if (trip.kind === "GP")
            await tx.collectionBag.updateMany({
              where: { tripId: id },
              data: { status: "DELIVERED" },
            });
        }
        await tx.collectionAction.create({
          data: {
            organizationId: actor.organizationId,
            locationId: trip.warehouseId ?? trip.fromLocationId!,
            kind: "ADMIN_TRIP_STAGE",
            quantityKg: 0,
            createdById: actor.id,
            details: {
              tripId: id,
              previousStatus: trip.status,
              status: dto.status,
              reason: dto.reason,
            },
          },
        });
        await this.audit(
          tx,
          actor,
          "trip.stage",
          "CollectionTrip",
          id,
          dto.reason,
          { status: trip.status },
          { status: dto.status },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          [
            trip.createdById,
            ...(await this.collection.managers(
              tx,
              trip.warehouseId ?? trip.fromLocationId!,
            )),
          ],
          dto.status === "ARRIVED"
            ? "Администратор отметил прибытие"
            : "Администратор изменил этап рейса",
          `${trip.number}: ${trip.bagCount} мешков/бигбегов, ${displayTonnes(trip.weightKg)} т. ${dto.reason}`,
          "COLLECTION_ADMIN_TRIP",
          {
            section: trip.kind === "RAW" ? "inbound" : "gp",
            entityId: id,
            locationId: trip.warehouseId ?? trip.fromLocationId ?? undefined,
          },
        );
        return { updated: true };
      },
    );
  }
  async stopDriver(id: string, dto: AdminCommandDto, actor: CurrentUser) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.driver.stop",
      { id, ...dto },
      async (tx) => {
        const trip = await this.lockTrip(tx, id, actor);
        if (!trip.driver)
          throw new BadRequestException("Водитель ещё не подключён");
        await tx.collectionDriverSession.update({
          where: { id: trip.driver.id },
          data: {
            stoppedAt: new Date(),
            tokenHash: createHash("sha256")
              .update(randomBytes(32))
              .digest("hex"),
          },
        });
        await this.audit(
          tx,
          actor,
          "driver.stop",
          "CollectionTrip",
          id,
          dto.reason,
          { stopped: !!trip.driver.stoppedAt },
          { stopped: true },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          [trip.createdById],
          "Отслеживание остановлено администратором",
          `${trip.number}: ${dto.reason}`,
          "COLLECTION_ADMIN_DRIVER",
        );
        return { stopped: true };
      },
    );
  }
  async cancelTrip(id: string, dto: AdminCommandDto, actor: CurrentUser) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.trip.cancel",
      { id, ...dto },
      async (tx) => {
        const trip = await this.lockTrip(tx, id, actor);
        if (trip.status === "CANCELLED")
          throw new ConflictException("Рейс уже отменён");
        const locationId = trip.warehouseId ?? trip.fromLocationId!;
        if (trip.kind === "RAW") {
          const batch = await tx.collectionBatch.findFirst({
            where: {
              organizationId: actor.organizationId,
              sourceType: "TRIP",
              sourceId: id,
            },
          });
          if (batch) {
            if (
              batch.status === "ACTIVE" &&
              !batch.remainingKg.eq(batch.totalKg)
            )
              throw new ConflictException(
                "Сырьё уже использовано. Сначала отмените связанные операции",
              );
            await tx.collectionBatch.update({
              where: { id: batch.id },
              data: { status: "CANCELLED", remainingKg: 0 },
            });
          }
        } else {
          const bags = await tx.collectionBag.findMany({
            where: {
              tripId: id,
              batch: { organizationId: actor.organizationId },
            },
            include: { batch: true },
          });
          if (
            bags.length !== trip.bagCount ||
            bags.some(
              (b) =>
                !["IN_TRANSIT", "DELIVERED"].includes(b.status) ||
                b.batch.status !== "ACTIVE",
            )
          )
            throw new ConflictException("Состав доставки уже изменён");
          for (const bag of bags) {
            const batchNow = await tx.collectionBatch.findUniqueOrThrow({
              where: { id: bag.batchId },
            });
            if (batchNow.remainingKg.plus(bag.weightKg).gt(batchNow.totalKg))
              throw new ConflictException("Остаток партии не совпадает");
            await tx.collectionBag.update({
              where: { id: bag.id },
              data: { status: "AVAILABLE", tripId: null },
            });
            await tx.collectionBatch.update({
              where: { id: bag.batchId },
              data: { remainingKg: { increment: bag.weightKg } },
            });
          }
        }
        await tx.collectionTrip.update({
          where: { id },
          data: { status: "CANCELLED" },
        });
        if (trip.driver)
          await tx.collectionDriverSession.update({
            where: { id: trip.driver.id },
            data: {
              stoppedAt: new Date(),
              tokenHash: createHash("sha256")
                .update(randomBytes(32))
                .digest("hex"),
            },
          });
        await tx.collectionAction.create({
          data: {
            organizationId: actor.organizationId,
            locationId,
            kind: "TRIP_CANCELLED",
            quantityKg:
              trip.kind === "GP"
                ? trip.weightKg
                : trip.status === "ACCEPTED"
                  ? trip.weightKg.negated()
                  : new Prisma.Decimal(0),
            createdById: actor.id,
            details: {
              tripId: id,
              reason: dto.reason,
              previousStatus: trip.status,
            },
          },
        });
        await this.audit(
          tx,
          actor,
          "trip.cancel",
          "CollectionTrip",
          id,
          dto.reason,
          { status: trip.status },
          { status: "CANCELLED" },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          [
            trip.createdById,
            ...(await this.collection.managers(tx, locationId)),
          ],
          "Рейс отменён администратором",
          `${trip.number}: ${dto.reason}`,
          "COLLECTION_ADMIN_TRIP",
          {
            section: trip.kind === "RAW" ? "inbound" : "gp",
            entityId: id,
            locationId,
          },
        );
        return { cancelled: true };
      },
    );
  }
  private async restoreConsumed(
    tx: Tx,
    actor: CurrentUser,
    items: { batchId: string; weightKg: string }[],
  ) {
    for (const item of items) {
      const batch = await tx.collectionBatch.findFirst({
        where: {
          id: item.batchId,
          organizationId: actor.organizationId,
          status: "ACTIVE",
        },
      });
      if (!batch) throw new ConflictException("Исходная партия недоступна");
      const amount = kg(item.weightKg),
        remaining = batch.remainingKg.plus(amount);
      if (remaining.gt(batch.totalKg))
        throw new ConflictException("Операция уже возвращена в остаток");
      await tx.collectionBatch.update({
        where: { id: batch.id },
        data: { remainingKg: remaining },
      });
    }
  }
  async cancelShipment(id: string, dto: AdminCommandDto, actor: CurrentUser) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.shipment.cancel",
      { id, ...dto },
      async (tx) => {
        const initial = await tx.collectionShipment.findFirst({
          where: { id, organizationId: actor.organizationId },
        });
        if (!initial) throw new NotFoundException("Отправка не найдена");
        await this.lockLocations(tx, actor, [
          initial.fromLocationId,
          initial.toLocationId,
        ]);
        await tx.$queryRaw`SELECT id FROM "CollectionShipment" WHERE id=${id} FOR UPDATE`;
        const shipment = await tx.collectionShipment.findUniqueOrThrow({
          where: { id },
        });
        if (shipment.status === "CANCELLED")
          throw new ConflictException("Отправка уже отменена");
        const receipt = await tx.collectionBatch.findFirst({
          where: {
            organizationId: actor.organizationId,
            sourceType: "SHIPMENT",
            sourceId: id,
          },
        });
        if (receipt) {
          if (
            receipt.status !== "ACTIVE" ||
            !receipt.remainingKg.eq(receipt.totalKg)
          )
            throw new ConflictException(
              "Сырьё на заводе уже использовано. Сначала отмените производство",
            );
          await tx.collectionBatch.update({
            where: { id: receipt.id },
            data: { status: "CANCELLED", remainingKg: 0 },
          });
        }
        const action = await tx.collectionAction.findFirst({
          where: {
            organizationId: actor.organizationId,
            kind: "FACTORY_SHIPMENT",
            details: { path: ["shipmentId"], equals: id },
          },
        });
        const details = action?.details as
          { consumed?: { batchId: string; weightKg: string }[] } | undefined;
        if (!details?.consumed?.length)
          throw new ConflictException("Не найдены исходные партии отправки");
        await this.restoreConsumed(tx, actor, details.consumed);
        await tx.collectionShipment.update({
          where: { id },
          data: { status: "CANCELLED" },
        });
        await tx.collectionAction.create({
          data: {
            organizationId: actor.organizationId,
            locationId: shipment.fromLocationId,
            kind: "SHIPMENT_CANCELLED",
            quantityKg: shipment.weightKg,
            createdById: actor.id,
            details: { shipmentId: id, reason: dto.reason },
          },
        });
        await this.audit(
          tx,
          actor,
          "shipment.cancel",
          "CollectionShipment",
          id,
          dto.reason,
          { status: shipment.status },
          { status: "CANCELLED" },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          [
            shipment.createdById,
            ...(await this.collection.managers(tx, shipment.fromLocationId)),
            ...(await this.collection.managers(tx, shipment.toLocationId)),
          ],
          "Отправка на завод отменена",
          `${shipment.number}: ${displayTonnes(shipment.weightKg)} т возвращено складу. ${dto.reason}`,
          "COLLECTION_ADMIN_SHIPMENT",
        );
        return { cancelled: true };
      },
    );
  }
  async reverse(id: string, dto: AdminCommandDto, actor: CurrentUser) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.operation.reverse",
      { id, ...dto },
      async (tx) => {
        const action = await tx.collectionAction.findFirst({
          where: {
            id,
            organizationId: actor.organizationId,
            kind: {
              in: ["WASH", "PRODUCTION", "STOCK_ADJUSTMENT", "BAGS_ADJUSTMENT"],
            },
          },
        });
        if (!action)
          throw new BadRequestException(
            "Эта операция отменяется через соответствующий документ",
          );
        await this.lockLocations(tx, actor, [action.locationId]);
        if (
          await tx.collectionAction.findFirst({
            where: {
              organizationId: actor.organizationId,
              kind: "OPERATION_REVERSED",
              details: { path: ["reversesActionId"], equals: id },
            },
          })
        )
          throw new ConflictException("Операция уже отменена");
        const outputs = await tx.collectionBatch.findMany({
          where: {
            organizationId: actor.organizationId,
            sourceId: id,
            sourceType: { in: ["WASH", "PRODUCTION", "ADMIN_ADJUSTMENT"] },
          },
        });
        for (const batch of outputs) {
          if (batch.status !== "ACTIVE" || !batch.remainingKg.eq(batch.totalKg))
            throw new ConflictException(
              "Результат операции уже использован. Сначала отмените последующие отправки или производство",
            );
          const bags = await tx.collectionBag.findMany({
            where: { batchId: batch.id },
          });
          if (bags.some((b) => b.status !== "AVAILABLE" || b.tripId))
            throw new ConflictException("Некоторые бигбеги уже перемещены");
          await tx.collectionBatch.update({
            where: { id: batch.id },
            data: { status: "CANCELLED", remainingKg: 0 },
          });
          await tx.collectionBag.updateMany({
            where: { batchId: batch.id },
            data: { status: "CANCELLED" },
          });
        }
        const details = action.details as {
          consumed?: { batchId: string; weightKg: string }[];
        };
        await this.restoreConsumed(tx, actor, details.consumed ?? []);
        const reversal = await tx.collectionAction.create({
          data: {
            organizationId: actor.organizationId,
            locationId: action.locationId,
            kind: "OPERATION_REVERSED",
            quantityKg: action.quantityKg.negated(),
            createdById: actor.id,
            details: {
              reversesActionId: id,
              reason: dto.reason,
              originalKind: action.kind,
            },
          },
        });
        await this.audit(
          tx,
          actor,
          "operation.reverse",
          "CollectionAction",
          id,
          dto.reason,
          { kind: action.kind, quantityKg: action.quantityKg },
          { reversalId: reversal.id },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          await this.collection.managers(tx, action.locationId),
          "Операция отменена администратором",
          `${displayTonnes(action.quantityKg.abs())} т. ${dto.reason}`,
          "COLLECTION_ADMIN_REVERSAL",
          {
            section: "stock",
            entityId: action.locationId,
            locationId: action.locationId,
          },
        );
        return { reversed: true, reversalId: reversal.id };
      },
    );
  }
  async retryNotice(id: string, dto: AdminCommandDto, actor: CurrentUser) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.notification.retry",
      { id, ...dto },
      async (tx) => {
        const notice = await tx.notification.findFirst({
          where: { id, organizationId: actor.organizationId },
        });
        if (!notice) throw new NotFoundException("Уведомление не найдено");
        const result = await tx.pushDelivery.updateMany({
          where: { notificationId: id, status: "FAILED" },
          data: { status: "PENDING", attempts: 0, lastError: null },
        });
        await this.audit(
          tx,
          actor,
          "notification.retry",
          "Notification",
          id,
          dto.reason,
          {},
          { requeued: result.count },
        );
        return { requeued: result.count };
      },
    );
  }
  async sendNotice(dto: AdminNoticeDto, actor: CurrentUser) {
    this.collection.require(actor);
    if (dto.target !== "ALL" && !dto.targetId)
      throw new BadRequestException("Выберите получателя");
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.notification.send",
      dto,
      async (tx) => {
        let ids: string[] | undefined;
        if (dto.target === "LOCATION") {
          if (
            !(await tx.collectionLocation.findFirst({
              where: { id: dto.targetId, organizationId: actor.organizationId },
            }))
          )
            throw new BadRequestException("Выберите объект");
          ids = (
            await tx.collectionMembership.findMany({
              where: { locationId: dto.targetId },
              select: { userId: true },
            })
          ).map((m) => m.userId);
        } else if (dto.target === "USER") ids = [dto.targetId ?? ""];
        if (dto.target === "ROLE" && !roles.includes(dto.targetId ?? ""))
          throw new BadRequestException("Выберите роль");
        const recipients = await tx.user.findMany({
          where: {
            organizationId: actor.organizationId,
            isBlocked: false,
            ...(ids ? { id: { in: ids } } : {}),
            ...(dto.target === "ROLE"
              ? { userRoles: { some: { role: { code: dto.targetId } } } }
              : {}),
          },
          select: { id: true },
        });
        if (!recipients.length)
          throw new BadRequestException("Нет получателей");
        await this.collection.notify(
          tx,
          actor.organizationId,
          recipients.map((r) => r.id),
          dto.title,
          dto.body,
          "COLLECTION_ADMIN_MESSAGE",
        );
        await this.audit(
          tx,
          actor,
          "notification.send",
          "Notification",
          randomUUID(),
          dto.reason,
          {},
          {
            title: dto.title,
            body: dto.body,
            recipients: recipients.map((r) => r.id),
          },
        );
        return { sent: recipients.length };
      },
    );
  }
  async settings(dto: AdminSettingsDto, actor: CurrentUser) {
    this.collection.require(actor);
    return this.collection.command(
      actor,
      dto.idempotencyKey,
      "admin.settings",
      dto,
      async (tx) => {
        const key = "collection.registration.enabled";
        const old = await tx.systemSetting.findUnique({
          where: {
            organizationId_key: { organizationId: actor.organizationId, key },
          },
        });
        await tx.systemSetting.upsert({
          where: {
            organizationId_key: { organizationId: actor.organizationId, key },
          },
          update: { value: dto.registrationEnabled },
          create: {
            organizationId: actor.organizationId,
            key,
            value: dto.registrationEnabled,
          },
        });
        await this.audit(
          tx,
          actor,
          "settings",
          "SystemSetting",
          key,
          dto.reason,
          { registrationEnabled: old?.value !== false },
          { registrationEnabled: dto.registrationEnabled },
        );
        await this.collection.notify(
          tx,
          actor.organizationId,
          [],
          "Изменены настройки регистрации",
          dto.registrationEnabled
            ? "Самостоятельная регистрация открыта."
            : "Самостоятельная регистрация закрыта.",
          "COLLECTION_ADMIN_SETTINGS",
        );
        return { updated: true };
      },
    );
  }
}
