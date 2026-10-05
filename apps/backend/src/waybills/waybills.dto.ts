import { IsIn, IsOptional, IsString } from "class-validator";

export class CreateWaybillDto {
  @IsString() counterpartyId!: string;
  @IsString() extractionSiteId!: string;
  @IsString() vehicleId!: string;
  @IsString() driverId!: string;
  @IsString() destinationWarehouseId!: string;
  @IsString() materialTypeId!: string;
  @IsString() declaredWeight!: string;
  @IsOptional() @IsString() comment?: string;
}

export class AcceptWaybillDto {
  @IsString() warehouseId!: string;
  @IsString() actualWeight!: string;
  @IsString() idempotencyKey!: string;
  @IsOptional() @IsString() reason?: string;
}

export class ResolveQrDto {
  @IsString() token!: string;
}

export class UpdateWaybillStatusDto {
  @IsIn(["LOADED", "IN_TRANSIT", "ARRIVED", "REJECTED", "CANCELLED"])
  status!: "LOADED" | "IN_TRANSIT" | "ARRIVED" | "REJECTED" | "CANCELLED";

  @IsOptional()
  @IsString()
  reason?: string;
}
