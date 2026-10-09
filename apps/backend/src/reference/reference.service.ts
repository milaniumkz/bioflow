import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { orderBy, PageDto } from "../common/page.dto";
import { CurrentUser } from "../common/current-user.decorator";
import { CreateUserDto, UpsertSettingDto } from "./reference.dto";

const ENTITY_MODEL: Record<string, string> = {
  "reference-values": "referenceValue",
  counterparties: "counterparty",
  vehicles: "vehicle",
  drivers: "driver",
  "extraction-sites": "extractionSite",
  warehouses: "warehouse",
  plants: "plant",
  "material-types": "materialType",
  "product-types": "productType",
  users: "user",
  roles: "role",
  permissions: "permission",
  settings: "systemSetting",
};

const SEARCH_FIELDS: Record<string, string[]> = {
  "reference-values": ["name", "code", "category"],
  counterparties: ["name", "bin", "phone", "email"],
  vehicles: ["plateNumber", "brand", "type"],
  drivers: ["fullName", "phone"],
  "extraction-sites": ["name", "location"],
  warehouses: ["name", "address"],
  plants: ["name", "address"],
  "material-types": ["name"],
  "product-types": ["name"],
  users: ["fullName", "email", "phone"],
  roles: ["code", "name"],
  permissions: ["code", "name"],
  settings: ["key"],
};

const SORT_FIELDS: Record<string, string[]> = {
  "reference-values": ["category", "name", "code"],
  counterparties: ["createdAt", "name", "status"],
  vehicles: ["plateNumber", "brand", "type", "status"],
  drivers: ["fullName", "phone"],
  "extraction-sites": ["name", "location"],
  warehouses: ["name", "address"],
  plants: ["name", "address"],
  "material-types": ["name"],
  "product-types": ["name"],
  users: ["createdAt", "fullName", "email", "phone"],
  roles: ["code", "name"],
  permissions: ["code", "name"],
  settings: ["key"],
};

@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(entity: string, query: PageDto, user: CurrentUser) {
    if (entity === "users" && !user.permissions.includes("users.manage"))
      throw new ForbiddenException(
        "Недостаточно прав управления пользователями",
      );
    if (
      entity === "settings" &&
      !user.permissions.includes("references.manage")
    )
      throw new ForbiddenException("Недостаточно прав управления настройками");
    const model = this.model(entity);
    const where = this.orgWhere(entity, user.organizationId, query.search);
    if (!user.accessAllObjects && user.accessAllObjects !== undefined) {
      if (entity === "warehouses")
        where.id = { in: user.warehouseScopeIds ?? [] };
      else if (entity === "extraction-sites")
        where.id = { in: user.extractionScopeIds ?? [] };
      else if (entity === "counterparties")
        where.id = {
          in: user.counterpartyScopeId ? [user.counterpartyScopeId] : [],
        };
      else if (["vehicles", "drivers"].includes(entity))
        where.counterpartyId = user.counterpartyScopeId ?? "__none__";
      else if (
        !["material-types", "product-types", "reference-values"].includes(
          entity,
        )
      )
        throw new NotFoundException("Справочник недоступен");
    }
    const [data, total] = await this.prisma.$transaction([
      model.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: this.referenceOrderBy(entity, query),
      }),
      model.count({ where }),
    ]);
    if (entity === "users")
      for (const item of data) {
        delete item.passwordHash;
      }
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  async create(
    entity: string,
    data: Record<string, unknown>,
    user: CurrentUser,
  ) {
    const model = this.model(entity);
    const required =
      entity === "vehicles"
        ? ["plateNumber", "brand", "type"]
        : entity === "drivers"
          ? ["fullName"]
          : entity === "reference-values"
            ? ["category", "code", "name"]
            : ["name"];
    for (const field of required) {
      if (typeof data[field] !== "string" || !String(data[field]).trim())
        throw new BadRequestException(`Заполните обязательное поле: ${field}`);
    }
    await this.validateLinks(data, user.organizationId);
    const payload = this.withOrg(
      entity,
      this.sanitizeReferenceData(entity, data),
      user.organizationId,
    );
    const created: any = await this.writeWithConflict(() =>
      model.create({ data: payload }),
    );
    await this.audit(user, "create", entity, created.id, null, created);
    return created;
  }

  async createUser(dto: CreateUserDto, user: CurrentUser) {
    if (!dto.email && !dto.phone)
      throw new BadRequestException("Email or phone is required");
    const passwordHash = await argon2.hash(dto.temporaryPassword);
    const created = await this.writeWithConflict(() =>
      this.prisma.user.create({
        data: {
          organizationId: user.organizationId,
          email: dto.email,
          phone: dto.phone,
          fullName: dto.fullName,
          passwordHash,
          mustChangePassword: true,
        },
      }),
    );
    await this.audit(user, "create", "users", created.id, null, {
      ...created,
      passwordHash: "[masked]",
    });
    return { ...created, passwordHash: undefined };
  }

  async assignRoles(userId: string, roleCodes: string[], actor: CurrentUser) {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
    });
    if (!target) throw new NotFoundException("User not found");
    const roles = await this.prisma.role.findMany({
      where: { code: { in: roleCodes } },
    });
    if (roles.length !== roleCodes.length)
      throw new BadRequestException("One or more roles do not exist");
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      ...roles.map((role) =>
        this.prisma.userRole.create({ data: { userId, roleId: role.id } }),
      ),
      this.prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: "users.assign-roles",
          entity: "User",
          entityId: userId,
          newValue: { roleCodes },
        },
      }),
    ]);
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        userRoles: { include: { role: true } },
      },
    });
  }

  async setUserBlocked(
    userId: string,
    blocked: boolean,
    reason: string,
    actor: CurrentUser,
  ) {
    if (!reason) throw new BadRequestException("Reason is required");
    const target = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
    });
    if (!target) throw new NotFoundException("User not found");
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: userId },
        data: { isBlocked: blocked },
      });
      if (blocked)
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: blocked ? "users.block" : "users.unblock",
          entity: "User",
          entityId: userId,
          oldValue: { isBlocked: target.isBlocked },
          newValue: { isBlocked: blocked },
          reason,
        },
      });
      return next;
    });
    return { ...updated, passwordHash: undefined };
  }

  async upsertSetting(dto: UpsertSettingDto, user: CurrentUser) {
    if (dto.value === undefined || dto.value === null)
      throw new BadRequestException("Укажите значение настройки");
    if (
      dto.key === "acceptance.differenceThresholdPercent" &&
      (typeof dto.value !== "number" ||
        !Number.isFinite(dto.value) ||
        dto.value < 0 ||
        dto.value > 100)
    )
      throw new BadRequestException(
        "Порог расхождения должен быть от 0 до 100 процентов",
      );
    const existing = await this.prisma.systemSetting.findUnique({
      where: {
        organizationId_key: {
          organizationId: user.organizationId,
          key: dto.key,
        },
      },
    });
    const setting = await this.prisma.systemSetting.upsert({
      where: {
        organizationId_key: {
          organizationId: user.organizationId,
          key: dto.key,
        },
      },
      update: { value: dto.value as any },
      create: {
        organizationId: user.organizationId,
        key: dto.key,
        value: dto.value as any,
      },
    });
    await this.audit(
      user,
      "upsert",
      "settings",
      setting.id,
      existing,
      setting,
      dto.reason,
    );
    return setting;
  }

  async update(
    entity: string,
    id: string,
    data: Record<string, unknown>,
    reason: string | undefined,
    user: CurrentUser,
  ) {
    const model = this.model(entity);
    const existing = await model.findFirst({
      where: { id, ...this.orgScope(entity, user.organizationId) },
    });
    if (!existing) throw new NotFoundException();
    await this.validateLinks(data, user.organizationId);
    const updated: any = await this.writeWithConflict(() =>
      model.update({
        where: { id },
        data: this.sanitizeReferenceData(entity, data),
      }),
    );
    await this.audit(user, "update", entity, id, existing, updated, reason);
    return updated;
  }

  private model(entity: string): any {
    const modelName = ENTITY_MODEL[entity];
    const model = (this.prisma as any)[modelName];
    if (!model)
      throw new BadRequestException(`Unknown reference entity: ${entity}`);
    return model;
  }

  private orgScope(entity: string, organizationId: string) {
    return ["roles", "permissions", "material-types", "product-types"].includes(
      entity,
    )
      ? {}
      : { organizationId };
  }

  private orgWhere(entity: string, organizationId: string, search?: string) {
    const where: any = this.orgScope(entity, organizationId);
    const fields = SEARCH_FIELDS[entity] ?? [];
    if (search && fields.length > 0) {
      where.OR = fields.map((field) => ({
        [field]: { contains: search, mode: "insensitive" },
      }));
    }
    return where;
  }

  private referenceOrderBy(entity: string, query: PageDto) {
    const allowed = SORT_FIELDS[entity] ?? ["id"];
    return orderBy(query, allowed, allowed[0] ?? "id");
  }

  private withOrg(
    entity: string,
    data: Record<string, unknown>,
    organizationId: string,
  ) {
    return { ...data, ...this.orgScope(entity, organizationId) };
  }

  private sanitizeReferenceData(entity: string, data: Record<string, unknown>) {
    const fields: Record<string, string[]> = {
      "reference-values": ["category", "code", "name", "archivedAt"],
      counterparties: ["name", "bin", "phone", "email", "status"],
      vehicles: [
        "plateNumber",
        "brand",
        "type",
        "model",
        "capacity",
        "tareWeight",
        "counterpartyId",
        "status",
      ],
      drivers: ["fullName", "phone", "counterpartyId"],
      "extraction-sites": ["name", "location"],
      warehouses: [
        "name",
        "address",
        "lowStockLimit",
        "capacity",
        "warehouseType",
        "allowedMaterialTypeIds",
      ],
      plants: ["name", "address"],
      "material-types": ["name"],
      "product-types": ["name"],
    };
    if (!fields[entity])
      throw new BadRequestException(
        "Используйте специализированный маршрут управления пользователями, ролями и настройками",
      );
    const unknown = Object.keys(data).filter(
      (k) => !fields[entity].includes(k),
    );
    if (unknown.length)
      throw new BadRequestException(`Недопустимые поля: ${unknown.join(", ")}`);
    return data;
  }

  private async validateLinks(
    data: Record<string, unknown>,
    organizationId: string,
  ) {
    if (
      data.counterpartyId &&
      !(await this.prisma.counterparty.findFirst({
        where: { id: String(data.counterpartyId), organizationId },
      }))
    )
      throw new BadRequestException("Контрагент недоступен");
    for (const field of ["capacity", "tareWeight", "lowStockLimit"]) {
      if (
        data[field] !== undefined &&
        data[field] !== null &&
        !/^\d{1,11}(\.\d{1,3})?$/.test(String(data[field]))
      )
        throw new BadRequestException(
          "Количество должно быть неотрицательным с точностью до 0,001 т",
        );
    }
  }

  private async writeWithConflict<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "Запись с таким уникальным значением уже существует",
        );
      }
      throw error;
    }
  }

  private audit(
    user: CurrentUser,
    action: string,
    entity: string,
    entityId: string,
    oldValue: unknown,
    newValue: unknown,
    reason?: string,
  ) {
    return this.prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: `reference.${action}`,
        entity,
        entityId,
        oldValue: oldValue as any,
        newValue: newValue as any,
        reason,
      },
    });
  }
}
