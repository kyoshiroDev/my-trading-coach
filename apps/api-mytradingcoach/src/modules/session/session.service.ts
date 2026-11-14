import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrokerProvider, MoodState, Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AccountsService } from '../accounts/accounts.service';
import { inactiveAccountsSessionWhere } from '../accounts/account-status-scope';
import { AnalyticsService } from '../analytics/analytics.service';
import { computeTradeStats, toParisDateStr } from '@mtc/shared';
import type { LiveBrokerState, SessionHistoryItem } from '@mtc/shared';
import { openPositionsKey, parseOpenPositions } from '../integrations/tradovate/tradovate-open-positions';
import { parseWorkingOrders, protectionFor, workingOrdersKey } from '../integrations/tradovate/tradovate-orders';
import { activeSessionWhere, tradingDayEnd, tradingDayStart } from './active-session';
import { autoCloseData, sessionTotalsFrom } from './session-totals';
import { calculatePnl } from '../trades/trade-metrics.util';
import { refreshClosedSessionTotals, sessionTradesFor } from './refresh-session-totals';
import type { CreateTradeDto } from '../trades/dto/create-trade.dto';

// Forme de GET /session/history : contrat partagé avec le front (@mtc/shared).
export type { SessionHistoryItem };

@Injectable()
export class SessionService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly accounts: AccountsService,
    private readonly analytics: AnalyticsService,
  ) {}

  async startSession(userId: string, mood: MoodState, accountId?: string) {
    await this.closeOpenSessions(userId);

    // accountId fourni et valide (appartient au user) → on l'utilise ; sinon compte
    // par défaut (anti-NULL : jamais de session sans compte).
    let resolvedAccountId: string;
    if (accountId && accountId !== 'all') {
      const owned = (await this.accounts.accountWhere(userId, accountId)).accountId;
      resolvedAccountId = owned ?? (await this.accounts.ensureDefaultAccountId(userId));
    } else {
      resolvedAccountId = await this.accounts.ensureDefaultAccountId(userId);
    }

    const session = await this.prisma.tradeSession.create({
      data: {
        userId,
        moodStart: mood,
        status: SessionStatus.ACTIVE,
        accountId: resolvedAccountId,
      },
    });

    await this.redisService.client
      .setex(`session:active:${userId}`, 60 * 60 * 24, session.id)
      .catch(() => null);

    return session;
  }

  async getActiveSession(userId: string) {
    return this.prisma.tradeSession.findFirst({
      where: activeSessionWhere(userId),
      include: { _count: { select: { trades: true } } },
    });
  }

  /**
   * Session du jour : l'active, sinon la dernière clôturée aujourd'hui avec ses trades.
   * Sans ça, une session clôturée disparaissait au rechargement de la page (onglet mis en
   * arrière-plan sur mobile, choix d'image pour « Publier ») : retour sur la Pré-session,
   * « Démarrer » et session vide parasite (#456).
   */
  async getTodaySession(userId: string) {
    const active = await this.getActiveSession(userId);
    if (active) return active;

    // « Aujourd'hui » = journée de trading CME (17:00 Chicago), comme la session active.
    return this.prisma.tradeSession.findFirst({
      where: { userId, status: SessionStatus.CLOSED, startedAt: { gte: tradingDayStart(new Date()) } },
      orderBy: { endedAt: 'desc' },
      include: {
        _count: { select: { trades: true } },
        trades: { orderBy: { tradedAt: 'desc' } },
      },
    });
  }

  async closeSession(
    userId: string,
    sessionId: string,
    mood: MoodState,
    notes?: string,
    reflectionNote?: string,
    reflectionQuestion?: string,
  ) {
    const existing = await this.prisma.tradeSession.findFirst({
      where: { id: sessionId, userId },
      select: { startedAt: true, accountId: true },
    });
    if (!existing) throw new NotFoundException('Session introuvable');
    // 1 session = 1 compte : les trades d'un autre compte n'y entrent pas (#457).
    const sameAccount = existing.accountId ? { accountId: existing.accountId } : {};

    // Fenêtre = journée de trading CME de la session (même base que getTodayTrades et la session active)
    const dayStart = tradingDayStart(existing.startedAt);
    const dayEnd = tradingDayEnd(existing.startedAt);

    // Rattacher les trades du jour encore non liés à cette session
    await this.prisma.trade.updateMany({
      where: { userId, sessionId: null, tradedAt: { gte: dayStart, lt: dayEnd }, ...sameAccount },
      data: { sessionId },
    });

    const totals = await this.sessionTotals(userId, sessionId, sameAccount);

    const session = await this.prisma.tradeSession.update({
      where: { id: sessionId, userId },
      data: {
        status: SessionStatus.CLOSED,
        endedAt: new Date(),
        moodEnd: mood,
        ...totals,
        notes,
        reflectionNote,
        reflectionQuestion,
      },
    });

    await this.redisService.client.del(`session:active:${userId}`).catch(() => null);
    return session;
  }

  /** Totaux d'une session calculés sur SES trades (cf. `sessionTotalsFrom`). */
  private async sessionTotals(userId: string, sessionId: string, sameAccount: { accountId?: string }) {
    return sessionTotalsFrom(await this.sessionTrades(userId, sessionId, sameAccount));
  }

  private sessionTrades(userId: string, sessionId: string, sameAccount: { accountId?: string }) {
    return sessionTradesFor(this.prisma, userId, sessionId, sameAccount.accountId ?? null);
  }

  /**
   * Séances encore ouvertes au démarrage d'une nouvelle (#994) : clôturées AVEC leurs totaux, sinon
   * `totalTrades` restait à 0 et la séance disparaissait de l'historique. Séance d'une journée
   * précédente = comme le cron (fin de SA journée) ; séance du jour (autre appareil) = maintenant.
   */
  private async closeOpenSessions(userId: string, now = new Date()): Promise<void> {
    const open = await this.prisma.tradeSession.findMany({
      where: { userId, status: SessionStatus.ACTIVE },
      select: { id: true, accountId: true, startedAt: true },
    });
    for (const s of open) {
      const trades = await this.sessionTrades(userId, s.id, s.accountId ? { accountId: s.accountId } : {});
      const data =
        s.startedAt < tradingDayStart(now)
          ? autoCloseData(s.startedAt, trades)
          : { status: SessionStatus.CLOSED, endedAt: now, ...sessionTotalsFrom(trades) };
      await this.prisma.tradeSession.updateMany({ where: { id: s.id, status: SessionStatus.ACTIVE }, data });
    }
  }

  /**
   * Bascule de la journée de trading CME (SessionCloseCron, 17:05 Chicago) : clôture les sessions
   * restées ouvertes d'une journée précédente — exactement celles que `activeSessionWhere` ne
   * renvoie plus. Fermées à la fin de leur journée, totaux sur leurs propres trades, sans humeur
   * de fin (non déclarée). Comptes démo exclus.
   */
  async closeStaleSessions(now = new Date()): Promise<number> {
    const stale = await this.prisma.tradeSession.findMany({
      where: { status: SessionStatus.ACTIVE, startedAt: { lt: tradingDayStart(now) }, user: { isDemo: false } },
      select: { id: true, userId: true, accountId: true, startedAt: true },
    });
    let closed = 0;
    for (const s of stale) {
      const trades = await this.sessionTrades(s.userId, s.id, s.accountId ? { accountId: s.accountId } : {});
      // `status: ACTIVE` dans le where : une clôture manuelle entre-temps n'est pas écrasée.
      const { count } = await this.prisma.tradeSession.updateMany({
        where: { id: s.id, status: SessionStatus.ACTIVE },
        data: autoCloseData(s.startedAt, trades),
      });
      if (count > 0) {
        closed++;
        await this.redisService.client.del(`session:active:${s.userId}`).catch(() => null);
      }
    }
    return closed;
  }

  async updateSession(
    userId: string,
    sessionId: string,
    data: { planNote?: string; marketContext?: string; notes?: string; reflectionNote?: string; moodEnd?: MoodState },
  ) {
    // Champs recopiés un par un : même si l'appelant passe un objet plus large,
    // seules ces colonnes peuvent être écrites.
    const { planNote, marketContext, notes, reflectionNote, moodEnd } = data;
    return this.prisma.tradeSession.update({
      where: { id: sessionId, userId },
      data: { planNote, marketContext, notes, reflectionNote, moodEnd },
    });
  }

  async getSessionHistory(
    userId: string,
    limit = 50,
    offset = 0,
    filter?: { year?: number; month?: number; accountId?: string; includeInactive?: boolean },
  ): Promise<SessionHistoryItem[]> {
    const where: Prisma.TradeSessionWhereInput = {
      userId,
      status: SessionStatus.CLOSED,
      totalTrades: { gt: 0 },
      // Compte perdu : séances des comptes échoués et archivés hors de « tous les comptes »
      // (visibles en choisissant le compte, ou avec includeInactive), comme le journal.
      ...inactiveAccountsSessionWhere({
        accountId: filter?.accountId && filter.accountId !== 'all' ? filter.accountId : undefined,
        includeInactive: filter?.includeInactive === true,
      }),
    };

    if (filter?.accountId && filter.accountId !== 'all') {
      where.accountId = filter.accountId;
    }

    if (filter?.year && filter?.month) {
      const from = new Date(filter.year, filter.month - 1, 1);
      const to = new Date(filter.year, filter.month, 0, 23, 59, 59, 999);
      where.startedAt = { gte: from, lte: to };
    }

    const rows = await this.prisma.tradeSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      // Bornes (#994) : un `skip` négatif faisait un 500, un `limit` sans plafond chargeait tout.
      skip: Math.max(0, offset),
      take: Math.min(Math.max(1, limit), 200),
      select: {
        id: true,
        accountId: true,
        startedAt: true,
        endedAt: true,
        moodStart: true,
        moodEnd: true,
        totalPnl: true,
        totalTrades: true,
        winRate: true,
        notes: true,
        reflectionNote: true,
        reflectionQuestion: true,
        planNote: true,
        marketContext: true,
        maxDrawdown: true,
        bestTradePnl: true,
        bestTradeAsset: true,
        trades: { select: { asset: true, pnl: true, commission: true } },
      },
    });

    const oneLiners = await this.oneLinersByParisDay(userId, rows.map((row) => row.startedAt));

    return rows.map((row) => {
      const assetCount = new Map<string, number>();
      for (const t of row.trades) {
        assetCount.set(t.asset, (assetCount.get(t.asset) ?? 0) + 1);
      }
      const topAssets = [...assetCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([asset]) => asset);
      // Gains / pertes pour le win rate de la page Sessions pondéré par les trades (#947).
      const { wins, losses } = computeTradeStats(row.trades);

      return {
        id: row.id,
        accountId: row.accountId,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt?.toISOString(),
        moodStart: row.moodStart,
        moodEnd: row.moodEnd,
        totalPnl: row.totalPnl,
        totalTrades: row.totalTrades,
        winRate: row.winRate,
        notes: row.notes,
        reflectionNote: row.reflectionNote,
        reflectionQuestion: row.reflectionQuestion,
        planNote: row.planNote,
        marketContext: row.marketContext,
        maxDrawdown: row.maxDrawdown,
        bestTradePnl: row.bestTradePnl,
        bestTradeAsset: row.bestTradeAsset,
        topAssets,
        wins,
        losses,
        aiOneLiner: oneLiners.get(toParisDateStr(row.startedAt)) ?? null,
      };
    });
  }

  /**
   * Résumés IA des récaps quotidiens couvrant ces sessions, par jour Paris (YYYY-MM-DD).
   * Une seule requête pour toute la page (pas de requête par session).
   */
  private async oneLinersByParisDay(userId: string, startedAts: Date[]): Promise<Map<string, string>> {
    if (startedAts.length === 0) return new Map();
    const times = startedAts.map((d) => d.getTime());
    const DAY_MS = 86_400_000;
    const recaps = await this.prisma.dailyRecap.findMany({
      where: {
        userId,
        aiOneLiner: { not: null },
        date: { gte: new Date(Math.min(...times) - DAY_MS), lte: new Date(Math.max(...times) + DAY_MS) },
      },
      select: { date: true, aiOneLiner: true },
    });
    return new Map(recaps.map((r) => [toParisDateStr(r.date), r.aiOneLiner as string]));
  }

  async getSessionDetail(userId: string, sessionId: string) {
    const session = await this.prisma.tradeSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        trades: { orderBy: { tradedAt: 'desc' } },
      },
    });
    if (!session) throw new NotFoundException('Session introuvable');
    return session;
  }

  async getTodayTrades(userId: string) {
    // Journée de trading CME (17:00 Chicago), pas minuit serveur : même borne que la session active.
    const startOfDay = tradingDayStart(new Date());

    // 1 session = 1 compte : pendant une session, seuls les trades de son compte comptent
    // (un trade synchronisé sur un autre compte gonflait le P&L de la carte, #457).
    const active = await this.prisma.tradeSession.findFirst({
      where: activeSessionWhere(userId),
      select: { id: true, accountId: true },
    });

    return this.prisma.trade.findMany({
      where: {
        userId,
        // Trades du jour, plus un trade ENCORE OUVERT rattaché à la session active même s'il a été
        // ouvert avant le début de la journée (position gardée) : sinon « Trade en cours » le perdait à la bascule.
        OR: [
          { tradedAt: { gte: startOfDay } },
          ...(active ? [{ sessionId: active.id, pnl: null }] : []),
        ],
        ...(active?.accountId ? { accountId: active.accountId } : {}),
      },
      orderBy: { tradedAt: 'desc' },
    });
  }

  async getLiveStats(userId: string) {
    const [todayTrades, broker] = await Promise.all([
      this.getTodayTrades(userId),
      this.getLiveBrokerState(userId),
    ]);
    // Stats via le helper unique (BE exclus du win rate).
    const stats = computeTradeStats(todayTrades);

    return {
      totalPnl: stats.totalPnl,
      winRate: stats.winRate,
      tradesCount: todayTrades.length,
      closedCount: stats.closed,
      trades: todayTrades,
      broker,
    };
  }

  /**
   * Positions ouvertes et latent du compte de la session active, lus chez le broker (Tradovate).
   * Le `Trade` n'existe qu'à la sortie : sans ça, une position ouverte était invisible et le total
   * MTC (réalisé seul) ne pouvait pas coïncider avec celui du broker (réalisé + latent).
   */
  private async getLiveBrokerState(userId: string): Promise<LiveBrokerState | null> {
    const active = await this.prisma.tradeSession.findFirst({
      where: activeSessionWhere(userId),
      select: { accountId: true },
    });
    if (!active?.accountId) return null;
    const conn = await this.prisma.brokerConnection.findFirst({
      where: { accountId: active.accountId, provider: BrokerProvider.TRADOVATE, account: { userId } },
      select: { id: true, brokerOpenPnl: true, brokerEquityAt: true, brokerOpenPositions: true },
    });
    if (!conn) return null;

    const [raw, rawOrders] = await Promise.all([
      this.redisService.client.get(openPositionsKey(conn.id)).catch(() => null),
      this.redisService.client.get(workingOrdersKey(conn.id)).catch(() => null),
    ]);
    const state = parseOpenPositions(raw);
    // Ordres actifs tenus par le WebSocket (app ouverte) : SL / TP de chaque position, ou null.
    const orders = parseWorkingOrders(rawOrders)?.orders ?? [];
    // « À plat » = compteur en base, la même règle que le suivi du compte (`accounts.service`) :
    // les deux panneaux de la session live doivent dire la même chose. Redis ne donne que le détail.
    const flat = conn.brokerOpenPositions === 0;
    const openPositions = flat
      ? []
      : (state?.positions ?? []).map(({ contractId, ...p }) => ({
          ...p,
          ...protectionFor({ contractId, side: p.side, entryPrice: p.entryPrice }, orders),
        }));
    return {
      openPositions,
      positionsAt: state?.at ?? null,
      openPnl: flat ? 0 : conn.brokerOpenPnl,
      openPnlAt: conn.brokerEquityAt?.toISOString() ?? null,
    };
  }

  async closeTrade(userId: string, tradeId: string, exitPrice: number) {
    const trade = await this.prisma.trade.findFirst({
      where: { id: tradeId, userId },
    });
    if (!trade) throw new NotFoundException('Trade introuvable');

    let closeType: 'SL' | 'TP' | 'MANUAL' = 'MANUAL';

    if (trade.stopLoss !== null && trade.stopLoss !== undefined) {
      const isSL =
        trade.side === 'LONG'
          ? exitPrice <= trade.stopLoss
          : exitPrice >= trade.stopLoss;
      if (isSL) closeType = 'SL';
    }

    if (trade.takeProfit !== null && trade.takeProfit !== undefined) {
      const isTP =
        trade.side === 'LONG'
          ? exitPrice >= trade.takeProfit
          : exitPrice <= trade.takeProfit;
      if (isTP) closeType = 'TP';
    }

    // P&L en argent par la règle unique (valeur du tick × quantité, ou capital engagé) : avant,
    // l'écart de prix brut était enregistré comme P&L (MNQ 2 contrats +10 pts → 10 $ au lieu de 40 $).
    const pnl = calculatePnl({
      asset: trade.asset,
      side: trade.side,
      entry: trade.entry,
      exit: exitPrice,
      quantity: trade.quantity ?? undefined,
      capitalEngaged: trade.capitalEngaged ?? undefined,
    } as CreateTradeDto);

    const closed = await this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        exit: exitPrice,
        pnl: pnl ?? null,
        tags: { push: closeType },
      },
    });
    // Le P&L change : totaux de sa séance si elle est déjà clôturée, et statistiques en cache.
    await refreshClosedSessionTotals(this.prisma, [trade.sessionId]);
    await this.analytics.invalidateUserCache(userId);
    return closed;
  }
}
