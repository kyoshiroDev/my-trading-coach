import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  Prisma,
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
import { CrossSourcePool, importDedupeWindow } from './import-dedupe.util';
import { ACTIVE_SESSION_SELECT, createImportBatch, type ImportBatch } from './import-batch';
import { activeSessionWhere } from '../session/active-session';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import type { SetTradeStopDto } from './dto/set-trade-stop.dto';
import { TradeFiltersDto } from './dto/trade-filters.dto';
import { resolveTradeWhere } from './trade-filters.util';
import { getTickValue } from './instruments.const';
import { refreshClosedSessionTotals } from '../session/refresh-session-totals';
import { calculatePnl, calculateRiskReward } from './trade-metrics.util';
import { CentRoundingPool, dedupeKey, duplicateIdentity, LegacyNetPnlPool, occurrenceHash, withoutImportMeta, type ImportTradeInput } from './trade-identity.util';
import { journalStatsForFilters, type JournalStats } from './journal-stats.util';
import { recomputeBehavioralGrades } from './behavioral-grades';
import { plannedRiskReward, roundCents, stopPlacementError } from '@mtc/shared';
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

    // accountId : fourni (validé) → sinon hérité de la session active → sinon compte
    // par défaut (anti-NULL : jamais de trade sans compte).
    let accountId: string | undefined;
    if (dto.accountId && dto.accountId !== 'all') {
      accountId = batch
        ? await batch.account(dto.accountId)
        : (await this.accounts.accountWhere(userId, dto.accountId)).accountId;
    }
    if (!accountId) accountId = activeSession?.accountId ?? undefined;
    if (!accountId) accountId = await (batch ? batch.defaultAccount() : this.accounts.ensureDefaultAccountId(userId));

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
        sessionId:
          activeSession && (!activeSession.accountId || activeSession.accountId === accountId)
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
  }> {
    // Lot vide (synchro broker sans nouveau trade, le cas courant) : aucune requête (SCA-B1-01).
    if (dtos.length === 0) return { created: 0, updated: 0, duplicates: 0, failed: 0, total: 0 };

    // Les paires d'une position entrent dans la fenêtre : ce sont elles qu'on compare à l'ancien format.
    const flat = dtos.flatMap((d) => [d, ...(d._pairs ?? [])]);
    const existing = await this.prisma.trade.findMany({
      where: { userId, ...importDedupeWindow(flat) },
      select: { asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true },
    });
    // Positions déjà importées sous leur clé stable (#956), quelle que soit leur date.
    const positionKeys = [...new Set(dtos.map((d) => d._positionKey).filter((k): k is string => !!k))];
    const byPositionKey = new Map(
      (positionKeys.length
        ? await this.prisma.trade.findMany({
            where: { userId, importHash: { in: positionKeys } },
            select: { id: true, importHash: true, quantity: true, side: true, stopLoss: true, takeProfit: true, accountId: true },
          })
        : []
      ).map((t) => [t.importHash as string, t]),
    );
    // Même trade déjà en base mais daté dans un autre fuseau (export CSV sans fuseau ↔ API en
    // UTC) : doublon, un-pour-un. Vaut dans les deux sens : CSV avant OU après la synchro.
    const otherTimezone = new CrossSourcePool(existing);
    // Trade stocké à l'ancien format (P&L net, ancien parseur MEXC) : doublon, un-pour-un (#947).
    const legacyNet = new LegacyNetPnlPool(existing);
    // Trade stocké avec l'ancien arrondi `toFixed` (1 centime d'écart sur un demi-centime) : doublon (B1, #981).
    const centRounding = new CentRoundingPool(existing);
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
    let updated = 0;
    let duplicates = 0;
    let failed = 0;
    // Comptes touchés → un seul recalcul comportemental par compte à la fin (pas de N+1).
    const affectedAccounts = new Set<string>();
    // Rang de chaque clé DANS la source : deux lignes identiques sont deux trades (cf. occurrenceHash).
    const inSource = new Map<string, number>();
    const batch = await this.importBatch(userId);

    const createOne = async (dto: Partial<CreateTradeDto>, importHash: string): Promise<void> => {
      try {
        const t = await this.create(userId, withoutImportMeta(dto) as CreateTradeDto, {
          deferBehavioral: true,
          importHash,
          source,
          batch,
        });
        if (t.accountId) affectedAccounts.add(t.accountId);
        created++;
      } catch (err) {
        // P2002 = un import concurrent (double-clic) a déjà écrit ce trade : doublon,
        // pas échec. Toute autre erreur reste un échec de ligne.
        if (isUniqueConstraintError(err)) duplicates++;
        else failed++;
      }
    };

    // Trade par paire (ou d'un autre broker) : empreinte exacte numérotée + rapprochements.
    const importPair = async (dto: Partial<CreateTradeDto>): Promise<void> => {
      if (otherTimezone.take(dto)) {
        duplicates++;
        return;
      }
      const key = dedupeKey(dto);
      const n = (inSource.get(key) ?? 0) + 1;
      inSource.set(key, n);
      const hash = occurrenceHash(key, n);
      if (seen.has(hash) || legacyNet.take(dto) || centRounding.take(dto)) {
        duplicates++;
        return;
      }
      seen.add(hash);
      await createOne(dto, hash);
    };

    // Une paire de la position est-elle déjà en base, importée avant #956 (trade par paire) ?
    const pairInBase = (p: Partial<CreateTradeDto>) =>
      inBase.has(dedupeKey(p)) || otherTimezone.has(p) || legacyNet.has(p) || centRounding.has(p);

    for (const dto of dtos) {
      const key = dto._positionKey;
      if (!key) {
        await importPair(dto);
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
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      // Ancien format déjà en base (une ligne par paire) : paire par paire, aucun doublon avant
      // la réparation des trades existants.
      if (dto._pairs?.length && dto._pairs.some(pairInBase)) {
        for (const p of dto._pairs) await importPair(p);
        continue;
      }
      seen.add(key);
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

    return { created, updated, duplicates, failed, total: dtos.length };
  }

  /**
   * Position Tradovate déjà importée qui a grandi (#956) : prix moyens, quantité, P&L, frais et
   * clôture repris du broker. Stop, objectif, émotion, setup et notes restent ceux du Journal ;
   * le R/R est recalculé sur la nouvelle entrée moyenne. Faux si la ligne a disparu entre-temps.
   */
  private async growPosition(
    stored: { id: string; side: string; stopLoss: number | null; takeProfit: number | null },
    dto: Partial<CreateTradeDto>,
  ): Promise<boolean> {
    const rr = plannedRiskReward(stored.side as 'LONG' | 'SHORT', dto.entry, stored.stopLoss, stored.takeProfit);
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
      },
    });
    return res.count > 0;
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
