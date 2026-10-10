import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
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

/** Lignes supprimées par requête : de courtes transactions, pas un DELETE géant qui verrouille. */
export const RETENTION_BATCH = 5_000;

/** Purge mensuelle des tables qui grossissent sans fin. Worker cron seulement (ScheduleModule). */
@Injectable()
export class RetentionCron {
  private readonly logger = new Logger(RetentionCron.name);

  constructor(private readonly prisma: PrismaService) {}

  // Le 1er du mois, 4 h 30 Paris : après les sauvegardes de 3 h (un dump garde ce qui part).
  @Cron('30 4 1 * *', { timeZone: 'Europe/Paris' })
  async scheduledPurge(): Promise<void> {
    await this.purgeAll();
  }

  async purgeAll(now = new Date()): Promise<Record<string, number>> {
    const deleted: Record<string, number> = {};
    for (const rule of RETENTION_RULES) {
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
