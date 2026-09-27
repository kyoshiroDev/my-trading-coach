import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { VpsService } from '../vps/vps.service';
import { RedisService } from '../infra/redis.service';
import { parisDayRange, todayParis, yesterdayParis } from '@mtc/shared';

const HEALTH_PREFIX = 'health:'; // health:YYYY-MM-DD -> 'ok' | 'incident'
const HEALTH_TTL = 100 * 86_400; // 100 jours (couvre l'affichage 90j)

export type HealthStatus = 'ok' | 'incident' | 'unknown';
export interface HealthPoint {
  date: string;
  status: HealthStatus;
}

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
    private readonly vps: VpsService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 00h05 Paris : CLÔTURE la journée écoulée (idempotent par date).
   *
   * La ligne est datée du jour qu'elle DÉCRIT, pas du jour où le cron tourne.
   * Avant, à 00h05 le 08/08, on comptait les inscrits des dernières 24 h (donc
   * ceux du 07/08) et on rangeait le tout sous « 08/08 » : le graphe admin
   * décalait tout d'un jour (PROMPT-177).
   */
  @Cron('5 0 * * *', { timeZone: 'Europe/Paris' })
  async snapshotDaily(): Promise<void> {
    const snap = await this.takeSnapshot(yesterdayParis());
    const health = await this.recordHealthPoint();
    this.logger.log(
      `📸 Snapshot métriques ${snap.date} : MRR ${snap.mrr}€, ${snap.totalUsers} users, ${snap.activeUsers} actifs · santé VPS: ${health ?? 'inconnue'}`,
    );
  }

  /**
   * Point de santé VPS du jour (uptime 90j) : un check /vps/stats réussi = 'ok',
   * un échec réel = 'incident'. Si le SSH n'est pas configuré → null (jour non
   * enregistré, affiché « pas encore de données »). Stocké en Redis 100 jours.
   */
  async recordHealthPoint(): Promise<HealthStatus | null> {
    let status: HealthStatus | null = null;
    try {
      await this.vps.getStats();
      status = 'ok';
    } catch (e) {
      status = (e as Error)?.message?.includes('VPS_SSH_KEY_B64') ? null : 'incident';
    }
    if (status === null) return null;
    try {
      await this.redisService.client.setex(`${HEALTH_PREFIX}${todayParis()}`, HEALTH_TTL, status);
    } catch {
      // Redis indisponible : non bloquant
    }
    return status;
  }

  /** Statuts de santé des N derniers jours (du plus ancien au plus récent). */
  async healthHistory(days: number): Promise<HealthPoint[]> {
    const n = Math.min(Math.max(Number.isFinite(days) ? days : 90, 1), 365);
    const dates: string[] = []; // plus récent → plus ancien
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      dates.push(new Date(now - i * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }));
    }
    let vals: (string | null)[] = dates.map(() => null);
    try {
      vals = await this.redisService.client.mget(...dates.map((d) => `${HEALTH_PREFIX}${d}`));
    } catch {
      // Redis indisponible → tout "unknown"
    }
    return dates
      .map((date, i): HealthPoint => ({ date, status: (vals[i] as HealthStatus) ?? 'unknown' }))
      .reverse();
  }

  /**
   * Calcule et upsert le snapshot d'une journée. Réutilise adminStats() (MRR/compteurs).
   *
   * @param targetDay journée décrite (YYYY-MM-DD Paris). Défaut : aujourd'hui, pour
   *   le déclenchement manuel « photo maintenant ». Le cron passe la veille, qu'il
   *   clôture. `newThisDay` compte les inscrits de CETTE journée calendaire, plus
   *   une fenêtre glissante de 24 h : c'est ce qui garantit que la barre du graphe
   *   tombe le bon jour.
   */
  async takeSnapshot(targetDay?: string) {
    const date = targetDay ?? todayParis();
    const { start, end } = parisDayRange(date);
    const stats = await this.users.adminStats();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

    // totalUsers vient d'adminStats() (source unique) → snapshot et KPI live concordent.
    const [activeUsers, newThisDay] = await Promise.all([
      this.prisma.user.count({
        where: { isDemo: false, role: { not: Role.ADMIN }, trades: { some: { tradedAt: { gte: sevenDaysAgo } } } },
      }),
      this.prisma.user.count({
        where: {
          isDemo: false,
          role: { not: Role.ADMIN },
          createdAt: { gte: start, lt: end },
        },
      }),
    ]);

    const data = {
      mrr: stats.mrr,
      arr: stats.arr,
      totalUsers: stats.totalUsers,
      freeUsers: stats.freeUsers,
      starterUsers: 0, // palier STARTER supprimé (PROMPT-169) ; colonne conservée pour l'historique
      premiumUsers: stats.totalPremium,
      trials: stats.trials,
      newThisDay,
      activeUsers,
      betaTesters: stats.betaTesters,
      ambassadors: stats.ambassadors,
    };

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

  /**
   * Série allégée pour les courbes d'évolution du dashboard (date, users, mrr),
   * du plus ancien au plus récent. Lit les snapshots persistés (zéro recalcul).
   */
  async historyPoints(days: number): Promise<MetricsHistoryPoint[]> {
    const rows = await this.history(days);
    return rows.map((r) => ({ date: r.date, users: r.totalUsers, mrr: r.mrr, newSignups: r.newThisDay }));
  }
}

/** Point de la courbe d'évolution MRR & utilisateurs. */
export interface MetricsHistoryPoint {
  date: string; // YYYY-MM-DD (Paris)
  users: number;
  mrr: number;
  newSignups: number; // inscrits de CETTE journée calendaire (snapshot.newThisDay)
}
