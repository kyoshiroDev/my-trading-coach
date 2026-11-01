import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FounderSeatStatus, PartnerRedemptionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';

const DAY_MS = 24 * 3600 * 1000;

/**
 * Durées de conservation (SCA-B5-09, décision du 2026-10-07). Liste FIGÉE : les noms de table et
 * de colonne entrent tels quels dans le SQL, ils ne viennent jamais d'une saisie.
 * `EmailSend` n'y est volontairement PAS : c'est l'anti-doublon des campagnes « une seule fois ».
 */
export const RETENTION_RULES = [
  { table: 'MarketNews', column: 'publishedDate', days: 30 },
  { table: 'StripeEvent', column: 'processedAt', days: 90 },
  { table: 'AiUsageLog', column: 'createdAt', days: 396 }, // 13 mois
  { table: 'UserDailyActivity', column: 'date', days: 730 }, // 24 mois
] as const;

/**
 * Purge QUOTIDIENNE (décision du 2026-10-25) : événements d'usage rattachés au compte, 13 mois
 * (politique de confidentialité, « 13 mois, puis effacement automatique »). Quotidienne pour qu'une
 * ligne ne dépasse jamais 13 mois d'un jour, là où la purge mensuelle laisserait un mois de plus.
 */
export const DAILY_RETENTION_RULES = [
  { table: 'ProductEventDaily', column: 'date', days: 396 }, // 13 mois
] as const;

/** Lignes supprimées par requête : de courtes transactions, pas un DELETE géant qui verrouille. */
export const RETENTION_BATCH = 5_000;

/**
 * Identifiant d'abonnement Stripe des places fondateur et remises partenaire sans compte (#826) :
 * effacé 180 jours après la fin (`endedAt`), le temps des litiges tardifs. Jamais à la suppression
 * du compte ni dans le webhook : `releaseUnpaid`, `markLost` et `PartnerCodeService.end` retrouvent
 * la ligne par cet identifiant tant qu'elle est ACTIVE.
 */
export const STRIPE_IDS_RETENTION_DAYS = 180;

export interface StripeIdsDetachReport {
  /** Identifiants effacés (sans compte, terminée depuis plus de 180 jours). */
  cleared: number;
  /** Sans compte, terminée mais sans date de fin : laissée telle quelle, à examiner. */
  missingEndedAt: number;
  /** Encore ACTIVE sans compte (webhook de fin jamais traité) : jamais effacée, à examiner. */
  activeWithoutAccount: number;
}

/** Purges mensuelle et quotidienne des tables qui grossissent sans fin. Worker cron seulement (ScheduleModule). */
@Injectable()
export class RetentionCron {
  private readonly logger = new Logger(RetentionCron.name);

  constructor(private readonly prisma: PrismaService) {}

  // Le 1er du mois, 4 h 30 Paris : après les sauvegardes de 3 h (un dump garde ce qui part).
  @Cron('30 4 1 * *', { timeZone: 'Europe/Paris' })
  async scheduledPurge(): Promise<void> {
    await this.purgeAll();
    await this.detachStripeIds().catch((err: unknown) =>
      this.logger.error(`Rétention des identifiants Stripe en échec : ${(err as Error).message}`),
    );
  }

  // Chaque jour, 4 h 45 Paris : après les sauvegardes de 3 h et la purge mensuelle de 4 h 30.
  @Cron('45 4 * * *', { timeZone: 'Europe/Paris' })
  async scheduledDailyPurge(): Promise<void> {
    await this.purgeAll(new Date(), DAILY_RETENTION_RULES);
  }

  async purgeAll(
    now = new Date(),
    rules: readonly { table: string; column: string; days: number }[] = RETENTION_RULES,
  ): Promise<Record<string, number>> {
    const deleted: Record<string, number> = {};
    for (const rule of rules) {
      try {
        deleted[rule.table] = await this.purge(rule.table, rule.column, new Date(now.getTime() - rule.days * DAY_MS));
      } catch (err) {
        // Une table en échec ne prive pas les suivantes.
        this.logger.error(`Rétention ${rule.table} en échec : ${(err as Error).message}`);
      }
    }
    this.logger.log(`Rétention : ${Object.entries(deleted).map(([t, n]) => `${t} ${n}`).join(' · ')} ligne(s) supprimée(s)`);
    return deleted;
  }

  /**
   * Efface `stripeSubscriptionId` des places et remises sans compte (`userId` nul), terminées
   * (statut ≠ ACTIVE) depuis plus de 180 jours. Une ligne ACTIVE sans compte ou terminée sans date
   * de fin n'est jamais touchée : elle est seulement comptée et signalée. Une place RELEASED d'un
   * compte vivant (`releaseUnpaid` détache la place) suit la même règle : aucune recherche ne vise
   * une ligne terminée, et le compte garde son propre lien Stripe.
   */
  async detachStripeIds(now = new Date()): Promise<{ founderSeats: StripeIdsDetachReport; partnerRedemptions: StripeIdsDetachReport }> {
    const before = new Date(now.getTime() - STRIPE_IDS_RETENTION_DAYS * DAY_MS);
    const orphan = { userId: null, stripeSubscriptionId: { not: null } } as const;

    const [seatsCleared, seatsMissingEnd, seatsActive] = await Promise.all([
      this.prisma.founderSeat.updateMany({
        where: { ...orphan, status: { not: FounderSeatStatus.ACTIVE }, endedAt: { lt: before } },
        data: { stripeSubscriptionId: null },
      }),
      this.prisma.founderSeat.count({ where: { ...orphan, status: { not: FounderSeatStatus.ACTIVE }, endedAt: null } }),
      this.prisma.founderSeat.count({ where: { userId: null, status: FounderSeatStatus.ACTIVE } }),
    ]);
    const [redemptionsCleared, redemptionsMissingEnd, redemptionsActive] = await Promise.all([
      this.prisma.partnerRedemption.updateMany({
        where: { ...orphan, status: { not: PartnerRedemptionStatus.ACTIVE }, endedAt: { lt: before } },
        data: { stripeSubscriptionId: null },
      }),
      this.prisma.partnerRedemption.count({ where: { ...orphan, status: { not: PartnerRedemptionStatus.ACTIVE }, endedAt: null } }),
      this.prisma.partnerRedemption.count({ where: { userId: null, status: PartnerRedemptionStatus.ACTIVE } }),
    ]);

    const report = {
      founderSeats: { cleared: seatsCleared.count, missingEndedAt: seatsMissingEnd, activeWithoutAccount: seatsActive },
      partnerRedemptions: {
        cleared: redemptionsCleared.count, missingEndedAt: redemptionsMissingEnd, activeWithoutAccount: redemptionsActive,
      },
    };
    const line = (name: string, r: StripeIdsDetachReport) =>
      `${name} ${r.cleared} effacé(s), ${r.missingEndedAt} sans date de fin, ${r.activeWithoutAccount} ACTIVE sans compte`;
    const text = `Identifiants Stripe sans compte : ${line('places', report.founderSeats)} · ${line('remises', report.partnerRedemptions)}`;
    const anomalies =
      report.founderSeats.missingEndedAt + report.founderSeats.activeWithoutAccount +
      report.partnerRedemptions.missingEndedAt + report.partnerRedemptions.activeWithoutAccount;
    if (anomalies > 0) this.logger.warn(`${text} (lignes à examiner, non effacées)`);
    else this.logger.log(text);
    return report;
  }

  private async purge(table: string, column: string, before: Date): Promise<number> {
    const t = Prisma.raw(`"${table}"`);
    const c = Prisma.raw(`"${column}"`);
    let total = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM ${t} WHERE id IN (SELECT id FROM ${t} WHERE ${c} < ${before} LIMIT ${RETENTION_BATCH})`;
      total += n;
      if (n < RETENTION_BATCH) return total;
    }
  }
}
