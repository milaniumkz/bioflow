import { IsString } from "class-validator";

export class WashingDto {
  @IsString() warehouseId!: string;
  @IsString() inputWeight!: string;
  @IsString() outputWeight!: string;
  @IsString() wasteWeight!: string;
  @IsString() lossWeight!: string;
}

export class ProductionDto {
  @IsString() warehouseId!: string;
  @IsString() productTypeId!: string;
  @IsString() inputWeight!: string;
  @IsString() outputWeight!: string;
  @IsString() wasteWeight!: string;
  @IsString() lossWeight!: string;
}
