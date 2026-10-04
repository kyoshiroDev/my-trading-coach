import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { AccountsService } from '../../accounts/accounts.service';
import { tradingDay } from '../../accounts/account-rules';
import { isPremiumAccess } from '../../discord/discord-access.util';

export type PropAlertKind = 'drawdown' | 'daily_loss' | 'consistency' | 'objective' | 'payout';
/** `reached` : bonne nouvelle (objectif atteint, payout possible), une fois par cycle. */
export type PropAlertLevel = 'warning' | 'critical' | 'breached' | 'reached';

/** Événement `prop:alert` poussé à l'app (canal `/tradovate-live`). */
export interface PropAlertEvent {
  accountId: string;
  accountLabel: string;
  currency: string;
  kind: PropAlertKind;
  level: PropAlertLevel;
  /**
   * Marge restante (drawdown), perte encore permise (perte journalière) ou gain encore possible
   * aujourd'hui sans casser la consistency ; ≤ 0 si dépassé. 0 pour `objective` / `payout`.
   */
  remaining: number;
  /** Drawdown max, limite journalière, ou gain max du jour (consistency). */
  limit: number;
  /** Perte journalière : ce que fait la firm quand elle est atteinte. */
  breach: 'account_failed' | 'trading_paused_for_day' | null;
  /** Consistency : part max d'une journée dans le profit (0 à 1). */
  maxShare?: number;
  /** Consistency dépassée : profit supplémentaire nécessaire pour la respecter de nouveau. */
  extraProfit?: number;
}

export type PropAlertEmit = (event: 'prop:alert', payload: PropAlertEvent) => void;

/** Seuils d'alerte en part de marge restante : 25 % puis 10 %, puis dépassement. */
export const ALERT_WARNING_PCT = 0.25;
export const ALERT_CRITICAL_PCT = 0.1;
/** Hystérésis : l'alerte du jour n'est réarmée qu'une fois la marge remontée au-dessus. */
export const ALERT_REARM_PCT = 0.35;
/** Consistency : avertir à 80 % du gain max du jour, réarmer sous 60 %. */
export const CONSISTENCY_WARNING_RATIO = 0.8;
export const CONSISTENCY_REARM_RATIO = 0.6;
/** Un trade = plusieurs mises à jour de solde : une seule évaluation, juste après la rafale. */
export const ALERT_DEBOUNCE_MS = 1_500;
const KEY_TTL_S = 2 * 24 * 3600;
/** Objectif / payout : une alerte par cycle, gardée le temps d'un cycle long. */
const CYCLE_KEY_TTL_S = 120 * 24 * 3600;

const RANK: Record<PropAlertLevel, number> = { warning: 1, critical: 2, breached: 3, reached: 4 };

export function alertLevel(pct: number, breached: boolean): PropAlertLevel | null {
  if (breached) return 'breached';
  if (pct <= ALERT_CRITICAL_PCT) return 'critical';
  if (pct <= ALERT_WARNING_PCT) return 'warning';
  return null;
}

const alertKey = (accountId: string, kind: PropAlertKind, period: string) => `prop-alert:${accountId}:${kind}:${period}`;

/** Une alerte candidate : niveau atteint (null = aucun), et réarmement de celle du jour. */
interface Candidate {
  kind: PropAlertKind;
  level: PropAlertLevel | null;
  rearm: boolean;
  /** Journée de trading, ou cycle de payout pour `objective` / `payout`. */
  period: string;
  ttl: number;
  payload: Pick<PropAlertEvent, 'remaining' | 'limit' | 'breach' | 'maxShare' | 'extraProfit'>;
}

/**
 * Consistency, d'après le gain max du jour : avertir à l'approche, puis quand la journée dépasse
 * (elle devient un meilleur jour trop lourd). Rien sans gain max calculable.
 */
export function consistencyCandidate(
  req: { required: number; dayCap?: number | null; todayPnl?: number } | undefined,
  day: string,
): Candidate | null {
  if (!req || req.dayCap == null || req.todayPnl == null) return null;
  const cap = req.dayCap;
  const t = req.todayPnl;
  const level: PropAlertLevel | null = t > cap ? 'breached' : t >= CONSISTENCY_WARNING_RATIO * cap ? 'warning' : null;
  // Profit des autres journées (P0) : cap = c · P0 / (1 − c). Dépassé → profit à ajouter pour que la
  // journée retombe sous c : T / c − (P0 + T).
  const others = (cap * (1 - req.required)) / req.required;
  return {
    kind: 'consistency', level, rearm: t < CONSISTENCY_REARM_RATIO * cap, period: day, ttl: KEY_TTL_S,
    payload: {
      remaining: cap - t, limit: cap, breach: null, maxShare: req.required,
      ...(level === 'breached' ? { extraProfit: t / req.required - (others + t) } : {}),
    },
  };
}

/**
 * Alertes « avant la casse » (PREMIUM, #370) : marge drawdown, perte journalière, consistency
 * (gain max du jour), et bonnes nouvelles : objectif atteint, payout possible.
 *
 * Évaluées à chaque solde poussé par Tradovate (`tradovate:balance`, app ouverte) sur les
 * métriques de `AccountsService.list` : aucun calcul de règle dupliqué ici. Une alerte par
 * niveau franchi et par journée de trading (clé Redis), dans l'ordre 25 % → 10 % → dépassé ;
 * réarmée si la marge remonte au-dessus de 35 %. Best-effort : un échec ne touche ni la
 * synchro ni le solde, il est seulement journalisé.
 */
@Injectable()
export class PropAlertsService implements OnModuleDestroy {
  private readonly logger = new Logger(PropAlertsService.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly accounts: AccountsService,
  ) {}

  /** Regroupe la rafale de soldes d'un trade : une évaluation par compte, après le dernier. */
  schedule(userId: string, accountId: string, emit: PropAlertEmit): void {
    const prev = this.timers.get(accountId);
    if (prev) clearTimeout(prev);
    this.timers.set(
      accountId,
      setTimeout(() => {
        this.timers.delete(accountId);
        void this.check(userId, accountId, emit).catch((err: unknown) =>
          this.logger.warn(`Alertes prop firm non évaluées (compte ${accountId}) : ${(err as Error).message}`),
        );
      }, ALERT_DEBOUNCE_MS),
    );
  }

  async check(userId: string, accountId: string, emit: PropAlertEmit, now = new Date()): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, role: true, trialEndsAt: true, isDemo: true },
    });
    if (!user || user.isDemo || !isPremiumAccess(user)) return;

    const account = (await this.accounts.list(userId, { premium: true })).find((a) => a.id === accountId);
    if (!account || account.status !== AccountStatus.ACTIVE) return;
    const m = account.metrics;
    const day = tradingDay(now);

    const candidates: Candidate[] = [];
    if (m.drawdown) {
      candidates.push({
        kind: 'drawdown', level: alertLevel(m.drawdown.pct, m.drawdown.breached), rearm: m.drawdown.pct > ALERT_REARM_PCT,
        period: day, ttl: KEY_TTL_S, payload: { remaining: m.drawdown.margin, limit: m.drawdown.maxDrawdown, breach: null },
      });
    }
    if (m.dailyLoss) {
      candidates.push({
        kind: 'daily_loss', level: alertLevel(m.dailyLoss.pct, m.dailyLoss.breached), rearm: m.dailyLoss.pct > ALERT_REARM_PCT,
        period: day, ttl: KEY_TTL_S, payload: { remaining: m.dailyLoss.remaining, limit: m.dailyLoss.limit, breach: m.dailyLoss.breach },
      });
    }
    const progress = m.progress;
    if (progress) {
      const cons = consistencyCandidate(progress.requirements.find((r) => r.key === 'consistency'), day);
      if (cons) candidates.push(cons);
      // Bonne nouvelle : une fois par cycle (évaluation entière, ou cycle depuis le dernier payout).
      candidates.push({
        kind: progress.kind, level: progress.done ? 'reached' : null, rearm: false,
        period: `cycle-${progress.cycleAfter ?? 'start'}`, ttl: CYCLE_KEY_TTL_S,
        payload: { remaining: 0, limit: 0, breach: null },
      });
    }

    for (const c of candidates) {
      const key = alertKey(accountId, c.kind, c.period);
      const sent = (await this.redis.client.get(key)) as PropAlertLevel | null;
      if (!c.level) {
        if (sent && c.rearm) await this.redis.client.del(key);
        continue;
      }
      if (sent && RANK[sent] >= RANK[c.level]) continue;
      await this.redis.client.set(key, c.level, 'EX', c.ttl);
      emit('prop:alert', {
        accountId, accountLabel: account.label, currency: account.currency, kind: c.kind, level: c.level, ...c.payload,
      });
    }
  }

  onModuleDestroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
