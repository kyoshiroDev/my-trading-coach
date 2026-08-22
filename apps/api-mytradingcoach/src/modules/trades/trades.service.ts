import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SessionStatus,
  EmotionState,
  MoodState,
  ExecutionGrade,
  ExecutionMethod,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { effectiveEmotion } from '../../common/utils/effective-emotion.util';
import {
  computeTradeStats,
  BREAKEVEN_EPSILON,
} from '../../common/utils/trade-stats.util';
import {
  computeExecutionGrade,
  computeBehavioralGrade,
  median,
  BEHAVIORAL_MIN_TRADES,
  ExecutionTradeInput,
  ExecutionGradeResult,
} from '../../common/utils/execution-grade.util';
import { AnalyticsService } from '../analytics/analytics.service';
import { AccountsService } from '../accounts/accounts.service';
import { SetupsService } from '../setups/setups.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { TradeFiltersDto } from './dto/trade-filters.dto';
import { getTickValue, getTickSize, INSTRUMENTS } from './instruments.const';

/** Violation d'unicité Prisma (P2002) : ici, un import concurrent a déjà écrit ce trade. */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

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
    opts: { deferBehavioral?: boolean; importHash?: string } = {},
  ) {
    // Le setup doit appartenir au user et être actif (sinon 400). Validation
    // STRICTE conservée pour la création manuelle : `setupId` y est obligatoire
    // (CreateTradeDto + ValidationPipe global), donc la garde ci-dessous ne relâche
    // rien sur ce chemin. Elle ne s'ouvre que pour l'import en lot, qui appelle
    // `create()` directement avec un setup déjà résolu (resolveBatchSetupId) —
    // éventuellement absent si le user n'a plus aucun setup actif.
    if (dto.setupId) await this.setups.assertOwnedActive(userId, dto.setupId);
    const pnl = this.calculatePnl(dto);
    const riskReward = this.calculateRiskReward(dto);

    const activeSession = await this.prisma.tradeSession.findFirst({
      where: { userId, status: SessionStatus.ACTIVE },
      select: { id: true, accountId: true, moodStart: true },
    });

    // accountId : fourni (validé) → sinon hérité de la session active → sinon compte
    // par défaut (anti-NULL : jamais de trade sans compte).
    let accountId: string | undefined;
    if (dto.accountId && dto.accountId !== 'all') {
      accountId = (await this.accounts.accountWhere(userId, dto.accountId)).accountId;
    }
    if (!accountId) accountId = activeSession?.accountId ?? undefined;
    if (!accountId) accountId = await this.accounts.ensureDefaultAccountId(userId);

    const rr = dto.riskReward ?? riskReward;
    // Barème A (stop présent) : intrinsèque, calculé ici (PROMPT-161). Trade SANS stop → barème B
    // comportemental, dépendant de l'historique → laissé null ici, renseigné par le recalcul par lot
    // (PROMPT-168). On ne mélange jamais les deux : stop absent ⇒ jamais de note STOP_BASED.
    let executionScore: number | null = null;
    let executionGrade: ExecutionGrade | null = null;
    let executionMethod: ExecutionMethod | null = null;
    if (dto.stopLoss != null) {
      const a = await this.computeExecution(accountId, {
        ...dto,
        riskReward: rr,
        tradeSession: { moodStart: activeSession?.moodStart ?? null },
      });
      executionScore = a.score;
      executionGrade = a.grade;
      executionMethod = a.grade != null ? ExecutionMethod.STOP_BASED : null;
    }

    const trade = await this.prisma.trade.create({
      data: {
        ...dto,
        entry: dto.entry ?? 0,
        pnl: dto.pnl ?? pnl,
        riskReward: rr,
        quantity: dto.quantity ?? 1,
        capitalEngaged: dto.capitalEngaged ?? null,
        executionScore,
        executionGrade,
        executionMethod,
        userId,
        sessionId: activeSession?.id ?? null,
        accountId,
        tradedAt: dto.tradedAt ? new Date(dto.tradedAt) : new Date(),
        // Renseigné par l'import uniquement : c'est lui qui porte la contrainte
        // d'unicité anti-doublon. Saisie manuelle → null, donc jamais contrainte.
        importHash: opts.importHash ?? null,
      },
      include: { setup: { select: { id: true, title: true, color: true } } },
    });
    await this.analyticsService.invalidateUserCache(userId);

    // Le nouveau trade décale les médianes du compte → recalcul du barème comportemental
    // (sauf import : différé pour une seule passe par compte, cf. importTrades).
    if (!opts.deferBehavioral && accountId) {
      await this.recomputeBehavioralGrades(accountId);
      // Re-lecture des champs d'exécution (le recalcul a pu poser la note comportementale de CE trade).
      const fresh = await this.prisma.trade.findUnique({
        where: { id: trade.id },
        select: { executionScore: true, executionGrade: true, executionMethod: true },
      });
      if (fresh) {
        trade.executionScore = fresh.executionScore;
        trade.executionGrade = fresh.executionGrade;
        trade.executionMethod = fresh.executionMethod;
      }
    }
    return trade;
  }

  /**
   * Import en masse avec déduplication : empêche la création de doublons.
   * Clé d'unicité : userId + asset + side + tradedAt + entry + exit + pnl.
   *
   * Deux niveaux, volontairement :
   *  1. comparaison applicative en amont (rapide, et seule protection pour les trades
   *     importés AVANT la migration `importHash`, restés à NULL) ;
   *  2. contrainte d'unicité `@@unique([userId, importHash])` en base, qui tranche les
   *     accès CONCURRENTS. Le niveau 1 seul laissait un double-clic sur « Importer »
   *     créer l'historique deux fois : les deux requêtes lisaient le même état vide
   *     avant d'insérer (PROMPT-186 #1).
   *
   * Un conflit d'unicité n'est donc pas une erreur : c'est un doublon, on le compte
   * comme tel — un ré-import du même fichier ne recrée toujours rien.
   */
  async importTrades(
    userId: string,
    dtos: Partial<CreateTradeDto>[],
  ): Promise<{
    created: number;
    duplicates: number;
    failed: number;
    total: number;
  }> {
    const existing = await this.prisma.trade.findMany({
      where: { userId },
      select: { asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true },
    });
    const seen = new Set(existing.map((t) => this.dedupeKey(t)));

    let created = 0;
    let duplicates = 0;
    let failed = 0;
    // Comptes touchés → un seul recalcul comportemental par compte à la fin (pas de N+1, PROMPT-168).
    const affectedAccounts = new Set<string>();

    for (const dto of dtos) {
      const key = this.dedupeKey(dto);
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key); // dédup intra-lot (même trade présent 2× dans le fichier)
      try {
        const t = await this.create(userId, dto as CreateTradeDto, {
          deferBehavioral: true,
          importHash: key,
        });
        if (t.accountId) affectedAccounts.add(t.accountId);
        created++;
      } catch (err) {
        // P2002 = un import concurrent (double-clic) a déjà écrit ce trade : doublon,
        // pas échec. Toute autre erreur reste un échec de ligne.
        if (isUniqueConstraintError(err)) duplicates++;
        else failed++;
      }
    }

    // Barème comportemental recalculé une fois par compte, sur l'ensemble de son historique.
    for (const accountId of affectedAccounts) {
      await this.recomputeBehavioralGrades(accountId);
    }

    return { created, duplicates, failed, total: dtos.length };
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
    f: Pick<
      TradeFiltersDto,
      | 'accountId'
      | 'side'
      | 'setupId'
      | 'emotion'
      | 'result'
      | 'executionGrade'
      | 'dateFrom'
      | 'dateTo'
    >,
  ): Prisma.TradeWhereInput {
    const where: Prisma.TradeWhereInput = { userId };
    if (f.accountId && f.accountId !== 'all') where.accountId = f.accountId;
    if (f.side) where.side = f.side;
    if (f.setupId) where.setupId = f.setupId;

    // Résultat : mêmes seuils ε que trade-stats.util (les null/ouverts sont exclus par
    // les comparaisons SQL). WIN pnl>ε · LOSS pnl<-ε · BREAKEVEN -ε≤pnl≤ε.
    if (f.result === 'WIN') where.pnl = { gt: BREAKEVEN_EPSILON };
    else if (f.result === 'LOSS') where.pnl = { lt: -BREAKEVEN_EPSILON };
    else if (f.result === 'BREAKEVEN')
      where.pnl = { gte: -BREAKEVEN_EPSILON, lte: BREAKEVEN_EPSILON };

    // Note d'exécution : enum direct ; 'NONE' → non évaluée (null).
    if (f.executionGrade === 'NONE') where.executionGrade = null;
    else if (f.executionGrade)
      where.executionGrade = f.executionGrade as ExecutionGrade;

    // Émotion effective = override du trade ?? humeur de la session. Filtre en OR sur les
    // deux sources ; les valeurs propres à un seul enum ne génèrent que la branche valide
    // (TIRED → MoodState uniquement, REVENGE/FEAR → EmotionState uniquement).
    if (f.emotion === 'NONE') {
      where.emotion = null;
      where.OR = [{ sessionId: null }, { tradeSession: { moodStart: null } }];
    } else if (f.emotion) {
      const branches: Prisma.TradeWhereInput[] = [];
      if ((Object.values(EmotionState) as string[]).includes(f.emotion))
        branches.push({ emotion: f.emotion as EmotionState });
      if ((Object.values(MoodState) as string[]).includes(f.emotion))
        branches.push({
          emotion: null,
          tradeSession: { moodStart: f.emotion as MoodState },
        });
      if (branches.length) where.OR = branches;
    }

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

    // Win rate via le helper unique (BE exclus du dénominateur, PROMPT-160).
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
        // Humeur de la journée → émotion effective côté front (affichage + «, » si null).
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
    // Setup revalidé UNIQUEMENT s'il change réellement. Le front renvoie le DTO
    // complet à chaque édition : exiger un setup actif sur un `setupId` inchangé
    // gelait tout trade dont le setup avait été archivé depuis — corriger une note
    // renvoyait « Setup invalide », alors que l'archivage est précisément l'action
    // recommandée pour un setup qui a un historique. Un choix historique qu'on ne
    // modifie pas n'a pas à être revalidé ; changer de setup reste strict.
    if (dto.setupId && dto.setupId !== existing.setupId) {
      await this.setups.assertOwnedActive(userId, dto.setupId);
    }

    const merged = { ...existing, ...dto } as CreateTradeDto;

    const priceFieldsChanged =
      dto.entry !== undefined ||
      dto.exit !== undefined ||
      dto.quantity !== undefined ||
      dto.commission !== undefined ||
      dto.pnl !== undefined;

    const newPnl = priceFieldsChanged ? this.calculatePnl(merged) : undefined;
    const newRR = priceFieldsChanged ? this.calculateRiskReward(merged) : undefined;

    // Recalcul de la note d'exécution si un champ concerné change (PROMPT-161).
    const execRelevant =
      priceFieldsChanged ||
      dto.stopLoss !== undefined ||
      dto.takeProfit !== undefined ||
      dto.side !== undefined ||
      dto.riskReward !== undefined ||
      dto.emotion !== undefined ||
      dto.capitalEngaged !== undefined;
    // Barème A si stop présent (intrinsèque) ; sinon on efface la note : le recalcul comportemental
    // (barème B) la repose ensuite. Un trade sans stop n'obtient JAMAIS une note STOP_BASED.
    let execData: {
      executionScore?: number | null;
      executionGrade?: ExecutionGrade | null;
      executionMethod?: ExecutionMethod | null;
    } = {};
    if (execRelevant) {
      if (merged.stopLoss != null) {
        const moodStart = existing.sessionId
          ? (
              await this.prisma.tradeSession.findUnique({
                where: { id: existing.sessionId },
                select: { moodStart: true },
              })
            )?.moodStart ?? null
          : null;
        const a = await this.computeExecution(existing.accountId ?? undefined, {
          ...merged,
          riskReward: newRR ?? merged.riskReward,
          tradeSession: { moodStart },
        });
        execData = {
          executionScore: a.score,
          executionGrade: a.grade,
          executionMethod: a.grade != null ? ExecutionMethod.STOP_BASED : null,
        };
      } else {
        execData = { executionScore: null, executionGrade: null, executionMethod: null };
      }
    }

    const result = await this.prisma.trade.update({
      where: { id },
      data: {
        ...dto,
        tradedAt: dto.tradedAt ? new Date(dto.tradedAt) : undefined,
        ...(newPnl !== undefined ? { pnl: newPnl } : {}),
        ...(newRR !== undefined ? { riskReward: newRR } : {}),
        ...execData,
      },
      include: { setup: { select: { id: true, title: true, color: true } } },
    });
    await this.analyticsService.invalidateUserCache(userId);

    // L'édition (P&L, quantité…) modifie les médianes du compte → recalcul comportemental (une passe).
    if (execRelevant && existing.accountId) {
      await this.recomputeBehavioralGrades(existing.accountId);
      const fresh = await this.prisma.trade.findUnique({
        where: { id },
        select: { executionScore: true, executionGrade: true, executionMethod: true },
      });
      if (fresh) {
        result.executionScore = fresh.executionScore;
        result.executionGrade = fresh.executionGrade;
        result.executionMethod = fresh.executionMethod;
      }
    }
    return result;
  }

  async remove(userId: string, id: string) {
    const existing = await this.findOne(userId, id);
    await this.prisma.trade.delete({ where: { id } });
    await this.analyticsService.invalidateUserCache(userId);
    // La suppression modifie les médianes du compte → recalcul comportemental (PROMPT-168).
    if (existing.accountId) await this.recomputeBehavioralGrades(existing.accountId);
  }

  /**
   * Réaffecte un lot de trades à un autre compte. Le `userId` dans le `where`
   * garantit qu'on ne touche que les trades du user (anti-IDOR). Le déplacement change
   * les médianes des comptes source ET cible → recalcul comportemental des deux côtés (PROMPT-168).
   */
  async reassignAccount(userId: string, tradeIds: string[], accountId: string) {
    // Comptes source (avant déplacement) pour recalculer leur barème comportemental.
    const before = await this.prisma.trade.findMany({
      where: { id: { in: tradeIds }, userId },
      select: { accountId: true },
    });
    const result = await this.prisma.trade.updateMany({
      where: { id: { in: tradeIds }, userId },
      data: { accountId },
    });
    await this.analyticsService.invalidateUserCache(userId);

    const accounts = new Set<string>([
      accountId,
      ...before.map((t) => t.accountId).filter((a): a is string => a != null),
    ]);
    for (const acc of accounts) await this.recomputeBehavioralGrades(acc);
    return { moved: result.count };
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

  /**
   * Note d'exécution CALCULÉE (PROMPT-161) : récupère le capital du compte cible et délègue
   * au util déterministe. Aucune IA. Retourne { score, grade } (null si < 2 critères applicables).
   */
  private async computeExecution(
    accountId: string | undefined,
    trade: ExecutionTradeInput,
  ): Promise<ExecutionGradeResult> {
    const account = accountId
      ? await this.prisma.tradingAccount.findUnique({
          where: { id: accountId },
          select: { startingBalance: true, accountSize: true },
        })
      : null;
    return computeExecutionGrade(trade, account);
  }

  /**
   * Recalcul par lot du barème comportemental (PROMPT-168) d'un compte, EN UNE SEULE PASSE.
   * Ne touche QUE les trades sans stop (ceux avec stop gardent leur barème A intrinsèque). Contextuel :
   * les 3 critères dépendent des médianes du compte → la note d'un trade évolue quand l'historique
   * s'étoffe (attendu). Charge les trades clôturés triés une fois, calcule les médianes une fois,
   * puis parcourt : aucune requête par trade (N+1 évité). Écritures limitées aux trades dont la note change.
   */
  async recomputeBehavioralGrades(accountId: string): Promise<void> {
    const trades = await this.prisma.trade.findMany({
      where: { accountId, pnl: { not: null } }, // clôturés seulement
      select: {
        id: true, pnl: true, quantity: true, tradedAt: true, stopLoss: true,
        executionScore: true, executionGrade: true, executionMethod: true,
      },
      orderBy: { tradedAt: 'asc' },
    });

    const eps = BREAKEVEN_EPSILON;
    const isLoss = (pnl: number | null) => pnl != null && pnl < -eps;
    // Garde-fou : sous 20 trades clôturés, les médianes n'ont pas de sens → tout reste « Non évaluée ».
    const enoughHistory = trades.length >= BEHAVIORAL_MIN_TRADES;

    // Médianes sur TOUS les trades clôturés du compte (référence de l'historique du trader).
    const medianLoss = median(
      trades.filter((t) => isLoss(t.pnl)).map((t) => Math.abs(t.pnl as number)),
    );
    const medianQuantity = median(trades.map((t) => t.quantity ?? 1));

    const updates: Prisma.PrismaPromise<unknown>[] = [];

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      if (t.stopLoss != null) continue; // barème A → on ne touche pas

      let score: number | null = null;
      let grade: ExecutionGrade | null = null;
      let method: ExecutionMethod | null = null;

      if (enoughHistory) {
        const prev = trades[i - 1];
        const previousIsLoss = prev ? isLoss(prev.pnl) : false;

        // Dernier trade perdant le MÊME jour, avant celui-ci (revenge).
        const day = t.tradedAt.toISOString().slice(0, 10);
        let lastSameDayLossAt: Date | null = null;
        for (let j = i - 1; j >= 0; j--) {
          if (trades[j].tradedAt.toISOString().slice(0, 10) !== day) break; // trié asc → sorti du jour
          if (isLoss(trades[j].pnl)) { lastSameDayLossAt = trades[j].tradedAt; break; }
        }

        const b = computeBehavioralGrade({
          pnl: t.pnl as number,
          quantity: t.quantity ?? 1,
          tradedAt: t.tradedAt,
          medianLoss,
          medianQuantity,
          previousIsLoss,
          lastSameDayLossAt,
        });
        score = b.score;
        grade = b.grade;
        method = b.grade != null ? ExecutionMethod.BEHAVIORAL : null;
      }

      if (
        score !== t.executionScore ||
        grade !== t.executionGrade ||
        method !== t.executionMethod
      ) {
        updates.push(
          this.prisma.trade.update({
            where: { id: t.id },
            data: { executionScore: score, executionGrade: grade, executionMethod: method },
          }),
        );
      }
    }

    if (updates.length) await this.prisma.$transaction(updates);
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
