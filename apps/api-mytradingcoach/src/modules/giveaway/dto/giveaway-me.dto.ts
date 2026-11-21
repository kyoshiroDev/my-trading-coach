import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { GiveawayDisplayConsent } from '@prisma/client';
import { GIVEAWAY_MESSAGE_MAX, GIVEAWAY_PSEUDO_MAX, type UpdateMyGiveawayWinRequest } from '@mtc/shared';

/** PATCH /giveaway/me/win : réglages de la page gagnant. */
export class UpdateMyGiveawayWinDto implements UpdateMyGiveawayWinRequest {
  @IsEnum(GiveawayDisplayConsent)
  displayConsent!: GiveawayDisplayConsent;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(GIVEAWAY_PSEUDO_MAX)
  displayPseudo?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(GIVEAWAY_MESSAGE_MAX)
  message?: string | null;

  @IsBoolean()
  instagramConsent!: boolean;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(31) // 30 caractères + « @ » éventuel, retiré par le service
  instagramHandle?: string | null;
}
