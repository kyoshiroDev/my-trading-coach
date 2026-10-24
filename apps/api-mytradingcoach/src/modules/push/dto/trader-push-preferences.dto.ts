import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { PushAlertType } from '@prisma/client';
import type { PushQuietHours, TraderPushPreferencesInput } from '@mtc/shared';

/** Minutes depuis minuit (0 à 1439), heure de Paris. */
class QuietHoursDto implements PushQuietHours {
  @IsInt() @Min(0) @Max(1439)
  start!: number;

  @IsInt() @Min(0) @Max(1439)
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
