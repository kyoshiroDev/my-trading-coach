import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RegenerateDebriefDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsInt()
  @Min(2020)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(53)
  week!: number;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
