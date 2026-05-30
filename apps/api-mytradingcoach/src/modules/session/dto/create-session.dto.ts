import { IsEnum } from 'class-validator';
import { MoodState } from '@prisma/client';

export class CreateSessionDto {
  @IsEnum(MoodState)
  mood: MoodState;
}
