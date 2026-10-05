import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class TransferItemDto {
  @IsOptional()
  @IsString()
  materialTypeId?: string;

  @IsOptional()
  @IsString()
  productTypeId?: string;

  @IsIn(["DIRTY", "WASHED", "FINISHED"])
  state!: "DIRTY" | "WASHED" | "FINISHED";

  @IsString()
  quantity!: string;
}

export class CreateTransferDto {
  @IsString()
  fromWarehouseId!: string;

  @IsString()
  toWarehouseId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items!: TransferItemDto[];
}

export class CancelTransferDto {
  @IsString()
  reason!: string;
}
