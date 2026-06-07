import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { forkJoin, interval } from 'rxjs';
import { SessionApi, TradingSession, LiveStats, SessionTrade, MoodState } from '../api/session.api';
import { TradesApi, CreateTradeDto, MarketContext, NewsItem } from '../api/trades.api';
import { DailyRecapApi, DailyRecap } from '../api/daily-recap.api';
import { DebriefApi, DebriefObjective } from '../api/debrief.api';
import { EcoCalendarApi, EcoCalendarData, EcoEvent } from '../api/eco-calendar.api';
import { UserStore } from './user.store';
import { todayParis, toParisDateStr } from '../utils/paris-date';
import { POLLING_MS } from '../constants/polling.const';

@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly sessionApi      = inject(SessionApi);
  private readonly tradesApi       = inject(TradesApi);
  private readonly dailyRecapApi   = inject(DailyRecapApi);
  private readonly debriefApi      = inject(DebriefApi);
  private readonly ecoCalendarApi  = inject(EcoCalendarApi);
  private readonly userStore       = inject(UserStore);
  private readonly destroyRef      = inject(DestroyRef);

  // ── State ─────────────────────────────────────────────────────────────────
  readonly activeSession     = signal<TradingSession | null>(null);
  readonly todayStats        = signal<LiveStats | null>(null);
  readonly todayTrades       = signal<SessionTrade[]>([]);
  readonly selectedMood      = signal<MoodState>('CONFIDENT');
  readonly yesterdayRecap    = signal<DailyRecap | null>(null);
  readonly currentObjectives = signal<DebriefObjective[]>([]);
  readonly currentDebriefId  = signal<string | null>(null);
  // Démo : dernière session CLOSED (+ ses stats) pour un débrief d'exemple jamais vide.
  readonly lastClosedSession = signal<TradingSession | null>(null);
  readonly lastClosedStats   = signal<LiveStats | null>(null);
  readonly marketCtx         = signal<MarketContext | null>(null);
  readonly newsItems         = signal<NewsItem[]>([]);
  readonly breakingNews      = signal<string | null>(null);
  readonly triggerCloseModal = signal(false);
  /** Retour d'action live (log / clôture trade) — succès ou erreur, pour feedback UI. */
  readonly liveFeedback      = signal<{ type: 'success' | 'error'; text: string; ts: number } | null>(null);

  private readonly weekEcoEvents       = signal<Map<string, EcoEvent[]>>(new Map());
  private readonly weekEcoPinnedEvents = signal<string[]>([]);

  // ── Computed ──────────────────────────────────────────────────────────────
  readonly ecoCalendarDay = computed<EcoCalendarData | null>(() => {
    const week = this.weekEcoEvents();
    if (week.size === 0) return null;
    const events = week.get(this.getTargetEcoDate()) ?? [];
    return {
      events,
      analysis: { summary: '', recommendation: '', assetImpacts: [] },
      userAssets: [],
      pinnedEvents: this.weekEcoPinnedEvents(),
    };
  });

  readonly hasActiveSession = computed(() => this.activeSession()?.status === 'ACTIVE');

  // ── Session timer ─────────────────────────────────────────────────────────
  private readonly sessionNow = signal(new Date());

  readonly sessionTimer = computed(() => {
    const session = this.activeSession();
    if (!session?.startedAt || session.status !== 'ACTIVE') return '00:00:00';
    const diff = Math.floor(
      (this.sessionNow().getTime() - new Date(session.startedAt).getTime()) / 1000,
    );
    const h = Math.floor(diff / 3600).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
    const s = (diff % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  });

  private marketCtxInterval?: ReturnType<typeof setInterval>;
  private newsInterval?: ReturnType<typeof setInterval>;

  constructor() {
    // Horloge 1 s pour le timer de session
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.sessionNow.set(new Date()));

    // Polling stats live toutes les 30 s
    interval(30_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.activeSession()?.status === 'ACTIVE') this.refreshLiveStats();
      });

    // Polling market context + news : actif seulement pendant session active
    toObservable(this.activeSession)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((session) => {
        clearInterval(this.marketCtxInterval);
        clearInterval(this.newsInterval);
        this.marketCtxInterval = undefined;
        this.newsInterval      = undefined;
        if (session?.status === 'ACTIVE') {
          this.fetchMarketContext();
          this.fetchNewsItems();
          this.marketCtxInterval = setInterval(() => this.fetchMarketContext(), POLLING_MS.MARKET_CONTEXT);
          this.newsInterval      = setInterval(() => this.fetchNewsItems(), POLLING_MS.NEWS);
        }
      });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  loadSessionData(): void {
    this.sessionApi
      .getActiveSession()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.activeSession.set(res.data ?? null);
          if (res.data?.status === 'ACTIVE') this.refreshLiveStats();
        },
      });

    this.dailyRecapApi
      .getYesterdayRecap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.yesterdayRecap.set(res.data ?? null) });

    this.loadWeekEcoCalendar();

    // Démo : charger la dernière session fermée → débrief d'exemple (jamais vide).
    if (this.userStore.isDemo()) this.loadLastClosedSession();

    // Le débrief (objectifs) est une feature Starter+ : ne pas appeler l'endpoint
    // (StarterGuard) pour un FREE, sinon 403. La session de base reste accessible.
    if (this.userStore.isStarterOrAbove()) {
      this.debriefApi
        .getCurrent()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.currentObjectives.set(res.data?.objectives ?? []);
            this.currentDebriefId.set(res.data?.id ?? null);
          },
        });
    }
  }

  /** Démo : récupère la dernière session CLOSED (avec stats) pour l'onglet Débrief. */
  private loadLastClosedSession(): void {
    this.sessionApi
      .getSessionHistory(10)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // L'historique ne contient que des sessions fermées → prendre la plus
          // récente avec des trades (sinon la plus récente).
          const items = res.data ?? [];
          const closed = items.find((s) => (s.totalTrades ?? 0) > 0) ?? items[0];
          if (!closed) return;
          this.sessionApi
            .getSessionDetail(closed.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (d) => {
                const detail = d.data;
                this.lastClosedSession.set(detail);
                this.lastClosedStats.set({
                  totalPnl: detail.totalPnl ?? 0,
                  winRate: detail.winRate ?? 0,
                  tradesCount: detail.totalTrades ?? 0,
                  closedCount: detail.totalTrades ?? 0,
                  trades: detail.trades ?? [],
                });
              },
            });
        },
      });
  }

  selectMood(mood: MoodState): void {
    this.selectedMood.set(mood);
  }

  startSession(): void {
    this.sessionApi
      .startSession(this.selectedMood())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.activeSession.set(res.data);
          this.refreshLiveStats();
        },
      });
  }

  openCloseSessionModal(): void {
    this.triggerCloseModal.set(true);
  }

  onSessionClosed(payload: { mood: MoodState; notes?: string; note?: string; question?: string | null }): void {
    this.triggerCloseModal.set(false);
    const session = this.activeSession();
    if (!session) return;
    this.sessionApi
      .closeSession(session.id, payload.mood, payload.notes, payload.note, payload.question ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.activeSession.set(res.data) });
  }

  closeSessionThenDebrief(): void {
    const session = this.activeSession();
    if (!session) return;
    this.triggerCloseModal.set(false);
    this.sessionApi
      .closeSession(session.id, 'NEUTRAL' as MoodState)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.activeSession.set(res.data) });
  }

  confirmCloseTrade(event: { tradeId: string; exitPrice: number }): void {
    this.sessionApi
      .closeTrade(event.tradeId, event.exitPrice)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.refreshLiveStats();
          this.flashFeedback('success', 'Trade clôturé');
        },
        error: (err) =>
          this.flashFeedback('error', err?.error?.message ?? 'Échec de la clôture du trade'),
      });
  }

  logQuickTrade(dto: CreateTradeDto): void {
    this.tradesApi
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.refreshLiveStats();
          this.flashFeedback('success', 'Trade loggué');
        },
        error: (err) =>
          this.flashFeedback('error', err?.error?.message ?? 'Échec de l’enregistrement du trade'),
      });
  }

  private flashFeedback(type: 'success' | 'error', text: string): void {
    this.liveFeedback.set({ type, text, ts: Date.now() });
  }

  savePlanNote(note: string): void {
    const session = this.activeSession();
    if (!note.trim() || !session) return;
    this.sessionApi
      .updateSession(session.id, { planNote: note })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  updateObjectiveNote(e: { index: number; note: string }): void {
    const updated = [...this.currentObjectives()];
    if (updated[e.index]) {
      updated[e.index] = { ...updated[e.index], note: e.note };
      this.currentObjectives.set(updated);
    }
  }

  moodEmoji(mood?: string | null): string {
    const map: Record<string, string> = {
      CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', TIRED: '😰', STRESSED: '😰',
    };
    return map[mood ?? ''] ?? '😐';
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private refreshLiveStats(): void {
    this.sessionApi
      .getLiveStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.todayStats.set(res.data);
          this.todayTrades.set(res.data.trades);
        },
      });
  }

  private fetchMarketContext(): void {
    this.tradesApi
      .getMarketContext()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.marketCtx.set(res.data) });
  }

  private fetchNewsItems(): void {
    const symbols = [...new Set(this.todayTrades().map(t => t.asset))].slice(0, 5);
    this.tradesApi
      .getNews(symbols)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.newsItems.set(res.data ?? []);
          const breaking = (res.data ?? []).find(i =>
            i.title.toLowerCase().includes('fed')   ||
            i.title.toLowerCase().includes('powell') ||
            i.title.toLowerCase().includes('ecb')   ||
            i.title.toLowerCase().includes('fomc'),
          );
          this.breakingNews.set(breaking?.title ?? null);
        },
      });
  }

  private loadWeekEcoCalendar(): void {
    const parisNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const dayOfWeek = parisNow.getDay();
    const isWeekend  = dayOfWeek === 0 || dayOfWeek === 6;

    const monday = new Date(parisNow);
    if (isWeekend) {
      monday.setDate(parisNow.getDate() + (dayOfWeek === 0 ? 1 : 2));
    } else {
      monday.setDate(parisNow.getDate() - (dayOfWeek - 1));
    }
    monday.setHours(0, 0, 0, 0);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    forkJoin({
      range: this.ecoCalendarApi.getEventsRange(toParisDateStr(monday), toParisDateStr(friday)),
      pins:  this.ecoCalendarApi.getPins(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ range, pins }) => {
          const weekMap = new Map<string, EcoEvent[]>();
          for (const day of (range.data ?? [])) weekMap.set(day.date, day.events);
          this.weekEcoEvents.set(weekMap);
          this.weekEcoPinnedEvents.set(pins.data ?? []);
        },
        error: () => this.weekEcoEvents.set(new Map()),
      });
  }

  private getTargetEcoDate(): string {
    const parisNow  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const parisHour = parisNow.getHours();
    const dayOfWeek = parisNow.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    // Pendant session active → toujours aujourd'hui
    if (this.activeSession()?.status === 'ACTIVE') return todayParis();
    if (!isWeekend && parisHour < 18) return todayParis();
    return this.getNextTradingDate(parisNow);
  }

  private getNextTradingDate(from: Date): string {
    const d = new Date(from);
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return toParisDateStr(d);
  }
}
