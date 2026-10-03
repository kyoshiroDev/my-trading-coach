import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SessionStatus,
  ExecutionGrade,
  ExecutionMethod,
  TradeSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { effectiveEmotion } from '../../common/utils/effective-emotion.util';
import {
  computeExecutionGrade,
  ExecutionTradeInput,
  ExecutionGradeResult,
} from '../../common/utils/execution-grade.util';
import { AnalyticsService } from '../analytics/analytics.service';
import { AccountsService } from '../accounts/accounts.service';
import { SetupsService } from '../setups/setups.service';
import { CrossSourcePool } from './import-dedupe.util';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { TradeFiltersDto } from './dto/trade-filters.dto';
import { buildTradeFilterSql, buildTradeWhere } from './trade-filters.util';
import { calculatePnl, calculateRiskReward } from './trade-metrics.util';
import { dedupeKey, duplicateIdentity, occurrenceHash } from './trade-identity.util';
import { journalStatsSql, type JournalStats } from './journal-stats.util';
import { recomputeBehavioralGrades } from './behavioral-grades';

// Réexports : les appelants existants importent ces types depuis le service.
export type { JournalStats } from './journal-stats.util';
export type { UserAssetItem } from './user-assets.service';

/**
 * Trades importés par un broker connecté (synchro live + rattrapage d'historique). Seuls eux
 * peuvent être supprimés en lot à la déconnexion : `MANUAL` et `CSV_IMPORT` sont des saisies de
 * l'utilisateur, jamais touchées.
 */
export const BROKER_TRADE_SOURCES: TradeSource[] = [TradeSource.BROKER_SYNC, TradeSource.BROKER_HISTORY];

/** Violation d'unicité Prisma (P2002) : ici, un import concurrent a déjà écrit ce trade. */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
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
    opts: { deferBehavioral?: boolean; importHash?: string; source?: TradeSource } = {},
  ) {
    // Le setup doit appartenir au user et être actif (sinon 400). Validation
    // STRICTE conservée pour la création manuelle : `setupId` y est obligatoire
    // (CreateTradeDto + ValidationPipe global), donc la garde ci-dessous ne relâche
    // rien sur ce chemin. Elle ne s'ouvre que pour l'import en lot, qui appelle
    // `create()` directement avec un setup déjà résolu (resolveBatchSetupId) —
    // éventuellement absent si le user n'a plus aucun setup actif.
    if (dto.setupId) await this.setups.assertOwnedActive(userId, dto.setupId);
    const pnl = calculatePnl(dto);
    const riskReward = calculateRiskReward(dto);

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
    // Barème A (stop présent) : intrinsèque, calculé ici. Trade SANS stop → barème B
    // comportemental, dépendant de l'historique → laissé null ici, renseigné par le recalcul par lot
    //. On ne mélange jamais les deux : stop absent ⇒ jamais de note STOP_BASED.
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
        // Provenance : MANUAL par défaut, les imports la passent explicitement.
        source: opts.source ?? TradeSource.MANUAL,
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
      include: {
        setup: { select: { id: true, title: true, color: true } },
        // Meme forme que findAll : sans elle, `effectiveEmotion` ne peut pas retomber
        // sur l'humeur de session.
        tradeSession: { select: { moodStart: true } },
      },
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
    // Le front remplace l'objet en store par CETTE reponse : sans le champ calcule,
    // un trade fraichement logge affichait « non renseignee » jusqu'au rechargement.
    // Apres le bloc ci-dessus, qui reecrit les champs d'execution.
    return { ...trade, effectiveEmotion: effectiveEmotion(trade) };
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
   *     avant d'insérer.
   *
   * Un conflit d'unicité n'est donc pas une erreur : c'est un doublon, on le compte
   * comme tel — un ré-import du même fichier ne recrée toujours rien.
   *
   * Deux lignes IDENTIQUES d'une même source sont deux trades, pas un doublon : un trade à
   * plusieurs contrats arrive souvent en plusieurs paires Tradovate (mêmes prix, même seconde
   * de clôture). La n-ième répétition prend l'empreinte `clé#n` (cf. `occurrenceHash`) ; les
   * écarter perdait des contrats et du P&L (synchro de Val, 14/09/2026 : 28 paires → 23 trades).
   */
  async importTrades(
    userId: string,
    dtos: Partial<CreateTradeDto>[],
    /** D'où vient ce lot : fichier de l'utilisateur, séance du broker, ou son historique. */
    source: TradeSource = TradeSource.CSV_IMPORT,
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
    // Même trade déjà en base mais daté dans un autre fuseau (export CSV sans fuseau ↔ API en
    // UTC) : doublon, un-pour-un. Vaut dans les deux sens : CSV avant OU après la synchro.
    const otherTimezone = new CrossSourcePool(existing);
    // Empreintes déjà prises : la clé, puis `#2`, `#3`… autant de fois que la clé existe en base.
    const seen = new Set<string>();
    const inBase = new Map<string, number>();
    for (const t of existing) {
      const key = dedupeKey(t);
      const n = (inBase.get(key) ?? 0) + 1;
      inBase.set(key, n);
      seen.add(occurrenceHash(key, n));
    }

    let created = 0;
    let duplicates = 0;
    let failed = 0;
    // Comptes touchés → un seul recalcul comportemental par compte à la fin (pas de N+1).
    const affectedAccounts = new Set<string>();
    // Rang de chaque clé DANS la source : deux lignes identiques sont deux trades (cf. occurrenceHash).
    const inSource = new Map<string, number>();

    for (const dto of dtos) {
      if (otherTimezone.take(dto)) {
        duplicates++;
        continue;
      }
      const key = dedupeKey(dto);
      const n = (inSource.get(key) ?? 0) + 1;
      inSource.set(key, n);
      const hash = occurrenceHash(key, n);
      if (seen.has(hash)) {
        duplicates++;
        continue;
      }
      seen.add(hash);
      try {
        const t = await this.create(userId, dto as CreateTradeDto, {
          deferBehavioral: true,
          importHash: hash,
          source,
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



  /** Compte les doublons existants pour un user (lignes en trop par rapport aux uniques). */
  async countDuplicates(
    userId: string,
  ): Promise<{ total: number; unique: number; duplicates: number }> {
    const trades = await this.prisma.trade.findMany({
      where: { userId },
      select: { asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true, importHash: true },
    });
    const keys = new Set(trades.map((t) => duplicateIdentity(t)));
    return { total: trades.length, unique: keys.size, duplicates: trades.length - keys.size };
  }

  /** Supprime les doublons en gardant la plus ancienne occurrence de chaque clé. */
  async removeDuplicates(userId: string): Promise<{ removed: number; kept: number }> {
    const trades = await this.prisma.trade.findMany({
      where: { userId },
      select: { id: true, asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true, importHash: true },
      orderBy: { createdAt: 'asc' }, // garder la 1ʳᵉ occurrence créée
    });
    const seen = new Set<string>();
    const toDelete: string[] = [];
    for (const t of trades) {
      const key = duplicateIdentity(t);
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
   * KPIs du journal calculés en base sur TOUT l'ensemble filtré (hors pagination).
   * Évite que les stats changent quand le front charge plus de trades.
   */
  async computeJournalStats(
    userId: string,
    filters: TradeFiltersDto,
  ): Promise<JournalStats> {
    // Ownership du compte validé au niveau contrôleur (accountWhere), comme findAll. Calcul en
    // base (SCA-B2-02) avec le même filtre que la liste (buildTradeFilterSql ≡ buildTradeWhere).
    return journalStatsSql(this.prisma, buildTradeFilterSql(userId, filters));
  }

  async findAll(userId: string, filters: TradeFiltersDto) {
    const { cursor, limit = 20 } = filters;
    const where = buildTradeWhere(userId, filters);

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

    const newPnl = priceFieldsChanged ? calculatePnl(merged) : undefined;
    const newRR = priceFieldsChanged ? calculateRiskReward(merged) : undefined;

    // Recalcul de la note d'exécution si un champ concerné change.
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
      include: {
        setup: { select: { id: true, title: true, color: true } },
        tradeSession: { select: { moodStart: true } },
      },
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
    // APRES le bloc d'execution : `result` y est reecrit, un calcul place avant
    // renverrait un objet construit sur des champs perimes.
    return { ...result, effectiveEmotion: effectiveEmotion(result) };
  }

  async remove(userId: string, id: string) {
    const existing = await this.findOne(userId, id);
    await this.prisma.trade.delete({ where: { id } });
    await this.analyticsService.invalidateUserCache(userId);
    // La suppression modifie les médianes du compte → recalcul comportemental.
    if (existing.accountId) await this.recomputeBehavioralGrades(existing.accountId);
  }

  /**
   * Supprime les trades importés par le broker sur CE compte (cf. BROKER_TRADE_SOURCES), à la
   * demande explicite de l'utilisateur qui déconnecte un compte broker branché par erreur.
   * Le `userId` dans le `where` garantit qu'on ne touche que ses trades (anti-IDOR).
   */
  async removeBrokerImported(userId: string, accountId: string): Promise<number> {
    const { count } = await this.prisma.trade.deleteMany({
      where: { userId, accountId, source: { in: BROKER_TRADE_SOURCES } },
    });
    if (count > 0) {
      await this.analyticsService.invalidateUserCache(userId);
      // Les médianes du compte changent → recalcul comportemental (cf. remove).
      await this.recomputeBehavioralGrades(accountId);
    }
    return count;
  }

  /**
   * Réaffecte un lot de trades à un autre compte. Le `userId` dans le `where`
   * garantit qu'on ne touche que les trades du user (anti-IDOR). Le déplacement change
   * les médianes des comptes source ET cible → recalcul comportemental des deux côtés.
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


  /**
   * Note d'exécution CALCULÉE : récupère le capital du compte cible et délègue
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

  /** Recalcul du barème comportemental (sans stop) d'un compte : cf. behavioral-grades.ts. */
  recomputeBehavioralGrades(accountId: string): Promise<void> {
    return recomputeBehavioralGrades(this.prisma, accountId);
  }
}
