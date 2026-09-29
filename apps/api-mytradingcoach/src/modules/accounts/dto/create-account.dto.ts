import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { AccountType, DrawdownType } from '@prisma/client';
import { ACCOUNT_CURRENCIES, normalizeCurrencyCode } from '@mtc/shared';

export class CreateAccountDto {
  @IsString({ message: 'Le libellé du compte est requis.' })
  @MaxLength(80, { message: 'Le libellé est trop long (80 caractères max).' })
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60, { message: 'Le nom du broker est trop long (60 caractères max).' })
  broker?: string;

  @IsOptional()
  @IsEnum(AccountType, { message: 'Type de compte invalide.' })
  type?: AccountType;

  @IsOptional()
  @IsNumber({}, { message: 'La taille du compte doit être un nombre.' })
  @Min(0, { message: 'La taille du compte ne peut pas être négative.' })
  accountSize?: number;

  // Devise DU COMPTE : liste unique `ACCOUNT_CURRENCIES` (@mtc/shared), normalisée
  // en majuscules. Absente → USD (défaut Prisma). Aucune conversion ailleurs dans l'app.
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
}
