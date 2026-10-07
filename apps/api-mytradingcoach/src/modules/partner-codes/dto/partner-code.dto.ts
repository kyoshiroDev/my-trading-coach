import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Length, Min, ValidateIf } from 'class-validator';

/** POST /admin/partner-codes : `durationMonths` / `maxRedemptions` / `expiresAt` à null = à vie / illimité / sans fin. */
export class CreatePartnerCodeDto {
  @IsString()
  @Length(3, 20)
  code!: string;

  @IsString()
  @Length(1, 100)
  label!: string;

  @IsInt()
  @Min(1)
  priceMonthlyEur!: number;

  @IsInt()
  @Min(1)
  priceAnnualEur!: number;

  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  durationMonths!: number | null;

  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  maxRedemptions!: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** PATCH /admin/partner-codes/:id : tout est optionnel, le code ne se renomme pas. */
export class UpdatePartnerCodeDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  priceMonthlyEur?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  priceAnnualEur?: number;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  durationMonths?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
