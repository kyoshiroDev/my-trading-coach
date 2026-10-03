import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { AccountStatus, AccountType, DrawdownType } from '@prisma/client';
import { ACCOUNT_CURRENCIES, normalizeCurrencyCode } from '@mtc/shared';

// Tous les champs optionnels (update partiel). Le `status` est piloté par l'user
// (PASSED / FAILED / ARCHIVED) : jamais positionné automatiquement par le backend.
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'Le libellé est trop long (80 caractères max).' })
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60, { message: 'Le nom du broker est trop long (60 caractères max).' })
  broker?: string;

  @IsOptional()
  @IsEnum(AccountType, { message: 'Type de compte invalide.' })
  type?: AccountType;

  @IsOptional()
  @IsEnum(AccountStatus, { message: 'Statut de compte invalide.' })
  status?: AccountStatus;

  @IsOptional()
  @IsNumber({}, { message: 'La taille du compte doit être un nombre.' })
  @Min(0, { message: 'La taille du compte ne peut pas être négative.' })
  accountSize?: number;

  // Devise DU COMPTE (liste unique @mtc/shared). Refusée sur un compte synchronisé : elle vient
  // du broker (AccountsService.update).
  @IsOptional()
  @Transform(({ value }) => normalizeCurrencyCode(value) ?? value)
  @IsIn(ACCOUNT_CURRENCIES, { message: `Devise invalide (${ACCOUNT_CURRENCIES.join(', ')}).` })
  currency?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Le solde de départ doit être un nombre.' })
  startingBalance?: number;

  @IsOptional()
  @IsNumber({}, { message: "L'objectif doit être un nombre." })
  @Min(0, { message: "L'objectif ne peut pas être négatif." })
  profitTarget?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Le drawdown max doit être un nombre.' })
  @Min(0, { message: 'Le drawdown max ne peut pas être négatif.' })
  maxDrawdown?: number;

  @IsOptional()
  @IsEnum(DrawdownType, { message: 'Type de drawdown invalide (STATIC ou TRAILING).' })
  drawdownType?: DrawdownType;

  // Plan du catalogue prop firm ; null détache le compte du plan (IsOptional laisse passer null).
  @IsOptional()
  @IsString()
  @MaxLength(80)
  propFirmPlanId?: string | null;

  // Plateforme de trading (clé du catalogue, ex. `rithmic`) : certaines règles en dépendent.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-z0-9_]+$/, { message: 'Plateforme invalide.' })
  platform?: string | null;

  // Date du dernier payout reçu (AAAA-MM-JJ) : début du cycle de payout en cours.
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Date du dernier payout invalide (AAAA-MM-JJ).' })
  lastPayoutAt?: string | null;
}
