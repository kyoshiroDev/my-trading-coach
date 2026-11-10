import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { DEMO_EMAIL, seedDemo, DemoSeedResult } from './demo-seed';
import { demoTodaySlot } from './demo-data/generate';
import { activeSessionWhere } from '../session/active-session';

/** Un seul re-seed à la fois dans tout le cluster (connexions démo simultanées, cron, boot). */
export const DEMO_RESEED_LOCK = 'demo:reseed-lock';
const LOCK_TTL_S = 120;
/** Âge maximal de la position ouverte de la vitrine avant re-seed (marché ouvert, en semaine). */
export const OPEN_TRADE_MAX_AGE_MS = 45 * 60_000;

@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Seed/refresh idempotent du compte démo (admin, cron, connexion démo). */
  async run(reason = 'admin'): Promise<DemoSeedResult> {
    const res = await seedDemo(this.prisma);
    this.logger.log(
      `Compte démo seedé (${reason}) : ${res.trades} trades sur ${res.accounts} comptes · WR net ${res.winRate}% · brut ${res.grossPnl} $ · frais ${res.fees} $ · net ${res.pnl} $ · ${res.redDays}/${res.tradingDays} jours rouges`,
    );
    return res;
  }

  /**
   * Démo absente, sans trade, sans session live pour la journée de trading en cours (la vitrine
   * montre TOUJOURS une session live, même le week-end), ou sans trade depuis le dernier jour ouvré.
   */
  async isStale(now: Date = new Date()): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } });
    if (!user) return true;
    const live = await this.prisma.tradeSession.findFirst({ where: activeSessionWhere(user.id, now), select: { id: true } });
    if (!live) return true;
    // Dernier trade CLÔTURÉ : la position ouverte de la vitrine ne compte pas comme un trade du jour.
    const last = await this.prisma.trade.findFirst({
      where: { userId: user.id, pnl: { not: null } },
      orderBy: { tradedAt: 'desc' },
      select: { tradedAt: true },
    });
    if (!last) return true;
    // En semaine, marché ouvert : la position ouverte de la vitrine a « quelques minutes ». Plus de
    // 45 min (ou aucune) → re-seed à la connexion démo, recalé sur l'heure de la visite. Au plus un
    // re-seed toutes les 45 min : les autres visiteurs connectés gardent des données stables.
    const slot = demoTodaySlot(now);
    const weekday = now.getDay() !== 0 && now.getDay() !== 6;
    if (weekday && slot) {
      const open = await this.prisma.trade.findFirst({
        where: { userId: user.id, pnl: null },
        orderBy: { tradedAt: 'desc' },
        select: { tradedAt: true },
      });
      if (!open || now.getTime() - open.tradedAt.getTime() > OPEN_TRADE_MAX_AGE_MS) return true;
    }
    // Dernière séance attendue : aujourd'hui une fois ouverte, sinon la séance précédente (veille
    // avant 09:45, vendredi le week-end). Avant : avant 09:45 la démo était jugée périmée à
    // chaque connexion (aucun trade du jour possible) et re-seedée à chaque visite.
    const lastTradingDay = new Date(now);
    lastTradingDay.setHours(0, 0, 0, 0);
    if (weekday && !slot) lastTradingDay.setDate(lastTradingDay.getDate() - 1);
    while (lastTradingDay.getDay() === 0 || lastTradingDay.getDay() === 6) {
      lastTradingDay.setDate(lastTradingDay.getDate() - 1);
    }
    return last.tradedAt < lastTradingDay;
  }

  /**
   * Re-seede la démo si elle est périmée. Indépendant des crons : sur dev le worker tourne sans
   * cron (`IS_CRON_WORKER=false`) et la démo y était restée au 2026-06-07 (aucun compte, session
   * ouverte depuis 2 900 h). Appelé à la connexion démo, elle est fraîche pour chaque visiteur.
   * Renvoie `true` si un re-seed a eu lieu. Verrou pris ailleurs → la démo actuelle est servie.
   */
  async ensureFresh(reason: string): Promise<boolean> {
    if (!(await this.isStale())) return false;
    const locked = await this.redis.client.set(DEMO_RESEED_LOCK, '1', 'EX', LOCK_TTL_S, 'NX');
    if (locked !== 'OK') return false;
    try {
      await this.run(reason);
      return true;
    } finally {
      await this.redis.client.del(DEMO_RESEED_LOCK).catch(() => undefined);
    }
  }
}
