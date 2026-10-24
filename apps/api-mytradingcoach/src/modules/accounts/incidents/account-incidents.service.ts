import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccountStatus, Prisma, type AccountIncident } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AnthropicClientService, responseText } from '../../infra/anthropic-client.service';
import { RedisService } from '../../infra/redis.service';
import { AI_MODELS } from '../../infra/ai-pricing.const';
import { isPremiumAccess, type PremiumAccessUser } from '../../discord/discord-access.util';
import { AccountsService, type PlanContext } from '../accounts.service';
import { tradingDay } from '../account-rules';
import type { UpdateAccountRequestDto } from '../dto/update-account.dto';
import {
  buildIncidentReport,
  type IncidentKind,
  type IncidentReport,
  type IncidentSnapshot,
  type PreviousSession,
} from './incident-report';
import { INCIDENT_AI_MAX_TOKENS, INCIDENT_AI_SYSTEM, buildIncidentPrompt } from './incident-ai.prompt';

export type IncidentSource = 'live' | 'sync' | 'manual';

/** Utilisateur tel que le porte la requête (JWT). */
export type IncidentUser = PremiumAccessUser & { id: string; isDemo?: boolean };

/** `period` d'un incident qui ne se produit qu'une fois par compte (plancher, échec manuel). */
const ONCE_PER_ACCOUNT = 'account';
/** Séances précédentes lues pour situer la séance de l'incident. */
const PREVIOUS_SESSIONS = 60;
/** Statuts qu'un incident confirmé a pu poser, et que « Ce n'est pas un échec » peut défaire. */
const CLOSED_BY_INCIDENT: AccountStatus[] = [AccountStatus.FAILED, AccountStatus.ARCHIVED];
/** Durée max du verrou d'analyse : couvre un appel bloqué. Libéré seulement par son expiration. */
const AI_LOCK_TTL_S = 3600;
/** Après un échec ou une réponse vide : nouvel essai possible au bout de ce délai, pas avant. */
export const AI_RETRY_DELAY_S = 120;
/** Essais d'analyse au plus par incident et par journée, réussis ou non (coût IA borné). */
export const AI_MAX_TRIES_PER_DAY = 3;

export type IncidentAiState =
  | { status: 'ready'; text: string; generatedAt: Date }
  /** Gratuit : la chronologie et les constats restent visibles, l'analyse est Premium. */
  | { status: 'locked' }
  /** Premium, pas encore générée : à demander à `GET …/analysis`. */
  | { status: 'pending' }
  /** IA coupée (hors prod), en cours ailleurs, ou appel en échec : rien d'inventé. */
  | { status: 'unavailable' };

export const INCIDENT_DISCLAIMER =
  "Estimation MyTradingCoach d'après tes trades enregistrés, pas le calcul officiel de ta firm.";

const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Autopsie d'un compte grillé (#669).
 *
 * Détection : relit les métriques de `AccountsService.list` (aucun calcul de règle dupliqué) et
 * crée l'incident si une limite est franchie ; l'unicité `accountId + kind + period` en base
 * garantit un seul incident par compte et par limite, quel que soit le nombre de déclencheurs.
 * Jamais pour un compte démo (son incident d'exemple vient du seed).
 *
 * Affichage : la chronologie et les constats se recalculent depuis les trades et les alertes
 * (zéro IA). L'analyse IA (Premium) est générée une seule fois, à la première ouverture, puis
 * conservée ; jamais régénérée.
 */
@Injectable()
export class AccountIncidentsService {
  private readonly logger = new Logger(AccountIncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly anthropic: AnthropicClientService,
    private readonly redis: RedisService,
  ) {}

  /** Crée les incidents d'un compte ACTIF dont une limite est franchie. Renvoie le nombre créé. */
  async detect(userId: string, accountId: string, source: Exclude<IncidentSource, 'manual'>, now = new Date()): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, role: true, trialEndsAt: true, isDemo: true },
    });
    if (!user || user.isDemo) return 0;
    const account = (await this.accounts.list(userId, { premium: isPremiumAccess(user) })).find((a) => a.id === accountId);
    if (!account || account.status !== AccountStatus.ACTIVE) return 0;

    const m = account.metrics;
    const today = tradingDay(now);
    const rows: Prisma.AccountIncidentCreateManyInput[] = [];
    const snapshot = (limit: number, remaining: number): IncidentSnapshot & Prisma.InputJsonObject =>
      ({ limit, remaining, detectedAt: now.toISOString() });
    if (m.drawdown?.breached) {
      // En direct, la casse est celle du moment ; après une synchro, celle de la dernière séance tradée.
      const day = source === 'live' ? today : await this.lastTradedDay(accountId, today);
      rows.push({
        userId, accountId, kind: 'drawdown', period: ONCE_PER_ACCOUNT, tradeDate: asDate(day), source,
        data: { ...snapshot(m.drawdown.maxDrawdown, m.drawdown.margin), floor: m.drawdown.floor },
      });
    }
    // Perte du jour : calculée pour le Premium seulement, et vaut pour la séance en cours.
    if (m.dailyLoss?.breached) {
      rows.push({
        userId, accountId, kind: 'daily_loss', period: today, tradeDate: asDate(today), source,
        data: snapshot(m.dailyLoss.limit, m.dailyLoss.remaining),
      });
    }
    if (!rows.length) return 0;
    const { count } = await this.prisma.accountIncident.createMany({ data: rows, skipDuplicates: true });
    return count;
  }

  /** Best-effort pour les déclencheurs (synchro, import, alertes) : un échec ne bloque jamais l'appelant. */
  async detectQuietly(userId: string, accountId: string, source: Exclude<IncidentSource, 'manual'>): Promise<void> {
    await this.detect(userId, accountId, source).catch((err: unknown) =>
      this.logger.warn(`Incident non évalué (compte ${accountId}) : ${(err as Error).message}`),
    );
  }

  /**
   * Mise à jour d'un compte (`PATCH /accounts/:id`). Seule la feuille « Apex 50K #1 est échoué »
   * (« Garder comme échoué » ou « Archiver ») envoie `confirmIncident` : un compte ACTIF fermé avec
   * ce paramètre CONFIRME la limite franchie détectée, et « Ce n'est pas un échec » pourra alors le
   * remettre en actif. Sans lui (formulaire d'édition), aucun incident n'est jamais confirmé.
   * Passé en ÉCHOUÉ sans limite détectée, l'échec est marqué à la main : un incident `manual` garde
   * la chronologie de la dernière séance, sans jamais permettre de réactivation.
   */
  async updateAccount(user: IncidentUser, accountId: string, dto: UpdateAccountRequestDto, ctx: PlanContext) {
    const { confirmIncident, ...changes } = dto;
    const before = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, userId: user.id },
      select: { status: true },
    });
    const closing = before?.status === AccountStatus.ACTIVE
      && (changes.status === AccountStatus.FAILED || changes.status === AccountStatus.ARCHIVED);
    if (closing) await this.detectQuietly(user.id, accountId, 'sync');
    const updated = await this.accounts.update(user.id, accountId, changes, ctx);
    if (closing && !user.isDemo) {
      await this.closeIncident(user.id, accountId, {
        confirm: confirmIncident === true,
        markedFailed: changes.status === AccountStatus.FAILED,
      }).catch((err: unknown) =>
        this.logger.warn(`Échec non rattaché à un incident (compte ${accountId}) : ${(err as Error).message}`),
      );
    }
    return updated;
  }

  /**
   * Compte fermé : confirme la limite franchie ouverte (seulement si demandé), ou, passé en ÉCHOUÉ
   * sans limite ouverte, garde un incident `manual` (jamais réactivable).
   */
  private async closeIncident(
    userId: string,
    accountId: string,
    opts: { confirm: boolean; markedFailed: boolean },
    now = new Date(),
  ): Promise<void> {
    const open = await this.prisma.accountIncident.findFirst({
      where: { accountId, dismissedAt: null, kind: { in: ['drawdown', 'daily_loss'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (open) {
      if (!opts.confirm) return;
      await this.prisma.accountIncident.updateMany({
        where: { id: open.id, failedByIncidentAt: null },
        data: { failedByIncidentAt: now },
      });
      return;
    }
    if (!opts.markedFailed) return;
    const day = await this.lastTradedDay(accountId, tradingDay(now));
    await this.prisma.accountIncident.createMany({
      data: [{ userId, accountId, kind: 'manual', period: ONCE_PER_ACCOUNT, tradeDate: asDate(day), source: 'manual' }],
      skipDuplicates: true,
    });
  }

  /** Incidents visibles d'un compte (badge « Voir l'autopsie »). */
  async list(userId: string, accountId: string) {
    await this.assertAccount(userId, accountId);
    const rows = await this.prisma.accountIncident.findMany({
      where: { accountId, userId, dismissedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, kind: true, tradeDate: true, source: true, createdAt: true, aiGeneratedAt: true },
    });
    return rows.map((r) => ({ ...r, tradeDate: dayKey(r.tradeDate) }));
  }

  /** Autopsie complète : chronologie, constats, et l'analyse IA si elle existe déjà (aucun appel ici). */
  async get(user: IncidentUser, accountId: string, incidentId: string) {
    const incident = await this.find(user.id, accountId, incidentId);
    const account = await this.prisma.tradingAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { id: true, label: true, currency: true, status: true },
    });
    const report = await this.report(user, incident, account.currency);
    const snap = incident.data as (IncidentSnapshot & { floor?: number }) | null;
    return {
      id: incident.id,
      kind: incident.kind,
      tradeDate: dayKey(incident.tradeDate),
      source: incident.source,
      createdAt: incident.createdAt,
      limit: snap?.limit ?? null,
      account,
      /** « Ce n'est pas un échec » remettra le compte en actif (échec confirmé depuis CET incident). */
      canReactivate: !!incident.failedByIncidentAt && CLOSED_BY_INCIDENT.includes(account.status),
      ...report,
      ai: this.aiState(user, incident),
      estimatedDistance: true as const,
      disclaimer: INCIDENT_DISCLAIMER,
    };
  }

  /**
   * Analyse IA de l'incident (Premium) : la conserve si elle existe, sinon la génère UNE fois.
   * Jamais pour le compte démo (texte du seed), jamais hors prod (`AI_ENABLED`), `max_tokens` 400.
   */
  async analysis(user: IncidentUser, accountId: string, incidentId: string): Promise<IncidentAiState> {
    const incident = await this.find(user.id, accountId, incidentId);
    const state = this.aiState(user, incident);
    if (state.status !== 'pending') return state;
    const unavailable: IncidentAiState = { status: 'unavailable' };
    if (user.isDemo || !this.anthropic.enabled) return unavailable;

    // Verrou par incident : deux ouvertures simultanées ne paient pas deux analyses. Un appel en
    // échec (ou sans texte) ne le libère pas : il expire au bout de `AI_RETRY_DELAY_S`, puis un
    // nouvel essai est possible, dans la limite de `AI_MAX_TRIES_PER_DAY` par jour.
    const lockKey = `incident-ai:${incident.id}`;
    const lock = await this.redis.client.set(lockKey, '1', 'EX', AI_LOCK_TTL_S, 'NX');
    if (lock !== 'OK') return unavailable;
    const retryLater = () => this.redis.client.expire(lockKey, AI_RETRY_DELAY_S).catch(() => undefined);
    try {
      const triesKey = `incident-ai-tries:${incident.id}:${tradingDay(new Date())}`;
      const tries = await this.redis.client.incr(triesKey);
      if (tries === 1) await this.redis.client.expire(triesKey, 86_400);
      if (tries > AI_MAX_TRIES_PER_DAY) {
        await retryLater();
        return unavailable;
      }
      const account = await this.prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId }, select: { currency: true } });
      const report = await this.report(user, incident, account.currency);
      const response = await this.anthropic.create(
        {
          model: AI_MODELS.analysis,
          max_tokens: INCIDENT_AI_MAX_TOKENS,
          system: INCIDENT_AI_SYSTEM,
          messages: [{ role: 'user', content: buildIncidentPrompt(incident.kind as IncidentKind, account.currency, report) }],
        },
        { feature: 'incident', userId: user.id },
      );
      const text = responseText(response).trim();
      if (!text) {
        await retryLater();
        return unavailable;
      }
      const generatedAt = new Date();
      // `aiAnalysis: null` dans le filtre : une analyse déjà écrite n'est jamais remplacée.
      const { count } = await this.prisma.accountIncident.updateMany({
        where: { id: incident.id, aiAnalysis: null },
        data: { aiAnalysis: text, aiGeneratedAt: generatedAt },
      });
      if (!count) return this.aiState(user, await this.find(user.id, accountId, incidentId));
      return { status: 'ready', text, generatedAt };
    } catch (err) {
      this.logger.warn(`Analyse d'incident non générée (${incident.id}) : ${(err as Error).message}`);
      await retryLater();
      return unavailable;
    }
  }

  /**
   * « Ce n'est pas un échec » : retire l'incident (jamais recréé) et remet le compte en actif
   * SEULEMENT s'il a été fermé (échoué ou archivé) depuis la feuille de choix en confirmant cet
   * incident, et qu'il l'est encore. Un échec marqué à la main reste tel quel. Réactivation soumise
   * au quota de comptes, comme toute réactivation.
   */
  async dismiss(user: IncidentUser, accountId: string, incidentId: string, ctx: PlanContext) {
    const incident = await this.find(user.id, accountId, incidentId);
    const account = await this.prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId }, select: { status: true } });
    const reactivate = !!incident.failedByIncidentAt && CLOSED_BY_INCIDENT.includes(account.status);
    if (reactivate) await this.accounts.update(user.id, accountId, { status: AccountStatus.ACTIVE }, ctx);
    await this.prisma.accountIncident.update({ where: { id: incident.id }, data: { dismissedAt: new Date() } });
    return { dismissed: true as const, reactivated: reactivate };
  }

  private aiState(user: IncidentUser, incident: AccountIncident): IncidentAiState {
    if (!isPremiumAccess(user)) return { status: 'locked' };
    if (incident.aiAnalysis && incident.aiGeneratedAt) {
      return { status: 'ready', text: incident.aiAnalysis, generatedAt: incident.aiGeneratedAt };
    }
    return { status: 'pending' };
  }

  private async find(userId: string, accountId: string, incidentId: string): Promise<AccountIncident> {
    const incident = await this.prisma.accountIncident.findFirst({
      where: { id: incidentId, accountId, userId, dismissedAt: null },
    });
    if (!incident) throw new NotFoundException('Autopsie introuvable.');
    return incident;
  }

  private async assertAccount(userId: string, accountId: string): Promise<void> {
    const found = await this.prisma.tradingAccount.count({ where: { id: accountId, userId } });
    if (!found) throw new NotFoundException('Compte introuvable.');
  }

  /** Dernière séance tradée sur le compte (journée CME), à défaut celle donnée. */
  private async lastTradedDay(accountId: string, fallback: string): Promise<string> {
    const last = await this.prisma.trade.findFirst({
      where: { accountId },
      orderBy: { tradedAt: 'desc' },
      select: { tradedAt: true },
    });
    return last ? tradingDay(last.tradedAt) : fallback;
  }

  /** Faits de la séance de l'incident, et des séances précédentes du compte. */
  /**
   * Plancher qui suit le plus haut en cours de séance : trailing intraday d'un plan du catalogue,
   * ou trailing saisi à la main (calculé sur le plus haut des trades). Lu sur les métriques du
   * compte, comme la détection (aucune règle dupliquée).
   */
  private async trailsInSession(user: IncidentUser, accountId: string): Promise<boolean> {
    const account = (await this.accounts.list(user.id, { premium: isPremiumAccess(user) })).find((a) => a.id === accountId);
    const dd = account?.metrics.drawdown;
    if (!dd) return false;
    return dd.rule ? dd.rule.kind === 'trailing_intraday' : dd.type === 'TRAILING';
  }

  private async report(user: IncidentUser, incident: AccountIncident, currency: string): Promise<IncidentReport> {
    const day = dayKey(incident.tradeDate);
    // Une journée CME court de la veille 17 h à 17 h (Chicago) : fenêtre large, puis filtre exact.
    const from = new Date(asDate(day).getTime() - 36 * 3600_000);
    const to = new Date(asDate(day).getTime() + 30 * 3600_000);
    const tradeSelect = { id: true, tradedAt: true, asset: true, side: true, quantity: true, pnl: true, commission: true } as const;
    const [window, earlier, behavior, prop] = await Promise.all([
      this.prisma.trade.findMany({ where: { accountId: incident.accountId, tradedAt: { gte: from, lt: to } }, select: tradeSelect }),
      this.prisma.trade.findMany({
        where: { accountId: incident.accountId, tradedAt: { lt: to } },
        orderBy: { tradedAt: 'desc' },
        take: 3000,
        select: { tradedAt: true, quantity: true, pnl: true, commission: true },
      }),
      this.prisma.behaviorAlert.findMany({
        where: { accountId: incident.accountId, tradeDay: incident.tradeDate },
        select: { createdAt: true, type: true },
      }),
      this.prisma.propRiskEvent.findMany({
        where: { accountId: incident.accountId, tradeDate: incident.tradeDate },
        select: { createdAt: true, kind: true, level: true },
      }),
    ]);
    const trades = window.filter((t) => tradingDay(t.tradedAt) === day);

    const byDay = new Map<string, PreviousSession>();
    for (const t of earlier) {
      const d = tradingDay(t.tradedAt);
      if (d >= day) continue;
      const s = byDay.get(d) ?? { day: d, trades: 0, maxQuantity: null, net: 0 };
      s.trades++;
      s.net += (t.pnl ?? 0) - Math.abs(t.commission ?? 0);
      if (t.quantity != null && (s.maxQuantity == null || t.quantity > s.maxQuantity)) s.maxQuantity = t.quantity;
      byDay.set(d, s);
    }
    const previous = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, PREVIOUS_SESSIONS);

    // Plus haut solde réalisé avant la séance, au-dessus du solde de départ de la séance : en
    // remontant les trades d'avant, le solde après chacun vaut « départ − ce qui a suivi ».
    let after = 0;
    let peakAboveStart = 0;
    for (const t of earlier) {
      if (tradingDay(t.tradedAt) >= day) continue;
      after += (t.pnl ?? 0) - Math.abs(t.commission ?? 0);
      peakAboveStart = Math.max(peakAboveStart, -after);
    }
    const trailing = incident.kind === 'drawdown' && (await this.trailsInSession(user, incident.accountId));

    return buildIncidentReport({
      kind: incident.kind as IncidentKind,
      currency,
      snapshot: (incident.data as IncidentSnapshot | null) ?? null,
      trades,
      alerts: [
        ...behavior.map((a) => ({ at: a.createdAt, source: 'behavior' as const, type: a.type })),
        ...prop.map((e) => ({ at: e.createdAt, source: 'prop' as const, type: e.kind, level: e.level })),
      ],
      previous,
      trailing,
      peakAboveStart,
    });
  }
}
