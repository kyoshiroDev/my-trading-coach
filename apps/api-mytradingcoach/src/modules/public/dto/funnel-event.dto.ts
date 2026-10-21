import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { FUNNEL_BEACON_STEPS, type FunnelBeaconStep } from '@mtc/shared';
import { normalizeUtm } from './utm.transform';

/**
 * Étape du parcours d'inscription (landing → app → paiement) ou engagement landing (défilement,
 * temps passé, sélecteur de règles), comptée sans cookie ni donnée personnelle. `detail` est ramené
 * à sa liste blanche par le service (`signupFunnelDetail`) : une valeur inconnue n'est pas une
 * erreur, elle devient `''` (ou `other` pour une erreur).
 */
export class FunnelEventDto {
  @IsIn(FUNNEL_BEACON_STEPS)
  step!: FunnelBeaconStep;

  @IsOptional()
  @Transform(normalizeUtm)
  @IsString()
  @MaxLength(100)
  source?: string;

  @IsOptional()
  @Transform(normalizeUtm)
  @IsString()
  @MaxLength(100)
  medium?: string;

  @IsOptional()
  @Transform(normalizeUtm)
  @IsString()
  @MaxLength(100)
  campaign?: string;

  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  detail?: string;

  /** Page de la landing (engagement seulement), ramenée à `LANDING_ENGAGEMENT_PAGES` par le service. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  path?: string;
}
