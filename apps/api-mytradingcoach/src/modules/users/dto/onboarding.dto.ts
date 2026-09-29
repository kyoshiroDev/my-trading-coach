import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export enum Market {
  CRYPTO = 'CRYPTO',
  FOREX = 'FOREX',
  ACTIONS = 'ACTIONS',
  MULTI = 'MULTI',
}

export enum Goal {
  DISCIPLINE = 'DISCIPLINE',
  PERFORMANCE = 'PERFORMANCE',
  PSYCHOLOGIE = 'PSYCHOLOGIE',
}

export class CompleteOnboardingDto {
  @IsEnum(Market)
  @IsOptional()
  market?: Market | null;

  @IsEnum(Goal)
  @IsOptional()
  goal?: Goal | null;

  @IsNumber()
  @Min(0)
  @IsOptional()
  startingCapital?: number;

  /**
   * @deprecated IGNORÉ. La devise se choisit sur le compte créé à l'onboarding
   * (`TradingAccount.currency`), plus sur le profil. Encore accepté pour ne pas rejeter un front
   * resté en cache ; à retirer avec les colonnes `User.currency` / `currencyRate`.
   */
  @IsString()
  @MaxLength(8)
  @IsOptional()
  currency?: string;

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
