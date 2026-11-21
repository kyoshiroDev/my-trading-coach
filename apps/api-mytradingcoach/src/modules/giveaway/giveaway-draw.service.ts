import { Injectable, Logger } from '@nestjs/common';
import { GiveawayActivation, GiveawayPool, Prisma } from '@prisma/client';
import { createHash, randomInt } from 'crypto';
import { addCalendarMonths, giveawayPeriod, giveawayPrizeMonths, type AdminGiveawayDrawResponse } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { GiveawayEligibilityService } from './giveaway-eligibility.service';
import { GiveawayPrizeService, safePrizeError } from './giveaway-prize.service';
import { GiveawaySettingsService } from './giveaway-settings.service';

/** Issue d'un tirage : contrat partagé avec l'admin (`POST /admin/giveaway/draw`). */
export type DrawOutcome = AdminGiveawayDrawResponse;

/** Trace d'audit : sha256 de la liste triée des identifiants éligibles (une ligne par id). */
export function eligibleHash(ids: string[]): string {
  return createHash('sha256').update(ids.join('\n')).digest('hex');
}

/** L'admin n'existe qu'en prod (pas d'environnement dev). */
const ADMIN_GIVEAWAY_URL = 'https://admin.mytradingcoach.app/tirages';

const POOL_LABEL: Record<GiveawayPool, string> = { FREE: 'gratuits', PREMIUM: 'Premium' };

/**
 * Tirage mensuel (PROMPT-tirage-mensuel) : un seul tirage par (période, tirage), garanti par la
 * contrainte unique en base (deux lancements du cron, ou cron + « Tirer maintenant », n'en font qu'un).
 */
@Injectable()
export class GiveawayDrawService {
  private readonly logger = new Logger(GiveawayDrawService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: GiveawaySettingsService,
    private readonly eligibility: GiveawayEligibilityService,
    private readonly prizes: GiveawayPrizeService,
    private readonly resend: ResendService,
  ) {}

  /** Rang tiré dans `[0, n)` (surchargé par les tests). */
  pickIndex(n: number): number {
    return randomInt(n);
  }

  async draw(pool: GiveawayPool, now = new Date()): Promise<DrawOutcome> {
    if (!(await this.settings.isEnabled(pool))) return { kind: 'disabled' };
    const period = giveawayPeriod(now);
    const existing = await this.prisma.giveawayDraw.findUnique({ where: { period_pool: { period, pool } }, select: { id: true } });
    if (existing) return { kind: 'already-drawn', drawId: existing.id };

    const ids = await this.eligibility.eligibleIds(pool, now);
    const drawnIndex = ids.length > 0 ? this.pickIndex(ids.length) : null;
    const winnerId = drawnIndex === null ? null : ids[drawnIndex];
    const months = giveawayPrizeMonths(pool);

    let drawId: string;
    let winId: string | null = null;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const draw = await tx.giveawayDraw.create({
          data: { period, pool, eligibleCount: ids.length, drawnAt: now, winnerId, eligibleHash: eligibleHash(ids), drawnIndex },
        });
        const win = winnerId
          ? await tx.giveawayWin.create({
              data: {
                drawId: draw.id, userId: winnerId, pool, prizeMonths: months,
                // Dates provisoires, remplacées à l'attribution (le lot gratuit part de max(maintenant, fin d'essai)).
                startsAt: now, endsAt: addCalendarMonths(now, months),
              },
            })
          : null;
        return { drawId: draw.id, winId: win?.id ?? null };
      });
      drawId = created.drawId;
      winId = created.winId;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.prisma.giveawayDraw.findUnique({ where: { period_pool: { period, pool } }, select: { id: true } });
        return { kind: 'already-drawn', drawId: again?.id ?? '' };
      }
      throw err;
    }

    if (!winId || !winnerId) {
      this.logger.log(`Tirage ${pool} ${period} : aucun éligible.`);
      await this.notifyAdmin(
        `🎁 Tirage ${POOL_LABEL[pool]} ${period} : aucun éligible`,
        `Le tirage ${POOL_LABEL[pool]} du ${period} n'a trouvé aucun compte éligible. Aucun lot attribué.\n\n${this.adminLink()}`,
      );
      return { kind: 'no-eligible', drawId };
    }

    const result = await this.prizes.apply(winId, now);
    await this.notifyWinner(pool, period, ids.length, winId, result.status, result.error);
    return { kind: 'drawn', drawId, winId, activation: result.status };
  }

  /** Les deux tirages allumés, l'un après l'autre (le cron) ; une erreur sur l'un n'empêche pas l'autre. */
  async drawAll(now = new Date()): Promise<DrawOutcome[]> {
    const out: DrawOutcome[] = [];
    for (const pool of [GiveawayPool.FREE, GiveawayPool.PREMIUM]) {
      try {
        out.push(await this.draw(pool, now));
      } catch (err) {
        // Code seulement : le message d'une erreur Prisma ou Stripe peut recopier requête et identifiants.
        const reason = safePrizeError(err);
        this.logger.error(`Tirage ${pool} en échec : ${reason}`);
        await this.notifyAdmin(`⚠️ Tirage ${POOL_LABEL[pool]} en échec`, `Erreur : ${reason}\n\n${this.adminLink()}`);
      }
    }
    return out;
  }

  private async notifyWinner(
    pool: GiveawayPool,
    period: string,
    eligibleCount: number,
    winId: string,
    activation: GiveawayActivation,
    error: string | null,
  ): Promise<void> {
    const win = await this.prisma.giveawayWin.findUnique({
      where: { id: winId },
      select: { prizeMonths: true, endsAt: true, user: { select: { email: true, name: true } } },
    });
    const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
    const state =
      activation === GiveawayActivation.APPLIED
        ? `Lot attribué, jusqu'au ${win ? fmt(win.endsAt) : '?'}.`
        : `⚠️ Lot NON attribué : ${error ?? 'erreur inconnue'}. Bouton « Relancer l'attribution » dans l'admin.`;
    await this.notifyAdmin(
      `🎁 Tirage ${POOL_LABEL[pool]} ${period} : ${win?.user?.name ?? 'gagnant'}`,
      [
        `Gagnant : ${win?.user?.name ?? '(nom non renseigné)'} · ${win?.user?.email ?? '?'}`,
        `Lot : ${win?.prizeMonths ?? '?'} mois`,
        `Éligibles : ${eligibleCount}`,
        state,
        '',
        this.adminLink(),
      ].join('\n'),
    );
  }

  private adminLink(): string {
    return ADMIN_GIVEAWAY_URL;
  }

  private async notifyAdmin(subject: string, body: string): Promise<void> {
    await this.resend.sendAdminAlert(subject, body).catch(() => undefined);
  }
}
