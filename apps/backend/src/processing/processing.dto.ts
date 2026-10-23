import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
} from "class-validator";
import { PageDto } from "../common/page.dto";
import { CommandDto } from "../ledger/ledger.dto";
export class ScanDto {
  @IsString() @MaxLength(512) token!: string;
}
export class LaboratoryDto extends CommandDto {
  @IsString() batchId!: string;
  @IsString() @Matches(/^\d{1,2}(\.\d{1,2})?$/) sedimentPercent!: string;
  @IsInt() @Min(1) @Max(1000000) actualBagCount!: number;
  @IsString() @Matches(/^\d{1,3}(\.\d{1,2})?$/) moisturePercent!: string;
  @IsISO8601() measuredAt!: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  fileIds?: string[];
}
export class ReceiveCollectionDto extends CommandDto {
  @IsString() warehouseId!: string;
  @IsString() quantity!: string;
  @IsInt() @Min(1) @Max(1000000) bagCount!: number;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  fileIds?: string[];
}
export class ProcessDto extends CommandDto {
  @IsIn(["PREWASH", "WASHING", "DRYING"]) kind!:
    "PREWASH" | "WASHING" | "DRYING";
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  batchIds!: string[];
  @IsString() fromWarehouseId!: string;
  @IsString() toWarehouseId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  outputWeights!: string[];
  @IsOptional() @IsString() productTypeId?: string;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  fileIds?: string[];
  @IsOptional() @IsString() wasteQuantity?: string;
  @IsOptional() @IsString() lossQuantity?: string;
  @IsOptional() @IsString() defectQuantity?: string;
  @IsOptional() @IsString() @MaxLength(80) shift?: string;
  @IsOptional() @IsString() @MaxLength(160) lineLabel?: string;
}
export class ProcessingRegistryDto extends PageDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsString() stage?: string;
}
export class BagReceiptDto extends CommandDto {
  @IsString() warehouseId!: string;
}
export class PackDto extends CommandDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string;
  @IsString() @Matches(/^[^\s].{0,79}$/) shift!: string;
}
export class SellDto extends CommandDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  batchIds!: string[];
  @IsString() warehouseId!: string;
  @IsString() @MaxLength(300) recipient!: string;
  @IsString() @MaxLength(100) documentNumber!: string;
}
