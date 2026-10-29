import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordService } from '../discord/discord.service';

/** Page de traitement : borne mémoire et durée d'un passage. */
const BATCH = 200;

/**
 * Fin des Premium sans abonnement Stripe (`trialEndsAt` : essai d'inscription ou Premium offert par
 * l'admin, #769). L'accès tombe seul à la date de fin (tous les contrôles lisent `trialEndsAt`) ; le
 * cron rattrape ce qui ne se recalcule pas à la lecture : le rôle Discord. Rien n'est supprimé, le plan
 * reste FREE, les comptes en trop restent visibles (choix du compte gardé dans « Mes comptes »).
 *
 * Une fin est traitée une fois (`trialEndHandledAt`) ; un `trialEndsAt` repoussé après ce traitement
 * (Premium offert ensuite) sera traité à sa nouvelle fin. Compte démo exclu.
 * Le @Cron ne tourne que sur le worker cron ; la méthode reste appelable (tests).
 */
@Injectable()
export class TrialEndService {
  private readonly logger = new Logger(TrialEndService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordService,
  ) {}

  // 00h30 Paris chaque jour.
  @Cron('30 0 * * *', { timeZone: 'Europe/Paris' })
  async handleDaily(): Promise<void> {
    try {
      const { handled, discordFailed } = await this.handleEndedTrials();
      if (handled > 0 || discordFailed > 0) {
        this.logger.log(`Fins d'essai traitées : ${handled} (rôle Discord en échec : ${discordFailed})`);
      }
    } catch (err) {
      this.logger.error(`Fins d'essai non traitées : ${(err as Error).name}`);
    }
  }

  /** Essais terminés et pas encore traités, par pages. */
  async handleEndedTrials(now = new Date()): Promise<{ handled: number; discordFailed: number }> {
    const where: Prisma.UserWhereInput = {
      isDemo: false,
      trialEndsAt: { lte: now },
      OR: [
        { trialEndHandledAt: null },
        { trialEndHandledAt: { lt: this.prisma.user.fields.trialEndsAt } },
      ],
    };
    let handled = 0;
    let discordFailed = 0;
    for (;;) {
      const users = await this.prisma.user.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: BATCH });
      if (users.length === 0) break;
      for (const { id } of users) {
        // Un échec Discord (API indisponible) ne bloque pas le traitement : le rôle sera réaligné à
        // la prochaine liaison ou par la resynchronisation admin.
        await this.discord.syncDiscordRole(id).catch(() => {
          discordFailed++;
        });
      }
      const res = await this.prisma.user.updateMany({
        where: { id: { in: users.map((u) => u.id) } },
        data: { trialEndHandledAt: now },
      });
      handled += res.count;
      if (users.length < BATCH) break;
    }
    return { handled, discordFailed };
  }
}
