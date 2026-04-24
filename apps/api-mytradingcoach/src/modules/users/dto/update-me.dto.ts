import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}
