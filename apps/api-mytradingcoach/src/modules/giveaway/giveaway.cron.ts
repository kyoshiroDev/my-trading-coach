import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GIVEAWAY_DRAW_DAY, GIVEAWAY_DRAW_HOUR, GIVEAWAY_TIMEZONE } from '@mtc/shared';
import { GiveawayDrawService } from './giveaway-draw.service';

/** Expression du cron tirée des constantes partagées (« 0 9 1 * * » : le 1er à 9 h, Paris). */
export const GIVEAWAY_CRON = `0 ${GIVEAWAY_DRAW_HOUR} ${GIVEAWAY_DRAW_DAY} * *`;

/**
 * Tirage mensuel automatique (PROMPT-tirage-mensuel). Worker cron seul (`runsCrons`). Seuls les
 * tirages allumés tournent ; un second lancement ne refait rien (contrainte unique par période).
 */
@Injectable()
export class GiveawayCron {
  private readonly logger = new Logger(GiveawayCron.name);

  constructor(private readonly draws: GiveawayDrawService) {}

  @Cron(GIVEAWAY_CRON, { timeZone: GIVEAWAY_TIMEZONE })
  async run(now = new Date()): Promise<void> {
    const outcomes = await this.draws.drawAll(now);
    this.logger.log(`Tirage mensuel : ${outcomes.map((o) => o.kind).join(', ') || 'rien'}`);
  }
}
