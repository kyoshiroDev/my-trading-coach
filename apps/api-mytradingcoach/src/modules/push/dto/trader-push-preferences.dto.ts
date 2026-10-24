import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { PushAlertType } from '@prisma/client';
import type { PushQuietHours, TraderPushPreferencesInput } from '@mtc/shared';

/** Début égal à la fin : aucune plage, alors que l'interrupteur dirait « actif » (revue phase 2 I5). */
@ValidatorConstraint({ name: 'quietHoursDistinct' })
class DistinctFromStart implements ValidatorConstraintInterface {
  validate(end: unknown, args: ValidationArguments): boolean {
    return end !== (args.object as QuietHoursDto).start;
  }

  defaultMessage(): string {
    return 'Choisis deux heures différentes';
  }
}

/** Minutes depuis minuit (0 à 1439), heure de Paris. Début et fin différents. */
class QuietHoursDto implements PushQuietHours {
  @IsInt() @Min(0) @Max(1439)
  start!: number;

  @IsInt() @Min(0) @Max(1439) @Validate(DistinctFromStart)
  end!: number;
}

/** PATCH /push/preferences : champ absent = inchangé ; `quietHours: null` = désactivées. */
export class TraderPushPreferencesDto implements TraderPushPreferencesInput {
  @IsOptional() @IsArray() @ArrayMaxSize(Object.keys(PushAlertType).length) @IsEnum(PushAlertType, { each: true })
  mutedTypes?: PushAlertType[];

  /** `@IsOptional` laisse passer `null` : c'est la désactivation des heures silencieuses. */
  @IsOptional() @ValidateNested() @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto | null;
}
