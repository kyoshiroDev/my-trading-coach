import { IsBoolean, IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';
import { GiveawayModeration, GiveawayPool } from '@prisma/client';
import type { DrawGiveawayRequest, ModerateGiveawayWinRequest, PublishGiveawayInstagramRequest, UpdateGiveawaySettingsRequest } from '@mtc/shared';

/** PATCH /admin/giveaway/settings : allumer ou éteindre un tirage. */
export class UpdateGiveawaySettingsDto implements UpdateGiveawaySettingsRequest {
  @IsEnum(GiveawayPool)
  pool!: GiveawayPool;

  @IsBoolean()
  enabled!: boolean;
}

/** PATCH /admin/giveaway/wins/:id/moderation : valider ou refuser le message d'un gagnant. */
export class ModerateGiveawayWinDto implements ModerateGiveawayWinRequest {
  @IsIn([GiveawayModeration.VALIDE, GiveawayModeration.REFUSE])
  moderation!: typeof GiveawayModeration.VALIDE | typeof GiveawayModeration.REFUSE;
}

/** POST /admin/giveaway/draw : tirage manuel (hors prod). */
export class DrawGiveawayDto implements DrawGiveawayRequest {
  @IsEnum(GiveawayPool)
  pool!: GiveawayPool;
}

/** POST /admin/giveaway/wins/:id/instagram/publish : légende relue, visuel de l'aperçu, heure facultative. */
export class PublishGiveawayInstagramDto implements PublishGiveawayInstagramRequest {
  @IsString()
  @MaxLength(2200) // limite Instagram ; la légende est ensuite bornée et contrôlée par le service
  caption!: string;

  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  imageUrl!: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  publishAt?: string | null;
}
