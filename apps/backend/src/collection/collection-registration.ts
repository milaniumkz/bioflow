import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Post,
} from "@nestjs/common";
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";
import { Prisma } from "@prisma/client";
import * as argon2 from "argon2";
import { Public } from "../common/public.decorator";
import {
  CurrentUser,
  CurrentUser as User,
} from "../common/current-user.decorator";
import { normalizePhone } from "../auth/phone";
import {
  CollectionService,
  assertCollectionDatabase,
} from "./collection.service";

const factories = ["FACTORY-ZHANA_AUL", "FACTORY-SEZ"];
const warehouses = ["HELIOS", "ZHANA_AUL", "EKIBASTUZ", "TEC3"];
class AccountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  fullName!: string;
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @Matches(/^\+\d{7,15}$/)
  phone!: string;
  @IsString() @MinLength(6) @MaxLength(128) password!: string;
}
class RegistrationDto extends AccountDto {
  @IsIn(["COLLECTOR", "WAREHOUSE_MANAGER", "FACTORY_MANAGER"]) role!: string;
  @IsOptional() @IsString() locationId?: string;
}
@Injectable()
export class CollectionRegistrationService {
  constructor(private readonly collection: CollectionService) {}
  private organization() {
    assertCollectionDatabase();
    return process.env.COLLECTION_ORGANIZATION_ID ?? "collection-live";
  }
  async options() {
    const locations = await this.collection.db.collectionLocation.findMany({
      where: {
        organizationId: this.organization(),
        active: true,
        OR: [
          { kind: "WAREHOUSE", code: { in: warehouses } },
          { kind: "FACTORY", code: { in: factories } },
        ],
      },
      select: { id: true, name: true, kind: true },
      orderBy: { name: "asc" },
    });
    return { locations };
  }
  async register(dto: RegistrationDto) {
    const org = this.organization();
    if (
      !["COLLECTOR", "WAREHOUSE_MANAGER", "FACTORY_MANAGER"].includes(dto.role)
    )
      throw new BadRequestException("Выберите доступную роль");
    const passwordHash = await argon2.hash(dto.password);
    try {
      return await this.collection.db.$transaction(async (tx) => {
        if (dto.role === "COLLECTOR" && dto.locationId)
          throw new BadRequestException(
            "Сборщику не назначается склад или завод",
          );
        if (dto.role !== "COLLECTOR") {
          const factory = dto.role === "FACTORY_MANAGER";
          const location =
            dto.locationId &&
            (await tx.collectionLocation.findFirst({
              where: {
                id: dto.locationId,
                organizationId: org,
                active: true,
                kind: factory ? "FACTORY" : "WAREHOUSE",
                code: { in: factory ? factories : warehouses },
              },
            }));
          if (!location)
            throw new BadRequestException("Выберите доступную мойку или завод");
        }
        const role = await tx.role.findUniqueOrThrow({
          where: { code: dto.role },
        });
        const user = await tx.user.create({
          data: {
            organizationId: org,
            phone: dto.phone,
            fullName: dto.fullName,
            passwordHash,
            mustChangePassword: false,
            accessAllObjects: false,
            userRoles: { create: { roleId: role.id } },
          },
          select: { id: true, fullName: true, phone: true },
        });
        if (dto.locationId)
          await tx.collectionMembership.create({
            data: { userId: user.id, locationId: dto.locationId },
          });
        return user;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "Этот номер уже зарегистрирован. Войдите с паролем.",
        );
      throw error;
    }
  }
  async owner(dto: AccountDto, actor: CurrentUser) {
    this.collection.require(actor);
    const passwordHash = await argon2.hash(dto.password);
    return this.collection.db.$transaction(async (tx) => {
      const old = await tx.user.findUnique({
        where: { phone: dto.phone },
        include: { userRoles: { include: { role: true } } },
      });
      if (old) {
        if (
          old.organizationId !== actor.organizationId ||
          !old.userRoles.some((r) => r.role.code === "OWNER") ||
          !(await argon2.verify(old.passwordHash, dto.password))
        )
          throw new ConflictException(
            "Номер уже используется другой учётной записью",
          );
        return { id: old.id, phone: old.phone, created: false };
      }
      const role = await tx.role.findUniqueOrThrow({
        where: { code: "OWNER" },
      });
      const user = await tx.user.create({
        data: {
          organizationId: actor.organizationId,
          fullName: dto.fullName,
          phone: dto.phone,
          passwordHash,
          mustChangePassword: false,
          accessAllObjects: true,
          userRoles: { create: { roleId: role.id } },
        },
        select: { id: true, phone: true },
      });
      return { ...user, created: true };
    });
  }
}
@Controller("collection/registration")
export class CollectionRegistrationController {
  constructor(private readonly service: CollectionRegistrationService) {}
  @Public() @Get("options") options() {
    return this.service.options();
  }
  @Public() @Post() register(@Body() dto: RegistrationDto) {
    return this.service.register(dto);
  }
  @Post("owner") owner(@Body() dto: AccountDto, @User() actor: CurrentUser) {
    return this.service.owner(dto, actor);
  }
}
