import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MoodState } from '@prisma/client';

export class CreateSessionDto {
  @IsEnum(MoodState)
  mood: MoodState;

  // Compte auquel rattacher la session (multi-comptes). Absent → compte par défaut.
  @IsString()
  @IsOptional()
  accountId?: string;
}
