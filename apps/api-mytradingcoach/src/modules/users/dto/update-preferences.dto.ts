import { IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
}

export class UpdatePreferencesDto {
  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;

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
