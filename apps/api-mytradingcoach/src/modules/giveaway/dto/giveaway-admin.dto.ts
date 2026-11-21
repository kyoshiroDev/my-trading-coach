import { IsBoolean, IsEnum, IsIn } from 'class-validator';
import { GiveawayModeration, GiveawayPool } from '@prisma/client';

/** PATCH /admin/giveaway/settings : allumer ou éteindre un tirage. */
export class UpdateGiveawaySettingsDto {
  @IsEnum(GiveawayPool)
  pool!: GiveawayPool;

  @IsBoolean()
  enabled!: boolean;
}

/** PATCH /admin/giveaway/wins/:id/moderation : valider ou refuser le message d'un gagnant. */
export class ModerateGiveawayWinDto {
  @IsIn([GiveawayModeration.VALIDE, GiveawayModeration.REFUSE])
  moderation!: GiveawayModeration;
}

/** POST /admin/giveaway/draw : tirage manuel (hors prod). */
export class DrawGiveawayDto {
  @IsEnum(GiveawayPool)
  pool!: GiveawayPool;
}
