import { IsIn, IsOptional, IsString } from "class-validator";

export class CreateWriteOffDto {
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
  quantity!: string;

  @IsString()
  reason!: string;
}
