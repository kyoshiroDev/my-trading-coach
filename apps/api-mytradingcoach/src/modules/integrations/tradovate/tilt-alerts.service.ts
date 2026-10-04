import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { MoodState, SessionStatus } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { tradingDay } from '../../accounts/account-rules';
import { isPremiumAccess } from '../../discord/discord-access.util';
import { detectTilt, type TiltFinding, type TiltTrade } from './tilt-detection';
import { PropRiskJournalService } from './prop-risk-journal.service';

/** Événement `tilt:alert` poussé à l'app (canal `/tradovate-live`). */
export interface TiltAlertEvent extends TiltFinding {
  accountId: string;
  accountLabel: string;
  /** Humeur notée en pré-session (session ouverte), pour rapprocher le signal de l'état du jour. */
  moodStart: MoodState | null;
}

export type TiltAlertEmit = (event: 'tilt:alert', payload: TiltAlertEvent) => void;

/** Trades récents pris pour les médianes (taille, journées) : assez pour être stables. */
const HISTORY_TRADES = 400;
/** Journées passées prises pour la médiane des journées. */
const HISTORY_DAYS = 30;
/** Une rafale de trades synchronisés : une évaluation, juste après. */
export const TILT_DEBOUNCE_MS = 1_500;
const KEY_TTL_S = 2 * 24 * 3600;

/**
 * Anti-tilt en direct (PREMIUM, #371) : à chaque trade synchronisé depuis Tradovate (app
 * ouverte), cherche une ré-entrée rapide après une perte, une taille qui grossit après une perte,
 * ou une journée anormalement chargée (`tilt-detection.ts`). Un nudge par signal et par trade
 * (par journée pour le surtrading), jamais bloquant. Best-effort : un échec est journalisé.
 */
@Injectable()
export class TiltAlertsService implements OnModuleDestroy {
  private readonly logger = new Logger(TiltAlertsService.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    /** Journal de séance (#373) : optionnel pour garder les tests unitaires légers. */
    @Optional() private readonly journal?: PropRiskJournalService,
  ) {}

  schedule(userId: string, accountId: string, emit: TiltAlertEmit): void {
    const prev = this.timers.get(accountId);
    if (prev) clearTimeout(prev);
    this.timers.set(
      accountId,
      setTimeout(() => {
        this.timers.delete(accountId);
        void this.check(userId, accountId, emit).catch((err: unknown) =>
          this.logger.warn(`Anti-tilt non évalué (compte ${accountId}) : ${(err as Error).message}`),
        );
      }, TILT_DEBOUNCE_MS),
    );
  }

  async check(userId: string, accountId: string, emit: TiltAlertEmit, now = new Date()): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, role: true, trialEndsAt: true, isDemo: true },
    });
    if (!user || user.isDemo || !isPremiumAccess(user)) return;
    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, userId },
      select: { label: true },
    });
    if (!account) return;

    const rows = await this.prisma.trade.findMany({
      where: { userId, accountId, pnl: { not: null } },
      orderBy: { tradedAt: 'desc' },
      take: HISTORY_TRADES,
      select: { id: true, pnl: true, quantity: true, tradedAt: true },
    });
    const day = tradingDay(now);
    const trades: TiltTrade[] = rows.map((r) => ({ ...r, pnl: r.pnl! })).reverse();
    const today = trades.filter((t) => tradingDay(t.tradedAt) === day);
    const past = trades.filter((t) => tradingDay(t.tradedAt) < day);
    const counts = new Map<string, number>();
    for (const t of past) counts.set(tradingDay(t.tradedAt), (counts.get(tradingDay(t.tradedAt)) ?? 0) + 1);
    const findings = detectTilt(
      today,
      {
        quantities: past.map((t) => t.quantity).filter((q): q is number => q != null && q > 0),
        dailyCounts: [...counts.values()].slice(-HISTORY_DAYS),
      },
      day,
    );
    if (findings.length === 0) return;

    const session = await this.prisma.tradeSession.findFirst({
      where: { userId, status: SessionStatus.ACTIVE },
      orderBy: { startedAt: 'desc' },
      select: { moodStart: true },
    });
    for (const f of findings) {
      // Une fois par trade (ou par journée) : SET NX, le premier worker qui écrit envoie.
      const sent = await this.redis.client.set(`tilt-alert:${accountId}:${f.signal}:${f.ref}`, '1', 'EX', KEY_TTL_S, 'NX');
      if (sent !== 'OK') continue;
      emit('tilt:alert', { ...f, accountId, accountLabel: account.label, moodStart: session?.moodStart ?? null });
      const { signal, ref: _ref, ...details } = f;
      await this.journal
        ?.recordEvent(userId, accountId, day, 'tilt', signal, details)
        .catch((err: unknown) => this.logger.warn(`Tilt non journalisé (compte ${accountId}) : ${(err as Error).message}`));
    }
  }

  onModuleDestroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
