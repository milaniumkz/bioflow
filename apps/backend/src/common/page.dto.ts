import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class PageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortDir?: "asc" | "desc";

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  state?: string;
}

export function orderBy(query: PageDto, allowed: string[], fallback = "createdAt") {
  const sortBy = query.sortBy && allowed.includes(query.sortBy) ? query.sortBy : fallback;
  return { [sortBy]: query.sortDir === "asc" ? "asc" : "desc" };
}
