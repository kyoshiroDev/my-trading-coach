import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// UTM normalisés (trim + minuscules) pour que « NinjaTrader » et « ninjatrader » tombent
// dans la même source à l'agrégation admin ; chaîne vide → absent (null en base).
const normalizeUtm = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() || undefined : value;

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  referralCode?: string;

  // Consentement marketing (case non cochée par défaut côté front).
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  // ── Acquisition (UTM transmis par la landing → /register) ──────────────────
  @IsOptional()
  @Transform(normalizeUtm)
  @IsString()
  @MaxLength(100)
  acquisitionSource?: string;

  @IsOptional()
  @Transform(normalizeUtm)
  @IsString()
  @MaxLength(100)
  acquisitionMedium?: string;

  @IsOptional()
  @Transform(normalizeUtm)
  @IsString()
  @MaxLength(100)
  acquisitionCampaign?: string;
}
