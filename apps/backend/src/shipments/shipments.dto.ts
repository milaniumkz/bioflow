import { IsOptional, IsString } from "class-validator";

export class CreateShipmentDto {
  @IsString()
  warehouseId!: string;

  @IsString()
  productTypeId!: string;

  @IsString()
  quantity!: string;

  @IsString()
  recipient!: string;

  @IsOptional()
  @IsString()
  documentNumber?: string;
}
