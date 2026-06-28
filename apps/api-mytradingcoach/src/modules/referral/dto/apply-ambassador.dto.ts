import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ApplyAmbassadorDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  socials!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
