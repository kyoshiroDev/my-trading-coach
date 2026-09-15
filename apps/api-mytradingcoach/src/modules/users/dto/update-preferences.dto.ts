import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdatePreferencesDto {
  /**
   * @deprecated PROMPT-214 : IGNORÉ. Il n'existe plus de devise globale (la devise est celle du
   * compte). Encore accepté pour ne pas rejeter en 400 un front resté en cache ; à retirer avec
   * les colonnes `User.currency` / `currencyRate` (migration séparée).
   */
  @IsString()
  @MaxLength(8)
  @IsOptional()
  currency?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  startingCapital?: number;

  @IsBoolean()
  @IsOptional()
  notificationsEmail?: boolean;

  @IsBoolean()
  @IsOptional()
  debriefAutomatic?: boolean;

  // Consentement aux emails marketing (toggle Paramètres).
  @IsBoolean()
  @IsOptional()
  marketingConsent?: boolean;

  @IsString()
  @IsOptional()
  tradingStyle?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tradingStrategy?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tradingSessions?: string[];

  @IsInt()
  @Min(0)
  @Max(200)
  @IsOptional()
  tradesPerDayMin?: number;

  @IsInt()
  @Min(0)
  @Max(200)
  @IsOptional()
  tradesPerDayMax?: number;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  strategyDescription?: string;
}
