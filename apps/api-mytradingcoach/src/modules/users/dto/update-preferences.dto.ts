import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
}

export class UpdatePreferencesDto {
  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;

  @IsBoolean()
  @IsOptional()
  notificationsEmail?: boolean;

  @IsBoolean()
  @IsOptional()
  debriefAutomatic?: boolean;
}
