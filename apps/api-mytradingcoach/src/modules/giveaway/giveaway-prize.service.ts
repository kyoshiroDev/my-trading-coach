import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GiveawayActivation, GiveawayPool } from '@prisma/client';
import { addCalendarMonths, giveawayPremiumCreditCents } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { StripeGiveawayService } from '../stripe/stripe-giveaway.service';
import { ResendService } from '../resend/resend.service';
import { giveawayWinnerTemplate } from '../resend/campaigns/giveaway-templates';

/**
 * Raison d'échec affichable (admin, e-mail, journal) : nos propres messages (refus métier), sinon le
 * seul code de l'erreur. Jamais le message brut d'une erreur Stripe ou Prisma (« No such customer:
 * 'cus_…' », requête recopiée), règle « ne jamais exposer ».
 */
export function safePrizeError(err: unknown): string {
  if (err instanceof HttpException) return err.message;
  const e = err as { type?: unknown; code?: unknown; name?: unknown };
  if (typeof e?.type === 'string' && e.type.startsWith('Stripe')) {
    return `Stripe : ${typeof e.code === 'string' ? e.code : e.type}`;
  }
  return `Erreur interne (${typeof e?.name === 'string' ? e.name : 'inconnue'})`;
}

export interface PrizeResult {
  status: GiveawayActivation;
  error: string | null;
}

/**
 * Attribution d'un lot gagné (PROMPT-tirage-mensuel) :
 * - tirage des gratuits : Premium offert (`UsersService.grantGiveawayPremium`, origine GIVEAWAY) ;
 * - tirage Premium : avoir Stripe sur le solde client (3 mensualités réellement facturées, ou 3/12
 *   du prix annuel), même mécanisme que le mois offert du parrainage, abonnement jamais modifié.
 * Idempotent sur un lot déjà APPLIED ; un lot FAILED peut être relancé (même clé Stripe).
 */
@Injectable()
export class GiveawayPrizeService {
  private readonly logger = new Logger(GiveawayPrizeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly stripe: StripeGiveawayService,
    private readonly resend: ResendService,
    private readonly config: ConfigService,
  ) {}

  async apply(winId: string, now = new Date()): Promise<PrizeResult> {
    const win = await this.prisma.giveawayWin.findUnique({
      where: { id: winId },
      select: {
        id: true, pool: true, prizeMonths: true, activationStatus: true, userId: true,
        user: { select: { email: true, name: true, stripeCustomerId: true } },
      },
    });
    if (!win) return { status: GiveawayActivation.FAILED, error: 'Lot introuvable.' };
    if (win.activationStatus === GiveawayActivation.APPLIED) return { status: GiveawayActivation.APPLIED, error: null };
    if (!win.userId || !win.user) return this.fail(winId, 'Compte du gagnant supprimé.');

    try {
      let startsAt: Date;
      let endsAt: Date;
      let creditCents: number | null = null;
      let stripeBalanceTxId: string | null = null;
      let interval: 'month' | 'year' | null = null;

      if (win.pool === GiveawayPool.FREE) {
        ({ startsAt, endsAt } = await this.users.grantGiveawayPremium(win.userId, win.prizeMonths, now));
      } else {
        if (!win.user.stripeCustomerId) return this.fail(winId, 'Aucun client Stripe.');
        const facts = await this.stripe.billingFacts(win.user.stripeCustomerId);
        if (!facts.chargeCents || !facts.interval) return this.fail(winId, 'Aucune échéance payée lisible chez Stripe.');
        interval = facts.interval;
        creditCents = giveawayPremiumCreditCents(facts.chargeCents, facts.interval);
        if (creditCents <= 0) return this.fail(winId, 'Montant de l’avoir nul.');
        stripeBalanceTxId = await this.stripe.creditGiveaway({
          customerId: win.user.stripeCustomerId, winId, cents: creditCents, months: win.prizeMonths,
        });
        startsAt = now;
        endsAt = addCalendarMonths(now, win.prizeMonths);
      }

      // Écriture conditionnelle : un double lancement ne repasse jamais un lot déjà attribué.
      await this.prisma.giveawayWin.updateMany({
        where: { id: winId, activationStatus: { not: GiveawayActivation.APPLIED } },
        data: {
          activationStatus: GiveawayActivation.APPLIED, activationError: null,
          startsAt, endsAt, creditCents, stripeBalanceTxId,
        },
      });
      await this.sendWinnerEmail(win.user, win.pool, win.prizeMonths, endsAt, interval);
      this.logger.log(`Lot du tirage attribué | lot ${winId}, tirage ${win.pool}`);
      return { status: GiveawayActivation.APPLIED, error: null };
    } catch (err) {
      return this.fail(winId, safePrizeError(err));
    }
  }

  private async fail(winId: string, error: string): Promise<PrizeResult> {
    const message = error.slice(0, 300);
    await this.prisma.giveawayWin
      .updateMany({
        where: { id: winId, activationStatus: { not: GiveawayActivation.APPLIED } },
        data: { activationStatus: GiveawayActivation.FAILED, activationError: message },
      })
      .catch(() => undefined);
    this.logger.warn(`Lot du tirage non attribué | lot ${winId} : ${message}`);
    return { status: GiveawayActivation.FAILED, error: message };
  }

  private async sendWinnerEmail(
    user: { email: string; name: string | null },
    pool: GiveawayPool,
    prizeMonths: number,
    endsAt: Date,
    interval: 'month' | 'year' | null,
  ): Promise<void> {
    const appUrl = this.config.get<string>('FRONTEND_URL') ?? 'https://app.mytradingcoach.app';
    const { subject, html, from, replyTo } = giveawayWinnerTemplate({
      userName: user.name ?? '', appUrl, pool, prizeMonths, endsAt, interval,
    });
    // Transactionnel (le lot est acquis) : jamais filtré par le consentement marketing.
    await this.resend.send({ to: user.email, subject, html, from, replyTo });
  }
}
