import { Injectable, Logger, Optional } from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { effectiveEmotion } from '../../common/utils/effective-emotion.util';
import { computeTradeStats, netPnl } from '@mtc/shared';
import { userAmountsCurrency } from '../../common/utils/user-currency.util';
import { PropRiskContextService } from '../accounts/prop-risk-context';
import { demoAccountIds, excludeAccountsWhere } from '../accounts/demo-accounts';
import { IMPORT_SETUP_TITLE } from '../setups/setups.service';

@Injectable()
export class DailyRecapService {
  private readonly logger = new Logger(DailyRecapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    /** Bloc « prop firm » du prompt (#374) ; optionnel pour garder les tests légers. */
    @Optional() private readonly propRisk?: PropRiskContextService,
  ) {}

  async generateRecap(userId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Comptes d'entraînement exclus du récap : P&L, stats et coaching (cf. demo-accounts).
    const demoIds = await demoAccountIds(this.prisma, userId);
    const trades = await this.prisma.trade.findMany({
      where: {
        userId,
        tradedAt: { gte: startOfDay, lte: endOfDay },
        pnl: { not: null },
        ...excludeAccountsWhere(demoIds),
      },
      select: {
        asset: true,
        side: true,
        pnl: true,
        commission: true, // stats sur le net
        emotion: true,
        // Humeur de la journée → émotion effective quand le trade n'a pas d'override.
        tradeSession: { select: { moodStart: true } },
        setup: { select: { title: true } },
        // Compte de chaque trade : sans lui, l'IA attribuait un trade au mauvais compte.
        accountId: true,
        account: { select: { label: true } },
        session: true,
        timeframe: true,
        entry: true,
        exit: true,
        stopLoss: true,
        takeProfit: true,
        tradedAt: true,
      },
      orderBy: { tradedAt: 'asc' },
    });

    if (trades.length === 0) return null;

    // Win rate via le helper unique (BE exclus du dénominateur).
    const stats = computeTradeStats(trades);
    const pnl = stats.totalPnl;
    const winRate = stats.winRate;

    // Émotion dominante sur les émotions EFFECTIVES non renseignées exclues (plus de NEUTRAL forcé).
    const emotionMap = new Map<string, number>();
    trades.forEach((t) => {
      const e = effectiveEmotion(t);
      if (e) emotionMap.set(e, (emotionMap.get(e) ?? 0) + 1);
    });
    const dominantEmotion =
      [...emotionMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    let aiOneLiner: string | null = null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        plan: true,
        market: true,
        goal: true,
        tradingStyle: true,
        tradingStrategy: true,
        tradingSessions: true,
        tradesPerDayMin: true,
        tradesPerDayMax: true,
        strategyDescription: true,
      },
    });

    // Recap IA = PREMIUM only (le cron ne sélectionne que les users PREMIUM).
    if (user?.plan === Plan.PREMIUM && trades.length >= 3) {
      const sevenDaysAgo = new Date(date);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentTrades = await this.prisma.trade.findMany({
        where: {
          userId,
          tradedAt: { gte: sevenDaysAgo, lt: startOfDay },
          pnl: { not: null },
          ...excludeAccountsWhere(demoIds),
        },
        select: { asset: true, side: true, pnl: true, commission: true, session: true },
      });

      const patternMap = new Map<string, { wins: number; total: number; pnl: number }>();
      for (const t of recentTrades) {
        const key = `${t.side}_${t.asset}`;
        const existing = patternMap.get(key) ?? { wins: 0, total: 0, pnl: 0 };
        const net = netPnl(t) ?? 0;
        existing.total++;
        existing.pnl += net;
        if (net > 0) existing.wins++;
        patternMap.set(key, existing);
      }

      const sessionMap = new Map<string, { wins: number; total: number; pnl: number }>();
      for (const t of recentTrades) {
        const key = t.session ?? 'UNKNOWN';
        const existing = sessionMap.get(key) ?? { wins: 0, total: 0, pnl: 0 };
        const net = netPnl(t) ?? 0;
        existing.total++;
        existing.pnl += net;
        if (net > 0) existing.wins++;
        sessionMap.set(key, existing);
      }

      // Séance prop firm vue en direct (marges, alertes, tilt) : faits déjà calculés (#374).
      // Limité aux comptes tradés ce jour : un compte cassé il y a deux jours et pas tradé
      // aujourd'hui passait pour la casse du jour (récap de Val, 2026-10-09).
      const tradedAccountIds = [...new Set(trades.map((t) => t.accountId).filter((id): id is string => !!id))];
      const propContext = (await this.propRisk?.forDay(userId, date, tradedAccountIds).catch((err: unknown) => {
        this.logger.warn(`Contexte prop firm ignoré : ${(err as Error).message}`);
        return null;
      })) ?? null;

      try {
        aiOneLiner = await this.ai.generateDailyOneLiner({
          propContext,
          userId,
          // setup (relation) → titre string attendu par generateDailyOneLiner.
          // Setup par défaut des trades importés (« Sans setup ») = non renseigné, pas un choix :
          // l'IA en concluait « ouvert sans setup » sur chaque journée synchronisée.
          trades: trades.map(({ account, ...t }) => ({
            ...t,
            account: account?.label,
            setup: t.setup?.title && t.setup.title !== IMPORT_SETUP_TITLE ? t.setup.title : undefined,
          })),
          pnl,
          winRate,
          // Émotion effective dominante (null = non renseignée) : plus de NEUTRAL forcé.
          dominantEmotion,
          date,
          currency: await userAmountsCurrency(this.prisma, userId),
          userProfile: user
            ? {
                market: user.market,
                goal: user.goal,
                tradingStyle: user.tradingStyle,
                tradingStrategy: user.tradingStrategy,
                tradingSessions: user.tradingSessions,
                tradesPerDayMin: user.tradesPerDayMin,
                tradesPerDayMax: user.tradesPerDayMax,
                strategyDescription: user.strategyDescription,
              }
            : undefined,
          patterns7d: {
            bySidePair: Object.fromEntries(patternMap),
            bySession: Object.fromEntries(sessionMap),
          },
        });
      } catch (err) {
        this.logger.warn(`Daily oneliner skipped: ${(err as Error).message}`);
      }
    }

    return this.prisma.dailyRecap.upsert({
      where: { userId_date: { userId, date: startOfDay } },
      create: {
        userId,
        date: startOfDay,
        tradesCount: trades.length,
        pnl,
        winRate,
        dominantEmotion,
        aiOneLiner,
      },
      update: {
        tradesCount: trades.length,
        pnl,
        winRate,
        dominantEmotion,
        aiOneLiner,
        generatedAt: new Date(),
      },
    });
  }

  async getYesterdayRecap(userId: string, isPremium = false) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const recap = await this.prisma.dailyRecap.findUnique({
      where: { userId_date: { userId, date: yesterday } },
    });

    if (!recap || isPremium) return recap;
    return { ...recap, aiOneLiner: null };
  }
}
