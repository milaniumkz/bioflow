import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class CommandDto {
  @IsString() @MaxLength(128) idempotencyKey!: string;
}
export class BatchDto extends CommandDto {
  @IsString() counterpartyId!: string;
  @IsString() extractionSiteId!: string;
  @IsString() materialTypeId!: string;
  @IsString() quantity!: string;
  @IsString() measurementMethod!: string;
  @IsISO8601() measuredAt!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) fileIds?: string[];
}
export class TripDto extends CommandDto {
  @IsString() batchId!: string;
  @IsString() vehicleId!: string;
  @IsOptional() @IsString() driverId?: string;
  @IsString() destinationWarehouseId!: string;
  @IsString() quantity!: string;
  @IsISO8601() documentDate!: string;
}
export class LoadingDto extends CommandDto {
  @IsString() grossWeight!: string;
  @IsString() tareWeight!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) fileIds!: string[];
  @IsOptional() @IsString() reason?: string;
}
export class StatusDto extends CommandDto {
  @IsIn([
    "IN_TRANSIT",
    "ARRIVED",
    "REVIEW",
    "REJECTED",
    "CANCELLED",
    "COMPLETED",
  ])
  status!: string;
  @IsOptional() @IsString() reason?: string;
}
export class ReceiptDto extends CommandDto {
  @IsString() warehouseId!: string;
  @IsString() grossWeight!: string;
  @IsString() tareWeight!: string;
  @IsOptional() @IsString() reason?: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) fileIds!: string[];
  @IsOptional() @IsBoolean() partial?: boolean;
}
export class InputDto {
  @IsString() batchId!: string;
  @IsString() quantity!: string;
}
export class OperationDto extends CommandDto {
  @IsIn([
    "WASHING",
    "PRODUCTION",
    "TRANSFER",
    "WRITE_OFF",
    "SHIPMENT",
    "RESERVE",
    "RELEASE",
    "CORRECTION",
    "INVENTORY",
    "RETURN",
  ])
  kind!: string;
  @IsString() fromWarehouseId!: string;
  @IsOptional() @IsString() toWarehouseId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InputDto)
  inputs!: InputDto[];
  @IsOptional() @IsString() outputQuantity?: string;
  @IsOptional() @IsString() wasteQuantity?: string;
  @IsOptional() @IsString() lossQuantity?: string;
  @IsOptional() @IsString() defectQuantity?: string;
  @IsOptional() @IsString() productTypeId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() recipient?: string;
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() documentNumber?: string;
  @IsOptional() @IsString() shift?: string;
  @IsOptional() @IsString() line?: string;
  @IsOptional() @IsString() packaging?: string;
  @IsOptional() @IsString() reversesOperationId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) fileIds?: string[];
}
export class ReasonDto extends CommandDto {
  @IsString() reason!: string;
}
export class AccessDto {
  @IsBoolean() accessAllObjects!: boolean;
  @IsOptional() @IsString() counterpartyScopeId?: string;
  @IsArray() @IsString({ each: true }) warehouseScopeIds!: string[];
  @IsArray() @IsString({ each: true }) extractionScopeIds!: string[];
  @IsString() reason!: string;
}
export class LedgerQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 20;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() counterpartyId?: string;
  @IsOptional() @IsString() extractionSiteId?: string;
  @IsOptional() @IsString() materialTypeId?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsISO8601() dateFrom?: string;
  @IsOptional() @IsISO8601() dateTo?: string;
  @IsOptional() @IsIn(["csv", "xlsx", "pdf"]) format?: string;
}
