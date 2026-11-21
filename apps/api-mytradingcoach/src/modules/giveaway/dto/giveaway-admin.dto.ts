import { IsBoolean, IsEnum, IsIn } from 'class-validator';
import { GiveawayModeration, GiveawayPool } from '@prisma/client';
import type { DrawGiveawayRequest, ModerateGiveawayWinRequest, UpdateGiveawaySettingsRequest } from '@mtc/shared';

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
