import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/** `?includeTests=true|1` → vrai ; absent ou autre valeur → faux (campagnes de test exclues, #1029). */
const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

/** Pages de l'admin Acquisition : « Inclure les tests » (faux par défaut). */
export class AcquisitionQueryDto {
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeTests?: boolean;
}

/** GET /admin/signup-funnel et /admin/landing-engagement : `?days=7|30` (30 par défaut) + `includeTests`. */
export class AcquisitionPeriodQueryDto extends AcquisitionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30])
  days?: 7 | 30;
}
