import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MoodState } from '@prisma/client';

export class CloseSessionDto {
  @IsEnum(MoodState)
  mood: MoodState;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  reflectionNote?: string;

  @IsOptional()
  @IsString()
  reflectionQuestion?: string;
}
