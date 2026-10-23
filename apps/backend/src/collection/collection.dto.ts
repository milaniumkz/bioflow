import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { CommandDto } from "../ledger/ledger.dto";
import { normalizePhone } from "../auth/phone";
export class CollectionDto extends CommandDto {
  @IsString() counterpartyId!: string;
  @IsString() extractionSiteId!: string;
  @IsString() materialTypeId!: string;
  @IsString() vehicleId!: string;
  @IsString() driverId!: string;
  @IsString() destinationWarehouseId!: string;
  @IsString() quantity!: string;
  @IsInt() @Min(1) @Max(1000000) bagCount!: number;
  @IsISO8601() measuredAt!: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  fileIds?: string[];
}
export class CollectorDriverDto extends CommandDto {
  @IsString() @MinLength(1) @MaxLength(200) fullName!: string;
  @Transform(({ value }) => normalizePhone(value))
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: "Укажите корректный номер телефона, например +77001234567",
  })
  phone!: string;
  @IsString() counterpartyId!: string;
}
export class CollectorVehicleDto extends CommandDto {
  @IsString() @MinLength(1) @MaxLength(30) plateNumber!: string;
  @IsString() @MinLength(1) @MaxLength(100) brand!: string;
  @IsString() @MinLength(1) @MaxLength(100) type!: string;
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,11}(\.\d{1,3})?$/)
  capacity?: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,11}(\.\d{1,3})?$/)
  tareWeight?: string;
  @IsString() counterpartyId!: string;
}
export class RoutePointDto {
  @IsUUID() id!: string;
  @IsISO8601() recordedAt!: string;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsNumber() @Min(0) @Max(50) accuracy!: number;
}
export class RoutePointsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RoutePointDto)
  points!: RoutePointDto[];
}
