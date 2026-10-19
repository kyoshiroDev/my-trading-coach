import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeUtm } from './register.dto';

/**
 * Connexion / inscription Google (#618) : l'ID token GIS + ce que capte une inscription classique
 * (parrain, UTM), utilisé seulement si le compte est créé. Pas d'opt-in marketing ici : il se
 * choisit sur l'écran de finalisation (case non cochée), jamais implicitement.
 */
export class GoogleAuthDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  credential!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  referralCode?: string;

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
