import { Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
export class CollectionCommandDto {
  @IsString() @Length(8, 128) idempotencyKey!: string;
}
export class CollectionTripDto extends CollectionCommandDto {
  @IsString() warehouseId!: string;
  @IsInt() @Min(1) @Max(100000) bagCount!: number;
  @IsString() @Matches(/^\d{1,10}(\.\d{1,3})?$/) weightKg!: string;
}
export class CollectionWashDto extends CollectionCommandDto {
  @IsString() locationId!: string;
  @IsString() @Matches(/^\d{1,10}(\.\d{1,3})?$/) weightKg!: string;
}
export class CollectionShipmentDto extends CollectionWashDto {
  @IsString() factoryId!: string;
  @IsInt() @Min(1) @Max(100000) bagCount!: number;
}
export class CollectionBagDto {
  @IsString() @Matches(/^\d{1,10}(\.\d{1,3})?$/) weightKg!: string;
}
export class CollectionProductionDto extends CollectionCommandDto {
  @IsString() locationId!: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CollectionBagDto)
  finished!: CollectionBagDto[];
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CollectionBagDto)
  rejected!: CollectionBagDto[];
}
export class CollectionFactoryDto extends CollectionCommandDto {
  @IsString() @Length(2, 100) name!: string;
}
export class CollectionDriverEventDto {
  @IsString() @Length(8, 128) requestId!: string;
  @IsIn(["LOADED", "DEPARTED", "ARRIVED"]) type!: string;
  @IsISO8601() recordedAt!: string;
}

export class CollectionGpTripDto extends CollectionCommandDto {
  @IsString() locationId!: string;
  @IsString() @Length(2, 120) recipientName!: string;
  @IsString() @Length(3, 300) recipientAddress!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  bagIds!: string[];
}

export class CollectionWeightCorrectionDto extends CollectionCommandDto {
  @IsString() @Matches(/^\d{1,10}(\.\d{1,3})?$/) weightKg!: string;
  @IsString() @Matches(/^\d{1,10}(\.\d{1,3})?$/) expectedWeightKg!: string;
  @IsString() @Length(10, 500) reason!: string;
}
