import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { normalizePhone } from "../auth/phone";
import { CollectionCommandDto, CollectionBagDto } from "./collection.dto";
export class AdminCommandDto extends CollectionCommandDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(3, 500)
  reason!: string;
}
export class AdminUserDto extends AdminCommandDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(2, 120)
  fullName!: string;
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @Matches(/^\+\d{7,15}$/)
  phone!: string;
  @IsIn(["OWNER", "ADMIN", "COLLECTOR", "WAREHOUSE_MANAGER", "FACTORY_MANAGER"])
  role!: string;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  locationIds: string[] = [];
  @IsOptional() @IsString() @Length(6, 128) password?: string;
}
export class AdminPasswordDto extends AdminCommandDto {
  @IsString() @Length(6, 128) password!: string;
}
export class AdminBlockDto extends AdminCommandDto {
  @IsBoolean() blocked!: boolean;
}
export class AdminLocationDto extends AdminCommandDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(2, 100)
  name!: string;
  @IsIn(["WAREHOUSE", "FACTORY"]) kind!: string;
  @IsBoolean() active!: boolean;
}
export class AdminStockDto extends AdminCommandDto {
  @IsString() locationId!: string;
  @IsIn(["RAW", "WASHED"]) state!: string;
  @IsString() @Matches(/^\d{1,10}(\.\d{1,3})?$/) expectedKg!: string;
  @IsString() @Matches(/^\d{1,10}(\.\d{1,3})?$/) targetKg!: string;
}
export class AdminBagsDto extends AdminCommandDto {
  @IsString() locationId!: string;
  @IsIn(["FINISHED", "REJECT"]) state!: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CollectionBagDto)
  bags!: CollectionBagDto[];
}
export class AdminTripDto extends AdminCommandDto {
  @IsOptional() @IsInt() @Min(1) @Max(100000) bagCount?: number;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() @Length(2, 120) recipientName?: string;
  @IsOptional() @IsString() @Length(3, 300) recipientAddress?: string;
  @IsOptional() @IsString() @Length(2, 30) driverPlate?: string;
  @IsOptional()
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @Matches(/^\+\d{7,15}$/)
  driverPhone?: string;
}
export class AdminStageDto extends AdminCommandDto {
  @IsIn(["LOADED", "IN_TRANSIT", "ARRIVED"]) status!: string;
}
export class AdminBagStateDto extends AdminCommandDto {
  @IsBoolean() available!: boolean;
}
export class AdminNoticeDto extends AdminCommandDto {
  @IsString() @Length(2, 140) title!: string;
  @IsString() @Length(2, 2000) body!: string;
  @IsIn(["ALL", "USER", "LOCATION", "ROLE"]) target!: string;
  @IsOptional() @IsString() targetId?: string;
}
export class AdminSettingsDto extends AdminCommandDto {
  @IsBoolean() registrationEnabled!: boolean;
}
