import { IsBoolean, IsEnum, IsNumber, IsOptional, Min } from 'class-validator';

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
}
