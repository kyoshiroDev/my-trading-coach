import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { todayParis } from '../../common/utils/paris-date';

/**
 * Historise chaque jour les métriques clés (MRR, users par plan, actifs…) dans
 * MetricsSnapshot → fondation des courbes d'évolution de l'admin.
 *
 * Le @Cron ne s'exécute que sur le worker cron (ScheduleModule gaté par
 * IS_CRON_WORKER, app.module). Les méthodes takeSnapshot()/history() restent
 * appelables sur n'importe quel worker (déclenchement manuel + endpoint).
 */
@Injectable()
export class MetricsSnapshotCron {
  private readonly logger = new Logger(MetricsSnapshotCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  // 00h05 Paris chaque jour — snapshot du jour (idempotent par date)
  @Cron('5 0 * * *', { timeZone: 'Europe/Paris' })
  async snapshotDaily(): Promise<void> {
    const snap = await this.takeSnapshot();
    this.logger.log(
      `📸 Snapshot métriques ${snap.date} — MRR ${snap.mrr}€, ${snap.totalUsers} users, ${snap.activeUsers} actifs`,
    );
  }

  /** Calcule et upsert le snapshot du jour. Réutilise adminStats() (MRR/compteurs). */
  async takeSnapshot() {
    const stats = await this.users.adminStats();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const oneDayAgo = new Date(Date.now() - 86_400_000);

    const [totalUsers, activeUsers, newThisDay] = await Promise.all([
      this.prisma.user.count({ where: { isDemo: false } }),
      this.prisma.user.count({
        where: { isDemo: false, trades: { some: { tradedAt: { gte: sevenDaysAgo } } } },
      }),
      this.prisma.user.count({ where: { isDemo: false, createdAt: { gte: oneDayAgo } } }),
    ]);

    const data = {
      mrr: stats.mrr,
      arr: stats.arr,
      totalUsers,
      freeUsers: stats.freeUsers,
      starterUsers: stats.totalStarter,
      premiumUsers: stats.totalPremium,
      trials: stats.trials,
      newThisDay,
      activeUsers,
      betaTesters: stats.betaTesters,
      ambassadors: stats.ambassadors,
    };

    const date = todayParis();
    return this.prisma.metricsSnapshot.upsert({
      where: { date },
      create: { date, ...data },
      update: data,
    });
  }

  /** Les N derniers snapshots, du plus ancien au plus récent (pour les courbes). */
  async history(days: number) {
    const take = Math.min(Math.max(Number.isFinite(days) ? days : 30, 1), 365);
    const rows = await this.prisma.metricsSnapshot.findMany({
      orderBy: { date: 'desc' },
      take,
    });
    return rows.reverse();
  }
}
