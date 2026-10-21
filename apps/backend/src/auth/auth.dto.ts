import { Transform } from "class-transformer";
import { normalizePhone } from "./phone";
import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class LoginDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => normalizePhone(value))
  phone?: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @IsString()
  pushToken?: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class ForgotPasswordDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => normalizePhone(value))
  phone?: string;
}

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class RegisterDeviceDto {
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsString()
  platform!: string;

  @IsOptional()
  @IsString()
  pushToken?: string;
}

/** Proof of the existing native session; actor identity is supplied by JWT guard. */
export class MobileWebSessionDto {
  @IsString()
  refreshToken!: string;
}
