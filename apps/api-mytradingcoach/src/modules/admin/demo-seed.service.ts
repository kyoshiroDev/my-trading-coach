import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { DEMO_EMAIL, seedDemo, DemoSeedResult } from './demo-seed';
import { dayAt, demoTodaySlot } from './demo-data/generate';

/** Un seul re-seed à la fois dans tout le cluster (connexions démo simultanées, cron, boot). */
export const DEMO_RESEED_LOCK = 'demo:reseed-lock';
const LOCK_TTL_S = 120;

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

  /** Démo absente, sans trade, ou sans trade depuis le dernier jour ouvré (aujourd'hui, ou vendredi le week-end). */
  async isStale(now: Date = new Date()): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } });
    if (!user) return true;
    const last = await this.prisma.trade.findFirst({
      where: { userId: user.id },
      orderBy: { tradedAt: 'desc' },
      select: { tradedAt: true },
    });
    if (!last) return true;
    // Une séance du jour s'est ouverte depuis le dernier seed (ex. seed de 03:20, visite à 11:00) :
    // re-seed pour la montrer, aux heures de marché.
    const slot = demoTodaySlot(now);
    const weekday = now.getDay() !== 0 && now.getDay() !== 6;
    if (weekday && slot) {
      const [h, m] = slot.trades[slot.trades.length - 1];
      if (last.tradedAt < dayAt(now, 0, h, m)) return true;
    }
    const lastTradingDay = new Date(now);
    lastTradingDay.setHours(0, 0, 0, 0);
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
