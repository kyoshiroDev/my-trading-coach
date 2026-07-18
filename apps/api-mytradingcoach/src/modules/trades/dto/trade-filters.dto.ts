import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsDateString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { TradeSide } from '@prisma/client';

/**
 * Valeurs acceptées par le filtre « émotion effective » (PROMPT-166).
 * Combine EmotionState (override du trade) et MoodState (humeur de session) :
 * `TIRED` n'existe que dans MoodState, `REVENGE`/`FEAR` que dans EmotionState.
 * `NONE` = émotion non renseignée.
 */
export const EFFECTIVE_EMOTION_FILTER_VALUES = [
  'CONFIDENT',
  'FOCUSED',
  'NEUTRAL',
  'STRESSED',
  'REVENGE',
  'FEAR',
  'TIRED',
  'NONE',
] as const;

export class TradeFiltersDto {
  @IsString()
  @IsOptional()
  cursor?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value))
  @IsOptional()
  limit?: number = 20;

  @IsEnum(TradeSide)
  @IsOptional()
  side?: TradeSide;

  @IsString()
  @IsOptional()
  setupId?: string;

  // Filtre « émotion effective » (override du trade OU humeur de session) — voir buildTradeWhere.
  @IsIn(EFFECTIVE_EMOTION_FILTER_VALUES as unknown as string[])
  @IsOptional()
  emotion?: string;

  // Résultat du trade clôturé (mêmes seuils ε que trade-stats.util).
  @IsIn(['WIN', 'LOSS', 'BREAKEVEN'])
  @IsOptional()
  result?: 'WIN' | 'LOSS' | 'BREAKEVEN';

  // Note d'exécution calculée ; 'NONE' = non évaluée (executionGrade null).
  @IsIn(['EXCELLENT', 'BON', 'MOYEN', 'MAUVAIS', 'NONE'])
  @IsOptional()
  executionGrade?: string;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  // Filtre multi-comptes : id de compte, ou 'all'/absent pour l'agrégé.
  @IsString()
  @IsOptional()
  accountId?: string;
}
