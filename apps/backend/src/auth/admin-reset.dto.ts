import { IsString, MinLength } from "class-validator";
export class AdminResetDto {
  @IsString() @MinLength(8) temporaryPassword!: string;
  @IsString() @MinLength(3) reason!: string;
}
