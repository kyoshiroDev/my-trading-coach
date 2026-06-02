import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MoodState } from '@prisma/client';

export class CloseSessionDto {
  @IsEnum(MoodState)
  mood: MoodState;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reflectionNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reflectionQuestion?: string;
}
