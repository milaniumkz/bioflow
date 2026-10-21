import { Transform } from "class-transformer";
import { normalizePhone } from "../auth/phone";
import {
  Allow,
  IsBoolean,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export class CreateReferenceDto {
  @IsObject()
  data!: Record<string, unknown>;
}

export class UpdateReferenceDto {
  @IsObject()
  data!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => normalizePhone(value))
  phone?: string;

  @IsString()
  fullName!: string;

  @IsString()
  @IsOptional()
  @MinLength(6)
  temporaryPassword: string = "123456";
}

export class AssignRolesDto {
  @IsString({ each: true })
  roleCodes!: string[];
}

export class UpsertSettingDto {
  @IsString()
  key!: string;

  @Allow()
  value!: unknown;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class SetUserBlockedDto {
  @IsBoolean()
  blocked!: boolean;

  @IsString()
  reason!: string;
}
