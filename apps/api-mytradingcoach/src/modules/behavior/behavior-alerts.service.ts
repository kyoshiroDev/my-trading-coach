import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { BrokerProvider, type Prisma } from '@prisma/client';
import { subscriptionState, type PropFirmPhaseRules } from '@mtc/shared';
import { BehaviorMutesService } from './behavior-mutes.service';
import { PrismaService } from '@api/prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AccountsService } from '../accounts/accounts.service';
import { tradingDay } from '../accounts/account-rules';
import { activeSessionWhere } from '../session/active-session';
import { openPositionsKey, parseOpenPositions } from '../integrations/tradovate/tradovate-open-positions';
import { ANTI_SPAM_MS, E1_ONCE_TTL_S } from './behavior.constants';
import { stopWidenedDraft, stopWidening } from './behavior-stop';
import { getTickSize } from '../trades/instruments.const';
import type { StopVersionChange } from '../integrations/tradovate/tradovate-orders';
import { BEHAVIOR_TRADE_SELECT, BehaviorBaselineService, toBehaviorTrade } from './behavior-baseline.service';
import { type BehaviorAlertDraft, type EntryContext, evaluateEntry } from './behavior-detectors';
import { type SeenPositions, newEntries, snapshot } from './behavior-entries';
import { maxContractsAt, phaseForAccountType } from './behavior-plan';
import { groupPositions } from './behavior-positions';
import { TraderNotifier } from '../push/trader-notifier.service';
import { TRADER_PUSH_MESSAGES } from '../push/trader-push-messages';
import { NewsShieldService, type NewsAlertEmit } from './news-shield.service';
import { newsShieldMinutes } from './behavior-news';

/** Une rafale d'événements broker (fills, position) : une évaluation, juste après. */
export const BEHAVIOR_DEBOUNCE_MS = 1_500;
/** Dernier état des positions vu par le moteur : le temps d'une séance. */
const SEEN_TTL_S = 12 * 3600;

export const seenKey = (accountId: string) => `behavior:pos:${accountId}`;
const spamKey = (accountId: string, day: string, type: string) => `behavior:spam:${accountId}:${day}:${type}`;
/** E1 (#672) : une alerte par position (compte, contrat, ouverture). */
export const stopOnceKey = (accountId: string, contractId: number, opened: string) => `behavior:stop:${accountId}:${contractId}:${opened}`;

import { behaviorAlertsRecordEnabled, behaviorAlertsUiEnabled } from './behavior-flags';
// Interrupteurs déplacés dans `behavior-flags.ts` (#671) : réexportés pour les imports existants.
export { behaviorAlertsRecordEnabled, behaviorAlertsUiEnabled };

export interface BehaviorAlertEvent extends BehaviorAlertDraft {
  id: string;
  accountId: string;
}
export type BehaviorAlertEmit = (event: 'behavior:alert' | 'news:alert', payload: BehaviorAlertEvent) => void;

/**
 * Détecteurs de comportement en direct (#602, phase 1 = SILENCIEUX).
 *
 * Déclenché par le gateway `/tradovate-live` à chaque solde poussé après une synchro (donc à chaque
 * fill / position), sur le worker titulaire du WebSocket : aucun appel Tradovate en plus, aucune
 * synchro relancée, aucun appel IA. Compare les positions ouvertes (Redis, écrites par la synchro)
 * au dernier état vu, et évalue les détecteurs sur chaque nouvelle entrée. Les alertes sont
 * ENREGISTRÉES (`BehaviorAlert`) ; l'événement `behavior:alert` ne part que si
 * `BEHAVIOR_ALERTS_UI=true`. Best-effort : un échec est journalisé, jamais propagé.
 */
@Injectable()
export class BehaviorAlertsService implements OnModuleDestroy {
  private readonly logger = new Logger(BehaviorAlertsService.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly accounts: AccountsService,
    private readonly baselines: BehaviorBaselineService,
    /** Push vers les appareils du trader (#666). */
    @Optional() private readonly notifier?: TraderNotifier,
    /** Bouclier annonces (#670) : affiché tout de suite, hors `BEHAVIOR_ALERTS_UI`. */
    @Optional() private readonly newsShield?: NewsShieldService,
    /** Détecteurs coupés par le trader (#671) : enregistrés, jamais envoyés. */
    @Optional() private readonly mutes?: BehaviorMutesService,
  ) {}

  /**
   * Envoi d'une alerte enregistrée (#671) : seulement si l'affichage est allumé, si le trader a l'accès
   * Premium (comme l'anti-tilt #371) et s'il n'a pas coupé ce détecteur. Sinon : enregistrée en silence.
   */
  private async audience(userId: string, user: { plan: string | null; role: string | null; trialEndsAt: Date | null }, now: Date) {
    const muted = (await this.mutes?.mutedSet(userId).catch(() => new Set<string>())) ?? new Set<string>();
    const canShow = behaviorAlertsUiEnabled() && subscriptionState(user, now).premiumAccess;
    return { muted, shows: (type: string) => canShow && !muted.has(type) };
  }

  schedule(userId: string, accountId: string, emit: BehaviorAlertEmit): void {
    if (!behaviorAlertsRecordEnabled()) return;
    const prev = this.timers.get(accountId);
    if (prev) clearTimeout(prev);
    this.timers.set(
      accountId,
      setTimeout(() => {
        this.timers.delete(accountId);
        void this.check(userId, accountId, emit).catch((err: unknown) =>
          this.logger.warn(`Comportement non évalué (compte ${accountId}) : ${(err as Error).message}`),
        );
      }, BEHAVIOR_DEBOUNCE_MS),
    );
  }

  /** Évalue les nouvelles entrées du compte ; renvoie les alertes enregistrées. */
  async check(userId: string, accountId: string, emit: BehaviorAlertEmit, now = new Date()): Promise<number> {
    const conn = await this.prisma.brokerConnection.findUnique({
      where: { accountId_provider: { accountId, provider: BrokerProvider.TRADOVATE } },
      select: { id: true, user: { select: { isDemo: true, tradesPerDayMax: true, newsShieldMinutes: true, plan: true, role: true, trialEndsAt: true } } },
    });
    if (!conn || conn.user.isDemo) return 0;

    const state = parseOpenPositions(await this.redis.client.get(openPositionsKey(conn.id)));
    const positions = (state?.positions ?? []).map((p) => ({ ...p }));
    const seenRaw = await this.redis.client.get(seenKey(accountId));
    const seen = this.parseSeen(seenRaw);
    await this.redis.client.set(seenKey(accountId), JSON.stringify(snapshot(positions)), 'EX', SEEN_TTL_S);
    // Premier relevé (rien de vu avant) : on ne sait pas ce qui est nouveau, on mémorise seulement.
    if (seen === null) return 0;
    const entries = newEntries(positions, seen);
    if (entries.length === 0) return 0;

    const day = tradingDay(now);
    const ctxBase = await this.sessionContext(userId, accountId, day, now);
    // Bouclier annonces : une panne ne prive jamais les autres détecteurs de leur évaluation.
    const news = this.newsShield?.enabled
      ? await this.newsShield.upcoming(now).catch((err: unknown) => {
          this.logger.warn(`Annonces non lues pour le bouclier : ${err instanceof Error ? err.name : 'Error'}`);
          return [];
        })
      : [];
    let recorded = 0;
    const audience = await this.audience(userId, conn.user, now);
    for (const e of entries) {
      const at = e.since ? new Date(e.since) : now;
      const ctx: EntryContext = {
        ...ctxBase,
        at: Number.isNaN(at.getTime()) ? now : at,
        // Taille comparée à la référence = position entière sur l'actif (contrats engagés).
        entry: { asset: e.asset, side: e.side, quantity: e.quantity },
        open: positions,
        tradesPerDayMax: conn.user.tradesPerDayMax,
        news,
        newsShieldMinutes: newsShieldMinutes(conn.user.newsShieldMinutes),
      };
      for (const draft of evaluateEntry(ctx)) {
        if (draft.type === 'D1_NEWS_WINDOW') {
          // Une alerte par annonce (et non par type), partagée avec le passage « avant l'annonce ».
          try {
            if (this.newsShield && (await this.newsShield.record(userId, accountId, draft, ctx.entry, ctxBase.sessionId, emit as NewsAlertEmit, now))) recorded++;
          } catch (err: unknown) {
            this.logger.warn(`Bouclier annonces non enregistré (compte ${accountId}) : ${err instanceof Error ? err.name : 'Error'}`);
          }
          continue;
        }
        // Anti-spam partagé entre workers : même type, même compte, 15 min.
        const ok = await this.redis.client.set(spamKey(accountId, day, draft.type), '1', 'PX', ANTI_SPAM_MS, 'NX');
        if (ok !== 'OK') continue;
        const row = await this.prisma.behaviorAlert.create({
          data: {
            userId, accountId, tradeDay: new Date(`${day}T00:00:00.000Z`), sessionId: ctxBase.sessionId,
            type: draft.type, severity: draft.severity, message: draft.message, mutedByUser: audience.muted.has(draft.type),
            context: { ...draft.context, entry: ctx.entry } as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        recorded++;
        if (audience.shows(draft.type)) {
          emit('behavior:alert', { ...draft, id: row.id, accountId });
          // Push (#666) : seulement quand les alertes sont affichées, jamais en phase silencieuse.
          this.notifier?.notify(userId, 'BEHAVIOR', TRADER_PUSH_MESSAGES.behavior(accountId, draft), {
            accountId, dedupKey: `behavior:${draft.type}`,
          });
        }
      }
    }
    return recorded;
  }

  /**
   * E1 « stop éloigné » (#672) : appelé par le WebSocket Tradovate quand un ordre stop change de prix
   * (avant que la nouvelle version remplace l'ancienne). Lit la position du contrat en Redis (aucun
   * appel Tradovate), évalue le détecteur pur, enregistre une fois par position. Silencieux comme les
   * autres (`BEHAVIOR_ALERTS_UI`). Best-effort : un échec est journalisé, jamais propagé.
   */
  async onStopMoved(userId: string, accountId: string, connectionId: string, change: StopVersionChange, emit: BehaviorAlertEmit, now = new Date()): Promise<boolean> {
    if (!behaviorAlertsRecordEnabled()) return false;
    try {
      const state = parseOpenPositions(await this.redis.client.get(openPositionsKey(connectionId)));
      // Stop de SORTIE : vente pour un LONG, achat pour un SHORT, sur le même contrat.
      const side = change.action === 'Sell' ? 'LONG' : 'SHORT';
      const pos = state?.positions.find((p) => p.contractId === change.contractId && p.side === side);
      if (!pos || pos.entryPrice == null) return false;
      const tickSize = getTickSize(pos.asset);
      if (!tickSize) return false;
      const w = stopWidening({ side, entryPrice: pos.entryPrice, prevStop: change.prevStop, nextStop: change.nextStop, tickSize });
      if (!w) return false;
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isDemo: true, plan: true, role: true, trialEndsAt: true } });
      if (!user || user.isDemo) return false;
      // Une fois par position : un renfort (prix moyen modifié) garde la même ouverture.
      const opened = pos.since ?? String(pos.entryPrice);
      const ok = await this.redis.client.set(stopOnceKey(accountId, change.contractId, opened), '1', 'EX', E1_ONCE_TTL_S, 'NX');
      if (ok !== 'OK') return false;
      const draft = stopWidenedDraft(pos.asset, w, {
        side, entryPrice: pos.entryPrice, prevStop: change.prevStop, nextStop: change.nextStop, quantity: pos.quantity,
      });
      const day = tradingDay(now);
      const session = await this.prisma.tradeSession.findFirst({ where: activeSessionWhere(userId), orderBy: { startedAt: 'desc' }, select: { id: true } });
      const audience = await this.audience(userId, user, now);
      const row = await this.prisma.behaviorAlert.create({
        data: {
          userId, accountId, tradeDay: new Date(`${day}T00:00:00.000Z`), sessionId: session?.id ?? null,
          type: draft.type, severity: draft.severity, message: draft.message, mutedByUser: audience.muted.has(draft.type),
          context: draft.context as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      if (audience.shows(draft.type)) {
        emit('behavior:alert', { ...draft, id: row.id, accountId });
        // Push (#666) comme les autres détecteurs : seulement quand les alertes sont affichées.
        this.notifier?.notify(userId, 'BEHAVIOR', TRADER_PUSH_MESSAGES.behavior(accountId, draft), {
          accountId, dedupKey: `behavior:${draft.type}`,
        });
      }
      return true;
    } catch (err: unknown) {
      this.logger.warn(`Stop éloigné non évalué (compte ${accountId}) : ${err instanceof Error ? err.message : 'Error'}`);
      return false;
    }
  }

  /** Séance en cours (positions clôturées du jour), référence, règles du plan relié. */
  private async sessionContext(userId: string, accountId: string, day: string, now: Date) {
    const since = new Date(now.getTime() - 26 * 3600_000);
    const [rows, baseline, account, session] = await Promise.all([
      this.prisma.trade.findMany({
        where: { userId, accountId, pnl: { not: null }, tradedAt: { gte: since } },
        orderBy: { tradedAt: 'asc' },
        select: BEHAVIOR_TRADE_SELECT,
      }),
      this.baselines.get(userId, now),
      this.accounts.list(userId, { premium: true }).then((list) => list.find((a) => a.id === accountId) ?? null),
      this.prisma.tradeSession.findFirst({ where: activeSessionWhere(userId), orderBy: { startedAt: 'desc' }, select: { id: true } }),
    ]);
    const closed = groupPositions(rows.map(toBehaviorTrade).filter((t) => tradingDay(t.tradedAt) === day));

    let maxContracts: EntryContext['maxContracts'] = null;
    if (account?.propFirmPlanId) {
      const plan = await this.prisma.propFirmPlan.findUnique({ where: { id: account.propFirmPlanId }, select: { phases: true } });
      const phase = Array.isArray(plan?.phases) ? phaseForAccountType(plan.phases as unknown as PropFirmPhaseRules[], account.type) : null;
      const m = account.metrics;
      maxContracts = maxContractsAt(phase?.max_contracts, (m.dailyLoss?.startOfDay ?? m.currentBalance) - m.startingBalance);
    }
    const dl = account?.metrics.dailyLoss ?? null;
    return {
      closed,
      baseline,
      maxContracts,
      dailyLoss: dl ? { limit: dl.limit, used: dl.used } : null,
      sessionId: session?.id ?? null,
    };
  }

  private parseSeen(raw: string | null): SeenPositions | null {
    if (raw == null) return null;
    try {
      const v = JSON.parse(raw) as unknown;
      return v && typeof v === 'object' ? (v as SeenPositions) : {};
    } catch {
      return {};
    }
  }

  onModuleDestroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
