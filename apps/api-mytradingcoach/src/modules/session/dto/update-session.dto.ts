import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MoodState } from '@prisma/client';

/**
 * Champs modifiables d'une session. Une classe (et non un type inline) est indispensable :
 * le ValidationPipe ne valide et ne filtre que les classes. Sans elle, n'importe quelle
 * colonne de TradeSession pouvait être écrite via PATCH /session/:id.
 */
export class UpdateSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  planNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  marketContext?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  reflectionNote?: string;

  @IsOptional()
  @IsEnum(MoodState)
  moodEnd?: MoodState;
}
