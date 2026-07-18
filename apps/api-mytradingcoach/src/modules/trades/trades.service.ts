import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Plan, Role, Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { effectiveEmotion } from '../../common/utils/effective-emotion.util';
import { computeTradeStats } from '../../common/utils/trade-stats.util';
import { AnalyticsService } from '../analytics/analytics.service';
import { AccountsService } from '../accounts/accounts.service';
import { SetupsService } from '../setups/setups.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { TradeFiltersDto } from './dto/trade-filters.dto';
import { getTickValue, getTickSize, INSTRUMENTS } from './instruments.const';

export interface UserAssetItem {
  symbol: string;
  label: string;
  category: string;
  tradeCount: number;
  lastEntry: number | null;
  lastQty: number | null;
  isFavorite: boolean;
}

/** KPIs du journal agrégés sur l'ensemble filtré complet (hors pagination). */
export interface JournalStats {
  totalTrades: number;
  winRate: number;
  pnlBrut: number;
  fees: number;
  pnlNet: number;
  bestTrade: number;
  worstTrade: number;
}

@Injectable()
export class TradesService {
  constructor(
    private prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
    private readonly accounts: AccountsService,
    private readonly setups: SetupsService,
  ) {}

  async create(
    userId: string,
    dto: CreateTradeDto,
    plan: Plan = Plan.FREE,
    role: Role = Role.USER,
  ) {
    await this.checkMonthlyLimit(userId, plan, role, dto.tradedAt);
    // Le setup doit appartenir au user et être actif (sinon 400).
    await this.setups.assertOwnedActive(userId, dto.setupId);
    const pnl = this.calculatePnl(dto);
    const riskReward = this.calculateRiskReward(dto);

    const activeSession = await this.prisma.tradeSession.findFirst({
      where: { userId, status: SessionStatus.ACTIVE },
      select: { id: true, accountId: true },
    });

    // accountId : fourni (validé) → sinon hérité de la session active → sinon compte
    // par défaut (anti-NULL : jamais de trade sans compte).
    let accountId: string | undefined;
    if (dto.accountId && dto.accountId !== 'all') {
      accountId = (await this.accounts.accountWhere(userId, dto.accountId)).accountId;
    }
    if (!accountId) accountId = activeSession?.accountId ?? undefined;
    if (!accountId) accountId = await this.accounts.ensureDefaultAccountId(userId);

    const trade = await this.prisma.trade.create({
      data: {
        ...dto,
        entry: dto.entry ?? 0,
        pnl: dto.pnl ?? pnl,
        riskReward: dto.riskReward ?? riskReward,
        quantity: dto.quantity ?? 1,
        capitalEngaged: dto.capitalEngaged ?? null,
        userId,
        sessionId: activeSession?.id ?? null,
        accountId,
        tradedAt: dto.tradedAt ? new Date(dto.tradedAt) : new Date(),
      },
      include: { setup: { select: { id: true, title: true, color: true } } },
    });
    await this.analyticsService.invalidateUserCache(userId);
    return trade;
  }

  /**
   * Import en masse avec déduplication — empêche la création de doublons.
   * Clé d'unicité applicative : userId + asset + side + tradedAt + entry + exit + pnl.
   * Skip les trades déjà présents en base ET les doublons internes au même lot
   * (un fichier ré-importé ne recrée donc rien). Pas de migration : dédup applicative.
   */
  async importTrades(
    userId: string,
    dtos: Partial<CreateTradeDto>[],
    plan: Plan = Plan.FREE,
    role: Role = Role.USER,
  ): Promise<{
    created: number;
    duplicates: number;
    failed: number;
    limitBlocked: number;
    total: number;
  }> {
    const [existing, user] = await Promise.all([
      this.prisma.trade.findMany({
        where: { userId },
        select: { asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    ]);
    const seen = new Set(existing.map((t) => this.dedupeKey(t)));

    // Historique = trade daté AVANT l'inscription → toujours importé, hors limite FREE.
    const isHistorical = (t: Partial<CreateTradeDto>): boolean =>
      !!user && t.tradedAt != null && new Date(t.tradedAt) < user.createdAt;

    let created = 0;
    let duplicates = 0;
    let failed = 0;
    let limitBlocked = 0; // trades post-inscription non importés car la limite FREE (30/mois) est atteinte
    let limitHit = false;

    for (const dto of dtos) {
      const key = this.dedupeKey(dto);
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key); // dédup intra-lot (même trade présent 2× dans le fichier)
      // Limite atteinte : on ne saute QUE les trades courants ; l'historique passe toujours.
      if (limitHit && !isHistorical(dto)) {
        limitBlocked++;
        continue;
      }
      try {
        await this.create(userId, dto as CreateTradeDto, plan, role);
        created++;
      } catch (err) {
        if (this.isFreeLimitError(err)) {
          // Ne peut concerner qu'un trade post-inscription (l'historique est exempté).
          limitHit = true;
          limitBlocked++;
        } else {
          failed++;
        }
      }
    }

    return { created, duplicates, failed, limitBlocked, total: dtos.length };
  }

  /** Vrai si l'erreur est le refus de quota FREE (FREE_LIMIT_REACHED). */
  private isFreeLimitError(err: unknown): boolean {
    if (err instanceof HttpException) {
      const res = err.getResponse();
      return (
        typeof res === 'object' &&
        res !== null &&
        (res as { code?: string }).code === 'FREE_LIMIT_REACHED'
      );
    }
    return false;
  }

  /** Clé d'unicité d'un trade : asset + side + tradedAt + entry + exit + pnl. */
  private dedupeKey(t: {
    asset?: string | null;
    side?: string | null;
    tradedAt?: string | Date | null;
    entry?: number | null;
    exit?: number | null;
    pnl?: number | null;
  }): string {
    const at = t.tradedAt ? new Date(t.tradedAt).toISOString() : '';
    return [t.asset ?? '', t.side ?? '', at, t.entry ?? '', t.exit ?? '', t.pnl ?? ''].join('|');
  }

  /** Compte les doublons existants pour un user (lignes en trop par rapport aux uniques). */
  async countDuplicates(
    userId: string,
  ): Promise<{ total: number; unique: number; duplicates: number }> {
    const trades = await this.prisma.trade.findMany({
      where: { userId },
      select: { asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true },
    });
    const keys = new Set(trades.map((t) => this.dedupeKey(t)));
    return { total: trades.length, unique: keys.size, duplicates: trades.length - keys.size };
  }

  /** Supprime les doublons en gardant la plus ancienne occurrence de chaque clé. */
  async removeDuplicates(userId: string): Promise<{ removed: number; kept: number }> {
    const trades = await this.prisma.trade.findMany({
      where: { userId },
      select: { id: true, asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true },
      orderBy: { createdAt: 'asc' }, // garder la 1ʳᵉ occurrence créée
    });
    const seen = new Set<string>();
    const toDelete: string[] = [];
    for (const t of trades) {
      const key = this.dedupeKey(t);
      if (seen.has(key)) toDelete.push(t.id);
      else seen.add(key);
    }
    if (toDelete.length > 0) {
      await this.prisma.trade.deleteMany({ where: { id: { in: toDelete }, userId } });
      await this.analyticsService.invalidateUserCache(userId);
    }
    return { removed: toDelete.length, kept: seen.size };
  }

  /**
   * Construit le `where` Prisma commun à la liste et aux stats (même filtres → mêmes résultats).
   * Factorisé pour que la liste paginée et l'agrégat de stats ne divergent jamais.
   */
  private buildTradeWhere(
    userId: string,
    f: Pick<TradeFiltersDto, 'accountId' | 'side' | 'setupId' | 'emotion' | 'dateFrom' | 'dateTo'>,
  ): Prisma.TradeWhereInput {
    const where: Prisma.TradeWhereInput = { userId };
    if (f.accountId && f.accountId !== 'all') where.accountId = f.accountId;
    if (f.side) where.side = f.side;
    if (f.setupId) where.setupId = f.setupId;
    if (f.emotion) where.emotion = f.emotion;
    if (f.dateFrom || f.dateTo) {
      where.tradedAt = {};
      if (f.dateFrom) where.tradedAt.gte = new Date(f.dateFrom);
      if (f.dateTo) where.tradedAt.lte = new Date(f.dateTo);
    }
    return where;
  }

  /**
   * KPIs du journal calculés en base sur TOUT l'ensemble filtré (hors pagination).
   * Évite que les stats changent quand le front charge plus de trades.
   */
  async computeJournalStats(
    userId: string,
    filters: TradeFiltersDto,
  ): Promise<JournalStats> {
    // Ownership du compte validé au niveau contrôleur (accountWhere), comme findAll.
    const where = this.buildTradeWhere(userId, filters);

    const trades = await this.prisma.trade.findMany({
      where,
      select: { pnl: true, commission: true },
    });

    const totalTrades = trades.length;
    if (totalTrades === 0) {
      return { totalTrades: 0, winRate: 0, pnlBrut: 0, fees: 0, pnlNet: 0, bestTrade: 0, worstTrade: 0 };
    }

    // Win rate via le helper unique (BE exclus du dénominateur — PROMPT-160).
    const { winRate } = computeTradeStats(trades);

    let pnlBrut = 0;
    let fees = 0;
    let bestTrade = -Infinity;
    let worstTrade = Infinity;
    for (const t of trades) {
      const pnl = t.pnl ?? 0;
      const fee = Math.abs(t.commission ?? 0);
      pnlBrut += pnl;
      fees += fee;
      const net = pnl - fee;
      if (net > bestTrade) bestTrade = net;
      if (net < worstTrade) worstTrade = net;
    }

    return {
      totalTrades,
      winRate,
      pnlBrut,
      fees,
      pnlNet: pnlBrut - fees,
      bestTrade,
      worstTrade,
    };
  }

  async findAll(userId: string, filters: TradeFiltersDto) {
    const { cursor, limit = 20 } = filters;
    const where = this.buildTradeWhere(userId, filters);

    const trades = await this.prisma.trade.findMany({
      take: limit + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where,
      orderBy: { tradedAt: 'desc' },
      include: {
        setup: { select: { id: true, title: true, color: true } },
        // Humeur de la journée → émotion effective côté front (affichage + « — » si null).
        tradeSession: { select: { moodStart: true } },
      },
    });

    const hasNextPage = trades.length > limit;
    const sliced = hasNextPage ? trades.slice(0, limit) : trades;
    // Émotion effective exposée au front : override du trade sinon humeur de session, sinon null.
    const data = sliced.map((t) => ({ ...t, effectiveEmotion: effectiveEmotion(t) }));
    const nextCursor = hasNextPage ? data[data.length - 1].id : null;

    return { data, nextCursor, hasNextPage };
  }

  async findOne(userId: string, id: string) {
    const trade = await this.prisma.trade.findUnique({
      where: { id },
      include: { setup: { select: { id: true, title: true, color: true } } },
    });
    if (!trade) throw new NotFoundException('Trade introuvable');
    if (trade.userId !== userId) throw new ForbiddenException();
    return trade;
  }

  async update(userId: string, id: string, dto: UpdateTradeDto) {
    const existing = await this.findOne(userId, id);
    // Changement de setup → revalider l'ownership + actif.
    if (dto.setupId) await this.setups.assertOwnedActive(userId, dto.setupId);

    const merged = { ...existing, ...dto } as CreateTradeDto;

    const priceFieldsChanged =
      dto.entry !== undefined ||
      dto.exit !== undefined ||
      dto.quantity !== undefined ||
      dto.commission !== undefined ||
      dto.pnl !== undefined;

    const newPnl = priceFieldsChanged ? this.calculatePnl(merged) : undefined;
    const newRR = priceFieldsChanged ? this.calculateRiskReward(merged) : undefined;

    const result = await this.prisma.trade.update({
      where: { id },
      data: {
        ...dto,
        tradedAt: dto.tradedAt ? new Date(dto.tradedAt) : undefined,
        ...(newPnl !== undefined ? { pnl: newPnl } : {}),
        ...(newRR !== undefined ? { riskReward: newRR } : {}),
      },
      include: { setup: { select: { id: true, title: true, color: true } } },
    });
    await this.analyticsService.invalidateUserCache(userId);
    return result;
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.trade.delete({ where: { id } });
    await this.analyticsService.invalidateUserCache(userId);
  }

  /**
   * Réaffecte un lot de trades à un autre compte. Le `userId` dans le `where`
   * garantit qu'on ne touche que les trades du user (anti-IDOR). Seul `accountId`
   * change : les métriques compte se recalculent à la lecture (rien à recalculer ici).
   */
  async reassignAccount(userId: string, tradeIds: string[], accountId: string) {
    const result = await this.prisma.trade.updateMany({
      where: { id: { in: tradeIds }, userId },
      data: { accountId },
    });
    await this.analyticsService.invalidateUserCache(userId);
    return { moved: result.count };
  }

  async checkMonthlyLimit(
    userId: string,
    plan: Plan,
    role: Role = Role.USER,
    tradedAt?: string | Date | null,
  ): Promise<void> {
    if (role === Role.ADMIN || role === Role.BETA_TESTER || plan === Plan.STARTER || plan === Plan.PREMIUM)
      return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Le trade en cours est-il de l'historique (avant inscription) ou hors mois courant ?
    // → il ne consomme PAS la limite des 30/mois.
    const td = tradedAt ? new Date(tradedAt) : new Date();
    if (user && td < user.createdAt) return; // historique importé
    if (td < startOfMonth) return; // hors mois courant

    // Compter l'activité courante : trades du mois courant ET postérieurs à l'inscription.
    const since = user && user.createdAt > startOfMonth ? user.createdAt : startOfMonth;
    const count = await this.prisma.trade.count({
      where: { userId, tradedAt: { gte: since } },
    });

    if (count >= 30) {
      throw new HttpException(
        {
          code: 'FREE_LIMIT_REACHED',
          message: 'Limite de 30 trades/mois atteinte',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async countThisMonth(userId: string, plan: Plan, role: Role = Role.USER): Promise<{ count: number; limit: number; isPremium: boolean }> {
    const isPremium = plan === Plan.STARTER || plan === Plan.PREMIUM || role === Role.ADMIN || role === Role.BETA_TESTER;
    if (isPremium) return { count: 0, limit: 0, isPremium: true };

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Activité courante uniquement : trades du mois ET postérieurs à l'inscription.
    // L'historique importé (tradedAt < inscription) n'est pas décompté.
    const since = user && user.createdAt > startOfMonth ? user.createdAt : startOfMonth;
    const count = await this.prisma.trade.count({
      where: { userId, tradedAt: { gte: since } },
    });

    return { count, limit: 30, isPremium: false };
  }

  async getUserAssets(userId: string): Promise<UserAssetItem[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tradingAssets: true, favoriteAsset: true },
    });
    const favoriteAsset = user?.favoriteAsset ?? null;
    const instrMap = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));

    // Si l'user a configuré ses actifs → priorité au profil
    if (user?.tradingAssets?.length) {
      return user.tradingAssets.map((symbol) => {
        const instr = instrMap.get(symbol);
        return {
          symbol,
          label: instr?.label ?? symbol,
          category: instr?.category ?? 'CRYPTO',
          tradeCount: 0,
          lastEntry: null,
          lastQty: null,
          isFavorite: symbol === favoriteAsset,
        };
      });
    }

    // Fallback : top actifs sur les 100 derniers trades (tous mois confondus)
    const rows = await this.prisma.trade.findMany({
      where: { userId },
      select: { asset: true, entry: true, quantity: true, tradedAt: true },
      orderBy: { tradedAt: 'desc' },
      take: 100,
    });

    const map = new Map<string, { count: number; lastEntry: number | null; lastQty: number | null }>();
    for (const row of rows) {
      if (!map.has(row.asset)) {
        map.set(row.asset, { count: 0, lastEntry: row.entry, lastQty: row.quantity });
      }
      map.get(row.asset)!.count++;
    }

    const items: UserAssetItem[] = Array.from(map.entries()).map(([symbol, data]) => {
      const instr = instrMap.get(symbol);
      return {
        symbol,
        label: instr?.label ?? symbol,
        category: instr?.category ?? 'CRYPTO',
        tradeCount: data.count,
        lastEntry: data.lastEntry,
        lastQty: data.lastQty,
        isFavorite: symbol === favoriteAsset,
      };
    });

    items.sort((a, b) => b.tradeCount - a.tradeCount);

    if (favoriteAsset && !items.find((i) => i.symbol === favoriteAsset)) {
      const instr = instrMap.get(favoriteAsset);
      items.unshift({
        symbol: favoriteAsset,
        label: instr?.label ?? favoriteAsset,
        category: instr?.category ?? 'CRYPTO',
        tradeCount: 0,
        lastEntry: null,
        lastQty: null,
        isFavorite: true,
      });
    }

    return items.slice(0, 8);
  }

  async saveUserAssets(
    userId: string,
    assets: string[],
    favoriteAsset?: string | null,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        tradingAssets: assets,
        favoriteAsset: favoriteAsset ?? null,
      },
    });
  }

  async setFavoriteAsset(userId: string, asset: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { favoriteAsset: asset },
    });
  }

  private calculatePnl(dto: CreateTradeDto): number | undefined {
    if (dto.entry == null || dto.entry <= 0) return undefined;

    const commission = Math.abs(dto.commission ?? 0);

    // P&L réalisé fourni (import broker, ou édition sans changement de prix/qty) = source de vérité.
    // On NE recalcule PAS points × quantité : faux pour la crypto/contrats (qty MEXC en contrats, pas en coins).
    if (dto.pnl != null) return +(dto.pnl - commission).toFixed(2);

    if (dto.exit == null || dto.exit <= 0) return undefined;
    const effectiveExit = dto.exit;

    const points =
      dto.side === 'LONG'
        ? effectiveExit - dto.entry
        : dto.entry - effectiveExit;

    const quantity = dto.quantity ?? 1;
    const tickValue = getTickValue(dto.asset);
    const tickSize = getTickSize(dto.asset);

    let pnl: number;
    if (tickValue != null) {
      const ticks = tickSize && tickSize > 0 ? points / tickSize : points;
      pnl = ticks * tickValue * quantity;
    } else if (dto.capitalEngaged != null && dto.capitalEngaged > 0) {
      pnl = (points / dto.entry) * dto.capitalEngaged;
    } else {
      pnl = points * quantity;
    }

    pnl -= commission;

    return +pnl.toFixed(2);
  }

  private calculateRiskReward(dto: CreateTradeDto): number | undefined {
    // R/R calculé depuis takeProfit (objectif prévu), pas exit (sortie réelle)
    if (dto.entry != null && dto.takeProfit != null && dto.stopLoss != null) {
      const reward =
        dto.side === 'LONG'
          ? dto.takeProfit - dto.entry
          : dto.entry - dto.takeProfit;
      const risk = Math.abs(dto.entry - dto.stopLoss);
      return risk > 0 && reward > 0 ? +(reward / risk).toFixed(2) : undefined;
    }
    return undefined;
  }
}
