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
import { EcoCalendarApi, EcoCalendarData } from '../api/eco-calendar.api';
import { UserStore } from './user.store';
import { POLLING_MS } from '../constants/polling.const';
import { ToastService } from '../services/toast.service';
import { apiErrorMessage } from '../utils/api-error';
import { toParisDateStr, todayParis } from '@mtc/shared';
import type { EcoEvent } from '@mtc/shared';

@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly sessionApi      = inject(SessionApi);
  private readonly tradesApi       = inject(TradesApi);
  private readonly dailyRecapApi   = inject(DailyRecapApi);
  private readonly debriefApi      = inject(DebriefApi);
  private readonly ecoCalendarApi  = inject(EcoCalendarApi);
  private readonly userStore       = inject(UserStore);
  private readonly destroyRef      = inject(DestroyRef);
  private readonly toast           = inject(ToastService);

  // ── State ─────────────────────────────────────────────────────────────────
  readonly activeSession     = signal<TradingSession | null>(null);
  readonly todayStats        = signal<LiveStats | null>(null);
  readonly todayTrades       = signal<SessionTrade[]>([]);
  readonly selectedMood      = signal<MoodState>('CONFIDENT');
  readonly yesterdayRecap    = signal<DailyRecap | null>(null);
  readonly currentObjectives = signal<DebriefObjective[]>([]);
  readonly currentDebriefId  = signal<string | null>(null);
  readonly marketCtx         = signal<MarketContext | null>(null);
  readonly newsItems         = signal<NewsItem[]>([]);
  readonly breakingNews      = signal<string | null>(null);
  readonly triggerCloseModal = signal(false);
  /** Retour d'action live (log / clôture trade) : succès ou erreur, pour feedback UI. */

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

    // Polling calendrier éco (IA mutualisée = FREE, session active) : recharge la donnée
    // fraîche (actuals + analyse IA) toutes les 60 s. Filet de sécurité indépendant du
    // broadcast WebSocket transitoire : la fenêtre ouverte rattrape même si un broadcast
    // est manqué (reconnexion socket après déploiement, cycle de détection raté, etc.).
    interval(POLLING_MS.ECO_CALENDAR)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.activeSession()?.status === 'ACTIVE') {
          this.loadWeekEcoCalendar();
        }
      });

    // Polling market context + news : session active (contexte marché + news = IA
    // mutualisée → FREE depuis PROMPT-169, accessible à tous les utilisateurs connectés).
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

    // Le débrief (objectifs) est une feature Premium : ne pas appeler l'endpoint
    // (PremiumGuard) pour un FREE, sinon 403. La session de base reste accessible.
    if (this.userStore.isPremium()) {
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

  selectMood(mood: MoodState): void {
    this.selectedMood.set(mood);
  }

  startSession(accountId?: string): void {
    this.sessionApi
      .startSession(this.selectedMood(), accountId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.activeSession.set(res.data);
          this.refreshLiveStats();
        },
        // AVANT : échec muet, le bouton « Démarrer » semblait ne rien faire.
        error: (err) => this.toast.error(apiErrorMessage(err, 'La session n’a pas pu démarrer. Réessaie.')),
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
      .subscribe({
        next: (res) => this.activeSession.set(res.data),
        error: (err) => this.toast.error(apiErrorMessage(err, 'La session n’a pas pu être clôturée. Réessaie.')),
      });
  }

  closeSessionThenDebrief(): void {
    const session = this.activeSession();
    if (!session) return;
    this.triggerCloseModal.set(false);
    this.sessionApi
      .closeSession(session.id, 'NEUTRAL' as MoodState)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.activeSession.set(res.data),
        error: (err) => this.toast.error(apiErrorMessage(err, 'La session n’a pas pu être clôturée. Réessaie.')),
      });
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

  /** Retour d'action live → toast global (PROMPT-210 ; remplace le toast local de session-live). */
  private flashFeedback(type: 'success' | 'error', text: string): void {
    this.toast[type](text);
  }

  savePlanNote(note: string): void {
    const session = this.activeSession();
    if (!note.trim() || !session) return;
    this.sessionApi
      .updateSession(session.id, { planNote: note })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.toast.error('Ta note de plan n’a pas pu être enregistrée.') });
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

  /** Stats + Live feed rechargés (trade Tradovate poussé en direct, PROMPT-210 live). */
  refreshLive(): void {
    this.refreshLiveStats();
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

  /**
   * Applique une donnée « today » fraîche (reçue via le broadcast WebSocket eco:new-releases,
   * qui déclenche un refresh-today côté composant) dans la map hebdo → mise à jour immédiate
   * du calendrier affiché. Le polling 60 s reste le filet de sécurité si le broadcast est manqué.
   */
  applyEcoRefresh(data: EcoCalendarData | null): void {
    if (!data) return;
    const today = todayParis();
    this.weekEcoEvents.update((prev) => {
      const next = new Map(prev);
      next.set(today, data.events);
      return next;
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

    // Étendre la plage pour couvrir le jour cible (en session active = aujourd'hui),
    // y compris le week-end où monday/friday pointent sur la semaine suivante.
    // Dates au format YYYY-MM-DD → comparaison lexicographique = chronologique.
    const target     = this.getTargetEcoDate();
    const mondayStr  = toParisDateStr(monday);
    const fridayStr  = toParisDateStr(friday);
    const rangeStart = target < mondayStr ? target : mondayStr;
    const rangeEnd   = target > fridayStr ? target : fridayStr;

    forkJoin({
      range: this.ecoCalendarApi.getEventsRange(rangeStart, rangeEnd),
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
