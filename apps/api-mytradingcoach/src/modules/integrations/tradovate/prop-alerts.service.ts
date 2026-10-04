import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { AccountsService } from '../../accounts/accounts.service';
import { tradingDay } from '../../accounts/account-rules';
import { isPremiumAccess } from '../../discord/discord-access.util';

export type PropAlertKind = 'drawdown' | 'daily_loss';
export type PropAlertLevel = 'warning' | 'critical' | 'breached';

/** Événement `prop:alert` poussé à l'app (canal `/tradovate-live`). */
export interface PropAlertEvent {
  accountId: string;
  accountLabel: string;
  currency: string;
  kind: PropAlertKind;
  level: PropAlertLevel;
  /** Marge restante (drawdown) ou perte encore permise (perte journalière), ≤ 0 si dépassé. */
  remaining: number;
  /** Drawdown max ou limite journalière. */
  limit: number;
  /** Perte journalière : ce que fait la firm quand elle est atteinte. */
  breach: 'account_failed' | 'trading_paused_for_day' | null;
}

export type PropAlertEmit = (event: 'prop:alert', payload: PropAlertEvent) => void;

/** Seuils d'alerte en part de marge restante : 25 % puis 10 %, puis dépassement. */
export const ALERT_WARNING_PCT = 0.25;
export const ALERT_CRITICAL_PCT = 0.1;
/** Hystérésis : l'alerte du jour n'est réarmée qu'une fois la marge remontée au-dessus. */
export const ALERT_REARM_PCT = 0.35;
/** Un trade = plusieurs mises à jour de solde : une seule évaluation, juste après la rafale. */
export const ALERT_DEBOUNCE_MS = 1_500;
const KEY_TTL_S = 2 * 24 * 3600;

const RANK: Record<PropAlertLevel, number> = { warning: 1, critical: 2, breached: 3 };

export function alertLevel(pct: number, breached: boolean): PropAlertLevel | null {
  if (breached) return 'breached';
  if (pct <= ALERT_CRITICAL_PCT) return 'critical';
  if (pct <= ALERT_WARNING_PCT) return 'warning';
  return null;
}

const alertKey = (accountId: string, kind: PropAlertKind, day: string) => `prop-alert:${accountId}:${kind}:${day}`;

/**
 * Alertes « avant la casse » (PREMIUM, #370) : marge drawdown et perte journalière.
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

    const account = (await this.accounts.list(userId, { dailyLoss: true })).find((a) => a.id === accountId);
    if (!account || account.status !== AccountStatus.ACTIVE) return;
    const m = account.metrics;
    const day = tradingDay(now);

    const candidates: [PropAlertKind, { pct: number; breached: boolean; remaining: number; limit: number } | null, PropAlertEvent['breach']][] = [
      ['drawdown', m.drawdown && { pct: m.drawdown.pct, breached: m.drawdown.breached, remaining: m.drawdown.margin, limit: m.drawdown.maxDrawdown }, null],
      ['daily_loss', m.dailyLoss && { pct: m.dailyLoss.pct, breached: m.dailyLoss.breached, remaining: m.dailyLoss.remaining, limit: m.dailyLoss.limit }, m.dailyLoss?.breach ?? null],
    ];

    for (const [kind, v, breach] of candidates) {
      if (!v) continue;
      const key = alertKey(accountId, kind, day);
      const level = alertLevel(v.pct, v.breached);
      const sent = (await this.redis.client.get(key)) as PropAlertLevel | null;
      if (!level) {
        if (sent && v.pct > ALERT_REARM_PCT) await this.redis.client.del(key);
        continue;
      }
      if (sent && RANK[sent] >= RANK[level]) continue;
      await this.redis.client.set(key, level, 'EX', KEY_TTL_S);
      emit('prop:alert', {
        accountId, accountLabel: account.label, currency: account.currency,
        kind, level, remaining: v.remaining, limit: v.limit, breach,
      });
    }
  }

  onModuleDestroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
