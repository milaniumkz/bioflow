import { IsIn, IsOptional, IsString } from "class-validator";

export class CreateCorrectionDto {
  @IsString()
  warehouseId!: string;

  @IsOptional()
  @IsString()
  materialTypeId?: string;

  @IsOptional()
  @IsString()
  productTypeId?: string;

  @IsIn(["DIRTY", "WASHED", "FINISHED"])
  state!: "DIRTY" | "WASHED" | "FINISHED";

  @IsString()
  quantityDelta!: string;

  @IsString()
  reason!: string;
}
