import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateUploadUrlDto {
  @IsString()
  fileName!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024)
  size!: number;

  @IsOptional()
  @IsString()
  waybillId?: string;
}

export class AttachFileDto {
  @IsString()
  fileId!: string;
}
