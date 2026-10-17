import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SIGNUP_FUNNEL_STEPS, type SignupFunnelStep } from '@mtc/shared';
import { normalizeUtm } from './utm.transform';

/**
 * Étape du parcours d'inscription (landing → app → paiement), comptée sans cookie ni donnée
 * personnelle. `detail` est ramené à sa liste blanche par le service (`signupFunnelDetail`) :
 * une valeur inconnue n'est pas une erreur, elle devient `''` (ou `other` pour une erreur).
 */
export class FunnelEventDto {
  @IsIn(SIGNUP_FUNNEL_STEPS)
  step!: SignupFunnelStep;

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
}
