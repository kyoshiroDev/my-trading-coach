import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsPositive, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { SESSION_CONTRACT_BOUNDS as B } from '@mtc/shared';

/**
 * Règles du contrat de session (#667). Champ absent = inchangé (PATCH) ou non fixé (création) ;
 * `null` = règle retirée ; `allowedAssets` vide = tous les actifs.
 */
export class SessionContractDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsPositive({ message: 'La perte max doit être un montant positif.' })
  @Max(B.maxDailyLoss.max)
  maxDailyLoss?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(B.maxConsecutiveLosses.min)
  @Max(B.maxConsecutiveLosses.max)
  maxConsecutiveLosses?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(B.maxTrades.min)
  @Max(B.maxTrades.max)
  maxTrades?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(B.newsMinutes.min)
  @Max(B.newsMinutes.max)
  newsMinutes?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(B.allowedAssets.maxItems)
  @IsString({ each: true })
  @MaxLength(B.allowedAssets.maxLength, { each: true })
  @Matches(/^[A-Za-z0-9 ._:/-]+$/, { each: true, message: 'Actif invalide.' })
  allowedAssets?: string[];
}
