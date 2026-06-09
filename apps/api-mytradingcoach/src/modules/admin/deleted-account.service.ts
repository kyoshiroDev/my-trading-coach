import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

const ANONYMIZE_AFTER_DAYS = 90;
const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

/**
 * Comptes supprimés (trace analytique RGPD).
 * - Anonymisation automatique de l'identité (name/email) après 90 j (cron).
 * - Agrégats pour l'écran admin (durée de vie, motifs, suppressions/mois).
 *
 * Le @Cron ne tourne que sur le worker cron (ScheduleModule gaté par IS_CRON_WORKER) ;
 * les méthodes restent appelables partout (endpoint + déclenchement manuel/test).
 */
@Injectable()
export class DeletedAccountService {
  private readonly logger = new Logger(DeletedAccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  // 00h15 Paris chaque jour — anonymise les traces de plus de 90 jours
  @Cron('15 0 * * *', { timeZone: 'Europe/Paris' })
  async anonymizeDaily(): Promise<void> {
    const count = await this.anonymizeOld();
    if (count > 0) this.logger.log(`🕵️ Anonymisé ${count} compte(s) supprimé(s) (> ${ANONYMIZE_AFTER_DAYS}j)`);
  }

  /** Anonymise (name/email → null) les traces dont la suppression dépasse 90 j. */
  async anonymizeOld(): Promise<number> {
    const cutoff = new Date(Date.now() - ANONYMIZE_AFTER_DAYS * 86_400_000);
    const res = await this.prisma.deletedAccount.updateMany({
      where: { deletedAt: { lt: cutoff }, anonymizedAt: null },
      data: { name: null, email: null, anonymizedAt: new Date() },
    });
    return res.count;
  }

  /** Liste (récents d'abord) + agrégats pour les graphes. */
  async getDeletedAccounts() {
    const accounts = await this.prisma.deletedAccount.findMany({
      orderBy: { deletedAt: 'desc' },
    });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = accounts.filter((a) => a.deletedAt >= startOfMonth).length;

    const lifetimes = accounts.map((a) => a.lifetimeDays).sort((x, y) => x - y);
    const medianLifetimeDays = lifetimes.length ? lifetimes[Math.floor(lifetimes.length / 2)] : 0;

    const noTrade = accounts.filter((a) => !a.hadTraded).length;
    const noTradePct = accounts.length ? Math.round((noTrade / accounts.length) * 100) : 0;

    // Suppressions sur les 6 derniers mois (du plus ancien au plus récent)
    const byMonth: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      byMonth.push({
        month: MONTHS_FR[d.getMonth()],
        count: accounts.filter((a) => a.deletedAt >= d && a.deletedAt < next).length,
      });
    }

    // Motifs de départ (null → "Non renseigné")
    const reasonMap = new Map<string, number>();
    for (const a of accounts) {
      const key = a.reason?.trim() || 'Non renseigné';
      reasonMap.set(key, (reasonMap.get(key) ?? 0) + 1);
    }
    const byReason = [...reasonMap.entries()].map(([reason, count]) => ({ reason, count }));

    return {
      accounts,
      stats: { thisMonth, total: accounts.length, medianLifetimeDays, noTradePct, noTradeCount: noTrade },
      byMonth,
      byReason,
    };
  }
}
