import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  Prisma,
  ExecutionGrade,
  ExecutionMethod,
  TradeSource,
  TradingSession,
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
import { importDedupeWindow } from './import-dedupe.util';
import { AccountDedupeStates } from './account-dedupe-state';
import { ACTIVE_SESSION_SELECT, createImportBatch, type ImportBatch } from './import-batch';
import { activeSessionWhere, tradingDayEnd, tradingDayStart } from '../session/active-session';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import type { SetTradeStopDto } from './dto/set-trade-stop.dto';
import { TradeFiltersDto } from './dto/trade-filters.dto';
import { resolveTradeWhere } from './trade-filters.util';
import { getTickValue } from './instruments.const';
import { refreshClosedSessionTotals } from '../session/refresh-session-totals';
import { calculatePnl, calculateRiskReward } from './trade-metrics.util';
import { accountDuplicateIdentity, accountImportHash, dedupeKey, occurrenceHash, withoutImportMeta, type ImportTradeInput } from './trade-identity.util';
import { journalStatsForFilters, type JournalStats } from './journal-stats.util';
import { recomputeBehavioralGrades } from './behavioral-grades';
import { plannedRiskReward, roundCents, stopPlacementError } from '@mtc/shared';
import { BehaviorSignalsService } from '../behavior/behavior-signals.service';
import { AccountIncidentsService } from '../accounts/incidents/account-incidents.service';

// Réexports : les appelants existants importent ces types depuis le service.
export type { JournalStats } from './journal-stats.util';
export type { ImportTradeInput } from './trade-identity.util';
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
    /** Autopsie d'un compte grillé (#669) : optionnel pour garder les tests unitaires légers. */
    @Optional() private readonly incidents?: AccountIncidentsService,
    /** Signal « émotion après une perte » (#671), silencieux : optionnel pour les tests unitaires. */
    @Optional() private readonly signals?: BehaviorSignalsService,
  ) {}

  async create(
    userId: string,
    dto: CreateTradeDto,
    opts: { deferBehavioral?: boolean; importHash?: string; source?: TradeSource; batch?: ImportBatch } = {},
  ) {
    // Import en lot (SCA-B1-02) : session, setups et comptes résolus une fois pour tout le lot,
    // cache invalidé une seule fois à la fin (importTrades).
    const batch = opts.batch;
    // Le setup doit appartenir au user et être actif (sinon 400). Validation
    // STRICTE conservée pour la création manuelle : `setupId` y est obligatoire
    // (CreateTradeDto + ValidationPipe global), donc la garde ci-dessous ne relâche
    // rien sur ce chemin. Elle ne s'ouvre que pour l'import en lot, qui appelle
    // `create()` directement avec un setup déjà résolu (resolveBatchSetupId) —
    // éventuellement absent si le user n'a plus aucun setup actif.
    if (dto.setupId) await (batch ? batch.ownedSetup(dto.setupId) : this.setups.assertOwnedActive(userId, dto.setupId));
    // Frais toujours positifs en base : les écrans lisent |commission|, mais le solde des comptes
    // lisait `pnl − commission` signé (−5 de frais saisis = +5 $ sur le compte, −5 $ au dashboard).
    if (dto.commission != null) dto = { ...dto, commission: Math.abs(dto.commission) };
    const pnl = calculatePnl(dto);
    const riskReward = calculateRiskReward(dto);

    const activeSession = batch ? batch.activeSession : await this.findActiveSession(userId);

    const accountId = await this.targetAccountId(userId, dto, activeSession, batch);

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
        // Au centime par roundCents (B1, #981), même sans prix d'entrée (Binance Spot : entry 0).
        pnl: dto.pnl != null ? roundCents(dto.pnl) : pnl,
        riskReward: rr,
        quantity: dto.quantity ?? 1,
        capitalEngaged: dto.capitalEngaged ?? null,
        executionScore,
        executionGrade,
        executionMethod,
        userId,
        // 1 session = 1 compte : un trade d'un autre compte (synchro broker) n'entre pas
        // dans la session active, sinon il gonfle son P&L (#457). Session sans compte
        // (ancienne donnée) : tous les comptes, comme à la clôture et dans les stats du jour.
        // Et seulement un trade de la journée CME de la session : un import d'historique ou une synchro
        // complète y rattachait tous les trades passés (totaux de séance et émotion faussés, #994).
        sessionId:
          activeSession &&
          (!activeSession.accountId || activeSession.accountId === accountId) &&
          inSessionDay(activeSession.startedAt, dto.tradedAt ? new Date(dto.tradedAt) : new Date())
            ? activeSession.id
            : null,
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
    if (!batch) await this.analyticsService.invalidateUserCache(userId);

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
    // Trade rapide (#671) : « Revenge » ou « Peur » juste après une perte = signal enregistré en silence.
    if (!batch && (opts.source ?? TradeSource.MANUAL) === TradeSource.MANUAL && (dto.emotion === 'REVENGE' || dto.emotion === 'FEAR')) {
      void this.signals?.recordEmotionAfterLoss(userId, { id: trade.id, accountId, emotion: dto.emotion, tradedAt: trade.tradedAt });
    }
    // Saisie à la main : le trade peut faire franchir une limite (l'import le vérifie, lui, en fin de lot).
    if (!opts.deferBehavioral && !batch && accountId) await this.incidents?.detectQuietly(userId, accountId, 'sync');
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
    dtos: ImportTradeInput[],
    /** D'où vient ce lot : fichier de l'utilisateur, séance du broker, ou son historique. */
    source: TradeSource = TradeSource.CSV_IMPORT,
  ): Promise<{
    created: number;
    /** Positions Tradovate déjà en base qui ont grandi depuis (#956) : champs du broker mis à jour. */
    updated: number;
    duplicates: number;
    failed: number;
    total: number;
    /** Trades créés ici qui existaient déjà dans un autre compte (copy trading, #1001). */
    alsoInOtherAccounts: { accountId: string; name: string; count: number }[];
  }> {
    // Lot vide (synchro broker sans nouveau trade, le cas courant) : aucune requête (SCA-B1-01).
    if (dtos.length === 0) return { created: 0, updated: 0, duplicates: 0, failed: 0, total: 0, alsoInOtherAccounts: [] };

    // Les paires d'une position entrent dans la fenêtre : ce sont elles qu'on compare à l'ancien format.
    const flat = dtos.flatMap((d) => [d, ...(d._pairs ?? [])]);
    const existing = await this.prisma.trade.findMany({
      where: { userId, ...importDedupeWindow(flat) },
      select: { asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true, accountId: true },
    });
    // Positions déjà importées sous leur clé stable (#956), quelle que soit leur date.
    const positionKeys = [...new Set(dtos.map((d) => d._positionKey).filter((k): k is string => !!k))];
    const byPositionKey = new Map(
      (positionKeys.length
        ? await this.prisma.trade.findMany({
            where: { userId, importHash: { in: positionKeys } },
            select: {
              id: true, importHash: true, quantity: true, side: true, stopLoss: true, takeProfit: true, accountId: true,
              sessionId: true, emotion: true, capitalEngaged: true,
            },
          })
        : []
      ).map((t) => [t.importHash as string, t]),
    );
    // Dédoublonnage PAR COMPTE (#1001) : un trade n'est un doublon que s'il existe déjà dans le compte
    // où il va. Le même trade copié sur deux comptes (copy trading) est importé dans chacun. Dans
    // chaque compte, mêmes rapprochements qu'avant : autre fuseau (CSV sans fuseau ↔ API en UTC),
    // ancien P&L net MEXC (#947), ancien arrondi `toFixed` (B1, #981), répétitions numérotées.
    // Empreintes d'avant #1001 (sans préfixe de compte) déjà en base pour ces clés, quelle que soit la
    // date : un trade importé puis MODIFIÉ (prix, P&L, date) ne se reconnaît plus à ses champs, et
    // l'index ne le protège plus puisque la nouvelle empreinte est préfixée. Reprises compte par compte.
    const sourceCounts = new Map<string, number>();
    for (const d of flat) sourceCounts.set(dedupeKey(d), (sourceCounts.get(dedupeKey(d)) ?? 0) + 1);
    const candidates = [...sourceCounts].flatMap(([k, c]) => Array.from({ length: c }, (_, i) => occurrenceHash(k, i + 1)));
    const legacyHashes = candidates.length
      ? ((await this.prisma.trade.findMany({
          where: { userId, importHash: { in: candidates } },
          select: { importHash: true, accountId: true },
        })) ?? [])
      : [];
    const states = new AccountDedupeStates(existing, legacyHashes);

    let created = 0;
    let updated = 0;
    let duplicates = 0;
    let failed = 0;
    // Comptes touchés → un seul recalcul comportemental par compte à la fin (pas de N+1).
    const affectedAccounts = new Set<string>();
    // Trades créés qui existaient déjà dans un autre compte, par compte : dit dans le résultat.
    const alsoIn = new Map<string, number>();
    const batch = await this.importBatch(userId);

    const createOne = async (dto: Partial<CreateTradeDto>, importHash: string): Promise<boolean> => {
      try {
        const t = await this.create(userId, withoutImportMeta(dto) as CreateTradeDto, {
          deferBehavioral: true,
          importHash,
          source,
          batch,
        });
        if (t.accountId) affectedAccounts.add(t.accountId);
        created++;
        return true;
      } catch (err) {
        // P2002 = un import concurrent (double-clic) a déjà écrit ce trade : doublon,
        // pas échec. Toute autre erreur reste un échec de ligne.
        if (isUniqueConstraintError(err)) duplicates++;
        else failed++;
        return false;
      }
    };

    // Trade par paire (ou d'un autre broker) : empreinte exacte numérotée + rapprochements, dans son compte.
    const importPair = async (dto: Partial<CreateTradeDto>, accountId: string | null): Promise<void> => {
      const st = states.for(accountId);
      if (st.otherTimezone.take(dto)) {
        duplicates++;
        return;
      }
      const key = dedupeKey(dto);
      const n = (st.inSource.get(key) ?? 0) + 1;
      st.inSource.set(key, n);
      const hash = occurrenceHash(key, n);
      if (st.seen.has(hash) || st.legacyNet.take(dto) || st.centRounding.take(dto)) {
        duplicates++;
        return;
      }
      st.seen.add(hash);
      const other = states.otherAccountWith(accountId, dto);
      if ((await createOne(dto, accountImportHash(accountId, hash))) && other) {
        alsoIn.set(other, (alsoIn.get(other) ?? 0) + 1);
      }
    };

    for (const dto of dtos) {
      // Compte où ira le trade, résolu comme à la création. Compte invalide → null : la création échouera.
      const accountId = await this.targetAccountId(userId, dto, batch.activeSession, batch).catch(() => null);
      const key = dto._positionKey;
      if (!key) {
        await importPair(dto, accountId);
        continue;
      }
      const stored = byPositionKey.get(key);
      if (stored) {
        // Déjà importée. Plus de contrats qu'en base : la position avait été vue en partie
        // (rapport mensuel coupé, fichier partiel) → champs du BROKER seulement, jamais une saisie.
        if ((dto.quantity ?? 0) > (stored.quantity ?? 1) && (await this.growPosition(stored, dto))) {
          if (stored.accountId) affectedAccounts.add(stored.accountId);
          updated++;
        } else {
          duplicates++;
        }
        continue;
      }
      const st = states.for(accountId);
      if (st.seen.has(key)) {
        duplicates++;
        continue;
      }
      // Ancien format déjà en base dans ce compte (une ligne par paire) : paire par paire, aucun
      // doublon avant la réparation des trades existants.
      const pairInBase = (p: Partial<CreateTradeDto>) =>
        st.inBase.has(dedupeKey(p)) || st.otherTimezone.has(p) || st.legacyNet.has(p) || st.centRounding.has(p);
      if (dto._pairs?.length && dto._pairs.some(pairInBase)) {
        for (const p of dto._pairs) await importPair(p, accountId);
        continue;
      }
      st.seen.add(key);
      await createOne(dto, key);
    }

    // Barème comportemental recalculé une fois par compte, sur l'ensemble de son historique.
    for (const accountId of affectedAccounts) {
      await this.recomputeBehavioralGrades(accountId);
      // Limite franchie d'après les trades importés ou synchronisés : autopsie (#669), best-effort.
      await this.incidents?.detectQuietly(userId, accountId, 'sync');
    }
    // Cache analytics invalidé une fois pour tout le lot (SCA-B1-03), pas à chaque ligne.
    if (created > 0 || updated > 0) await this.analyticsService.invalidateUserCache(userId);

    return { created, updated, duplicates, failed, total: dtos.length, alsoInOtherAccounts: await this.accountNames(userId, alsoIn) };
  }

  /** `{ compte: nombre }` → `[{ accountId, name, count }]`, noms lus en une requête (jamais d'un autre trader). */
  private async accountNames(
    userId: string,
    counts: Map<string, number>,
  ): Promise<{ accountId: string; name: string; count: number }[]> {
    if (counts.size === 0) return [];
    const rows = await this.prisma.tradingAccount.findMany({
      where: { userId, id: { in: [...counts.keys()] } },
      select: { id: true, label: true },
    });
    return rows.map((r) => ({ accountId: r.id, name: r.label, count: counts.get(r.id) ?? 0 }));
  }

  /**
   * Position Tradovate déjà importée qui a grandi (#956) : prix moyens, quantité, P&L, frais et
   * clôture repris du broker. Stop, objectif, émotion, setup et notes restent ceux du Journal ;
   * le R/R et, si le trade a un stop, la note d'exécution sont recalculés sur la nouvelle entrée
   * moyenne (comme `update()`). Totaux de la séance clôturée rafraîchis. Faux si la ligne a disparu.
   */
  private async growPosition(
    stored: {
      id: string; side: string; stopLoss: number | null; takeProfit: number | null; accountId: string | null;
      sessionId: string | null; emotion: string | null; capitalEngaged: number | null;
    },
    dto: Partial<CreateTradeDto>,
  ): Promise<boolean> {
    const rr = plannedRiskReward(stored.side as 'LONG' | 'SHORT', dto.entry, stored.stopLoss, stored.takeProfit);
    // Barème A (stop présent) : intrinsèque, recalculé ici. Sans stop : barème B comportemental,
    // reposé par le recalcul par compte de fin de lot.
    let execData: { executionScore?: number | null; executionGrade?: ExecutionGrade | null; executionMethod?: ExecutionMethod | null } = {};
    if (stored.stopLoss != null) {
      const moodStart = stored.sessionId
        ? (await this.prisma.tradeSession.findUnique({ where: { id: stored.sessionId }, select: { moodStart: true } }))?.moodStart ?? null
        : null;
      const a = await this.computeExecution(stored.accountId ?? undefined, {
        side: stored.side, entry: dto.entry, exit: dto.exit, stopLoss: stored.stopLoss, takeProfit: stored.takeProfit,
        riskReward: rr ?? null, emotion: stored.emotion, capitalEngaged: stored.capitalEngaged, tradeSession: { moodStart },
      });
      execData = {
        executionScore: a.score,
        executionGrade: a.grade,
        executionMethod: a.grade != null ? ExecutionMethod.STOP_BASED : null,
      };
    }
    const res = await this.prisma.trade.updateMany({
      where: { id: stored.id },
      data: {
        entry: dto.entry ?? 0,
        exit: dto.exit ?? null,
        quantity: dto.quantity ?? 1,
        pnl: dto.pnl != null ? roundCents(dto.pnl) : undefined,
        commission: dto.commission != null ? Math.abs(dto.commission) : undefined,
        tradedAt: dto.tradedAt ? new Date(dto.tradedAt) : undefined,
        session: dto.session,
        ...(rr !== undefined ? { riskReward: rr } : {}),
        ...execData,
      },
    });
    if (res.count === 0) return false;
    // Totaux stockés de la séance clôturée (P&L, nombre de contrats) : jamais figés (#947).
    await refreshClosedSessionTotals(this.prisma, [stored.sessionId]);
    return true;
  }

  /**
   * Compte d'un nouveau trade : fourni (validé) → sinon hérité de la séance active → sinon compte par
   * défaut (anti-NULL : jamais de trade sans compte). Partagé par la création et le dédoublonnage de
   * l'import, qui doit savoir dans quel compte ira chaque ligne (#1001).
   */
  private async targetAccountId(
    userId: string,
    dto: Partial<CreateTradeDto>,
    activeSession: { accountId: string | null } | null,
    batch?: ImportBatch,
  ): Promise<string> {
    let accountId: string | undefined;
    if (dto.accountId && dto.accountId !== 'all') {
      accountId = batch
        ? await batch.account(dto.accountId)
        : (await this.accounts.accountWhere(userId, dto.accountId)).accountId;
    }
    if (!accountId) accountId = activeSession?.accountId ?? undefined;
    if (!accountId) accountId = await (batch ? batch.defaultAccount() : this.accounts.ensureDefaultAccountId(userId));
    return accountId;
  }

  private findActiveSession(userId: string) {
    return this.prisma.tradeSession.findFirst({
      where: activeSessionWhere(userId),
      select: ACTIVE_SESSION_SELECT,
    });
  }

  private importBatch(userId: string): Promise<ImportBatch> {
    return createImportBatch(userId, {
      activeSession: () => this.findActiveSession(userId),
      setups: this.setups,
      accounts: this.accounts,
    });
  }



  /**
   * Compte les doublons existants pour un user (lignes en trop par rapport aux uniques). Un doublon
   * est dans le MÊME compte (#1001) : le même trade sur deux comptes (copy trading) n'en est pas un.
   */
  async countDuplicates(
    userId: string,
  ): Promise<{ total: number; unique: number; duplicates: number }> {
    const trades = await this.prisma.trade.findMany({
      where: { userId },
      select: { asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true, importHash: true, accountId: true },
    });
    const keys = new Set(trades.map((t) => accountDuplicateIdentity(t)));
    return { total: trades.length, unique: keys.size, duplicates: trades.length - keys.size };
  }

  /** Supprime les doublons en gardant la plus ancienne occurrence de chaque clé, compte par compte (#1001). */
  async removeDuplicates(userId: string): Promise<{ removed: number; kept: number }> {
    const trades = await this.prisma.trade.findMany({
      where: { userId },
      select: { id: true, asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true, importHash: true, accountId: true },
      orderBy: { createdAt: 'asc' }, // garder la 1ʳᵉ occurrence créée
    });
    const seen = new Set<string>();
    const toDelete: string[] = [];
    for (const t of trades) {
      const key = accountDuplicateIdentity(t);
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
  ): Promise<JournalStats & { excludedAccounts: { failed: number; archived: number } }> {
    // Ownership du compte validé au niveau contrôleur (accountWhere), comme findAll. Calcul en
    // base (SCA-B2-02) avec le même filtre que la liste (buildTradeFilterSql ≡ buildTradeWhere),
    // filtre des comptes perdus compris : liste et chiffres lisent le même jeu de trades.
    return journalStatsForFilters(this.prisma, userId, filters);
  }

  async findAll(userId: string, filters: TradeFiltersDto) {
    const { cursor, limit = 20 } = filters;
    const where = await resolveTradeWhere(this.prisma, userId, filters);

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
        // Compte perdu : badge « Échoué » / « Archivé » côté front (trades listés avec includeInactive
        // ou sur un compte précis ; exclus par défaut en « tous les comptes », comme les chiffres).
        account: { select: { id: true, label: true, status: true } },
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
    // 404 et non 403 : ne pas révéler qu'un trade d'un autre utilisateur existe (#994, S6).
    if (trade.userId !== userId) throw new NotFoundException('Trade introuvable');
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
    // Compte, même règle (#994) : « all » = filtre « Tous les comptes », jamais un compte (retiré) ;
    // un compte qui change est vérifié comme à la création (404 s'il n'est pas à l'utilisateur).
    if (dto.accountId === 'all') dto = { ...dto, accountId: undefined };
    else if (dto.accountId && dto.accountId !== existing.accountId) await this.accounts.accountWhere(userId, dto.accountId);

    if (dto.commission != null) dto = { ...dto, commission: Math.abs(dto.commission) }; // cf. create
    const merged = { ...existing, ...dto } as CreateTradeDto;

    const priceFieldsChanged =
      dto.entry !== undefined ||
      dto.exit !== undefined ||
      dto.quantity !== undefined ||
      dto.commission !== undefined ||
      dto.pnl !== undefined;

    // `merged` porte l'ancien `pnl` : `calculatePnl` le renvoyait tel quel, et changer un prix sans
    // envoyer de P&L gardait l'ancien (#947). Recalcul depuis les prix quand un prix, la quantité, le
    // sens ou le capital CHANGE réellement (le front renvoie le DTO complet), sans P&L fourni, et
    // seulement si la règle est sûre : valeur du tick connue ou capital engagé. Jamais sur un trade
    // importé (P&L réalisé du broker, quantité parfois en contrats : instruments.md).
    const moved = (['entry', 'exit', 'quantity', 'side', 'capitalEngaged'] as const).some(
      (k) => dto[k] !== undefined && dto[k] !== existing[k],
    );
    const recomputable =
      !existing.importHash &&
      (getTickValue(merged.asset) != null || (merged.capitalEngaged != null && merged.capitalEngaged > 0));
    const newPnl =
      dto.pnl === undefined && moved && recomputable
        ? calculatePnl({ ...merged, pnl: undefined })
        : priceFieldsChanged ? calculatePnl(merged) : undefined;
    // R/R recalculé dès qu'un de SES champs change : avant, ajouter ou retirer un stop sans toucher
    // aux prix laissait le R/R d'avant (absent ou périmé). Un R/R fourni par le client prime, comme
    // à la création ; sinon un R/R devenu incalculable s'efface (null), il ne reste pas figé.
    const rrFieldsChanged =
      priceFieldsChanged ||
      dto.stopLoss !== undefined ||
      dto.takeProfit !== undefined ||
      dto.side !== undefined;
    const computedRR = rrFieldsChanged ? calculateRiskReward(merged) : undefined;
    const newRR: number | null | undefined =
      computedRR !== undefined ? computedRR
      : rrFieldsChanged && dto.riskReward === undefined ? null
      : undefined;

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
          riskReward: newRR === undefined ? merged.riskReward : newRR,
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
        // P&L fourni sans réponse de calculatePnl (entrée à 0) : au centime quand même (B1, #981).
        ...(newPnl !== undefined ? { pnl: newPnl } : dto.pnl != null ? { pnl: roundCents(dto.pnl) } : {}),
        ...(newRR !== undefined ? { riskReward: newRR } : {}),
        ...execData,
      },
      include: {
        setup: { select: { id: true, title: true, color: true } },
        tradeSession: { select: { moodStart: true } },
      },
    });
    // Totaux stockés de la séance clôturée (ancienne et nouvelle si le trade change de séance).
    await refreshClosedSessionTotals(this.prisma, [existing.sessionId, result.sessionId]);
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

  /**
   * Saisie rapide du stop initial (et de l'objectif) depuis le Journal, typiquement sur un trade
   * synchronisé : la synchronisation n'a pas pu relier le stop. Refuse un stop (ou un objectif) du mauvais
   * côté de l'entrée, puis passe par `update` : R/R par la même règle que la saisie manuelle
   * (`calculateRiskReward`), note d'exécution « avec stop » et recalcul comportemental du compte.
   * Une resynchronisation n'écrase rien : l'import broker ne fait qu'insérer (dédoublonnage), il ne
   * met jamais à jour un trade existant.
   */
  async setStop(userId: string, id: string, dto: SetTradeStopDto) {
    const existing = await this.findOne(userId, id);
    const takeProfit = dto.takeProfit === undefined ? existing.takeProfit : dto.takeProfit;
    const error = stopPlacementError(existing.side, existing.entry, dto.stopLoss, takeProfit);
    if (error) throw new BadRequestException(error);
    // `takeProfit: null` doit atteindre Prisma pour RETIRER l'objectif (UpdateTradeDto ne type pas null).
    const patch: Omit<UpdateTradeDto, 'takeProfit'> & { takeProfit?: number | null } = { stopLoss: dto.stopLoss };
    if (dto.takeProfit !== undefined) patch.takeProfit = dto.takeProfit;
    return this.update(userId, id, patch as UpdateTradeDto);
  }

  async remove(userId: string, id: string) {
    const existing = await this.findOne(userId, id);
    await this.prisma.trade.delete({ where: { id } });
    await refreshClosedSessionTotals(this.prisma, [existing.sessionId]);
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
    const where = { userId, accountId, source: { in: BROKER_TRADE_SOURCES } };
    const sessions = await this.prisma.trade.findMany({ where, select: { sessionId: true }, distinct: ['sessionId'] });
    const { count } = await this.prisma.trade.deleteMany({ where });
    if (count > 0) {
      await refreshClosedSessionTotals(this.prisma, sessions.map((s) => s.sessionId));
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
      select: { accountId: true, sessionId: true },
    });
    const result = await this.prisma.trade.updateMany({
      where: { id: { in: tradeIds }, userId },
      data: { accountId },
    });
    // 1 séance = 1 compte : un trade déplacé sort des totaux de sa séance d'un autre compte.
    await refreshClosedSessionTotals(this.prisma, before.map((t) => t.sessionId));
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

  /**
   * Fusionne les lignes d'une même position Tradovate importées avant #956 (réparation lancée par
   * l'admin) : la ligne gardée prend les champs du broker de la position (clé `tv:`), son R/R et sa
   * note d'exécution « stop » sont recalculés comme dans `update()`, les alertes de comportement
   * des lignes supprimées lui sont rattachées. Tout ou rien (transaction). Faux si une ligne a
   * disparu ou changé de propriétaire entre-temps. Recalculs par compte : `refreshAfterFeesRepair`.
   */
  async mergeImportedPosition(
    userId: string,
    merge: {
      keepId: string;
      removeIds: string[];
      data: {
        entry: number; exit: number | null; quantity: number; pnl: number | null; commission: number | null;
        tradedAt: Date; session: TradingSession; importHash: string;
      };
    },
  ): Promise<boolean> {
    const keep = await this.prisma.trade.findFirst({
      where: { id: merge.keepId, userId },
      select: { side: true, stopLoss: true, takeProfit: true, emotion: true, capitalEngaged: true, accountId: true, sessionId: true },
    });
    if (!keep) return false;
    const rr = plannedRiskReward(keep.side, merge.data.entry, keep.stopLoss, keep.takeProfit);
    let execData: { executionScore?: number | null; executionGrade?: ExecutionGrade | null; executionMethod?: ExecutionMethod | null } = {};
    if (keep.stopLoss != null) {
      const moodStart = keep.sessionId
        ? (await this.prisma.tradeSession.findUnique({ where: { id: keep.sessionId }, select: { moodStart: true } }))?.moodStart ?? null
        : null;
      const a = await this.computeExecution(keep.accountId ?? undefined, {
        side: keep.side, entry: merge.data.entry, exit: merge.data.exit, stopLoss: keep.stopLoss, takeProfit: keep.takeProfit,
        riskReward: rr ?? null, emotion: keep.emotion, capitalEngaged: keep.capitalEngaged, tradeSession: { moodStart },
      });
      execData = { executionScore: a.score, executionGrade: a.grade, executionMethod: a.grade != null ? ExecutionMethod.STOP_BASED : null };
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.behaviorAlert.updateMany({ where: { tradeId: { in: merge.removeIds } }, data: { tradeId: merge.keepId } });
        const removed = await tx.trade.deleteMany({ where: { id: { in: merge.removeIds }, userId } });
        if (removed.count !== merge.removeIds.length) throw new Error('lignes de la position introuvables');
        await tx.trade.update({
          where: { id: merge.keepId },
          data: { ...merge.data, ...(rr !== undefined ? { riskReward: rr } : {}), ...execData },
        });
      });
    } catch (err) {
      if ((err as Error).message === 'lignes de la position introuvables' || isUniqueConstraintError(err)) return false;
      throw err;
    }
    return true;
  }

  /**
   * Après une correction en masse des frais (réparation #783) : barème du compte recalculé et
   * cache analytics invalidé, comme après un import.
   */
  async refreshAfterFeesRepair(userId: string, accountId: string): Promise<void> {
    await this.recomputeBehavioralGrades(accountId);
    const sessions = await this.prisma.trade.findMany({
      where: { userId, accountId, sessionId: { not: null } },
      select: { sessionId: true },
      distinct: ['sessionId'],
    });
    await refreshClosedSessionTotals(this.prisma, sessions.map((s) => s.sessionId));
    await this.analyticsService.invalidateUserCache(userId);
  }
}

/** `at` tombe dans la journée de trading CME de la session (même règle que la clôture). */
function inSessionDay(sessionStart: Date, at: Date): boolean {
  return at >= tradingDayStart(sessionStart) && at < tradingDayEnd(sessionStart);
}
