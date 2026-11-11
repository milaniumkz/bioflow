import { Type } from "class-transformer";
import {
  Matches,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
export class ClaimDriverDto {
  @IsString() @Length(3, 20) plateNumber!: string;
  @IsString() @Matches(/^\+[1-9]\d{6,14}$/) phone!: string;
  @IsString() @Length(32, 128) clientToken!: string;
  @IsString() @Length(32, 256) token!: string;
}
export class DriverPointDto {
  @IsInt() @Min(1) @Max(2147483647) sequence!: number;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsNumber() @Min(0) @Max(100000) accuracy!: number;
  @IsDateString() recordedAt!: string;
}
export class DriverPointsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DriverPointDto)
  points!: DriverPointDto[];
}
