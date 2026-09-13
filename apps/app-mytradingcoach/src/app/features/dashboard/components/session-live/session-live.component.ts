import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule, Newspaper, CalendarDays, ListOrdered, Zap, ChevronRight } from 'lucide-angular';
import { Subject, forkJoin, interval, of, timer } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { EcoCalendarApi, EcoCalendarData, EcoEvent, EcoResultAnalysis } from '../../../../core/api/eco-calendar.api';
import { translateEcoEvent } from '../../../../core/data/eco-event-translations';
import { normalizeEventKey, eventKey } from '../../../../core/data/eco-event-key';
import { MoodState, TradingSession, LiveStats, SessionTrade } from '../../../../core/api/session.api';
import { CreateTradeDto, InstrumentSearchResult, MarketContext, NewsItem, TradesApi, UserAssetItem } from '../../../../core/api/trades.api';
import { SessionRecapComponent } from '../session-recap/session-recap.component';
import { MarketContextBarComponent } from '../market-context-bar/market-context-bar.component';
import { EcoSocketService } from '../../../../core/services/eco-socket.service';
import { UserStore } from '../../../../core/stores/user.store';
import { SetupsStore } from '../../../../core/stores/setups.store';
import { formatDuration } from '../../../../core/utils/time.utils';
import { parseDecimal } from '../../../../core/utils/parse-decimal';
import { NumericInputDirective } from '../../../../core/directives/numeric-input.directive';
import { EmotionEmojiPipe } from '../../../../shared/pipes/emotion-emoji.pipe';
import { POLLING_MS } from '../../../../core/constants/polling.const';
import { LiveNewsComponent } from './components/live-news/live-news.component';
import { LiveFeedComponent } from './components/live-feed/live-feed.component';
import { ToastService } from '../../../../core/services/toast.service';

const MOODS: { value: MoodState; label: string; emoji: string }[] = [
  { value: 'CONFIDENT', label: 'Confiant', emoji: '😎' },
  { value: 'FOCUSED',   label: 'Focalisé', emoji: '🎯' },
  { value: 'NEUTRAL',   label: 'Neutre',   emoji: '😐' },
  { value: 'TIRED',     label: 'Fatigué',  emoji: '😰' },
];

// Calendrier éco d'exemple pour la session live démo (affiché si rien de réel
// dans la fenêtre de session). Released → bloc d'analyse IA figé (DEMO_ECO_ANALYSIS).
const DEMO_LIVE_ECO_EVENTS: EcoEvent[] = [
  { time: '09:00', name: 'PMI manufacturier',  currency: 'EUR', country: 'EU', impact: 'medium', actual: 49.2, estimate: 49.0, previous: 48.8, isReleased: true,  unit: null },
  { time: '14:30', name: 'Inflation CPI (US)', currency: 'USD', country: 'US', impact: 'high',   actual: 3.1,  estimate: 3.2,  previous: 3.4,  isReleased: true,  unit: '%' },
  { time: '16:00', name: 'Discours BCE',        currency: 'EUR', country: 'EU', impact: 'high',   actual: null, estimate: null, previous: null, isReleased: false, unit: null },
];
// Analyse IA figée par événement (keyée sur le name brut). Zéro appel modèle.
const DEMO_ECO_ANALYSIS: Record<string, EcoResultAnalysis> = {
  'PMI manufacturier': {
    interpretation: "PMI au-dessus des attentes (49.2 vs 49.0) : léger soutien pour l'EUR, sentiment risk-on modéré.",
    assetSentiments: [{ asset: 'EUR/USD', sentiment: 'bull', shortReason: 'PMI meilleur que prévu' }],
  },
  'Inflation CPI (US)': {
    interpretation: "CPI US sous les attentes (3.1% vs 3.2%), désinflation confirmée : pression baissière sur le dollar, soutien des indices US.",
    assetSentiments: [
      { asset: 'MNQ', sentiment: 'bull', shortReason: 'CPI plus bas → indices en hausse' },
      { asset: 'EUR/USD', sentiment: 'bull', shortReason: 'Dollar plus faible' },
    ],
  },
  'Balance courante': {
    interpretation: "Balance courante japonaise au-dessus des attentes : léger soutien du yen, impact indirect sur tes actifs (indices US, EUR/USD).",
    assetSentiments: [{ asset: 'EUR/USD', sentiment: 'neutral', shortReason: 'Impact indirect via le yen' }],
  },
};

const EMOTIONS = [
  { value: 'CONFIDENT', emoji: '😎', title: 'Confiant' },
  { value: 'FOCUSED',   emoji: '🎯', title: 'Focalisé' },
  { value: 'NEUTRAL',   emoji: '😐', title: 'Neutre' },
  { value: 'STRESSED',  emoji: '😰', title: 'Stressé' },
  { value: 'FEAR',      emoji: '😨', title: 'Peur' },
  { value: 'REVENGE',   emoji: '🤬', title: 'Revenge' },
] as const;

// Devise d'un événement éco → instruments les plus impactés (fidélité maquette).
// USD (marché domestique de nos traders) → indices US ; devises étrangères → paire vs USD.
const BASE_CCY = new Set(['EUR', 'GBP', 'AUD', 'NZD']); // cotées XXX/USD
function currencyToInstruments(currency: string | null | undefined): string {
  const c = (currency ?? '').toUpperCase();
  if (!c) return '';
  if (c === 'USD') return 'NQ/ES';
  if (BASE_CCY.has(c)) return `${c}/USD`;
  return `USD/${c}`;
}

@Component({
  selector: 'mtc-session-live',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-live.component.css',
  imports: [LucideAngularModule, SessionRecapComponent, MarketContextBarComponent, LiveNewsComponent, LiveFeedComponent, NumericInputDirective, EmotionEmojiPipe],
  templateUrl: './session-live.component.html',
})
export class SessionLiveComponent {
  readonly session = input<TradingSession | null>(null);
  readonly todayTrades = input<SessionTrade[]>([]);
  readonly liveStats = input<LiveStats | null>(null);
  readonly ecoCalendar = input<EcoCalendarData | null>(null);
  readonly marketCtx = input<MarketContext | null>(null);
  readonly newsItems = input<NewsItem[]>([]);
  readonly breakingNews = input<string | null>(null);
  readonly triggerCloseModal = input<boolean>(false);
  /** Désactive le CTA « Démarrer » tant qu'aucun compte précis n'est choisi (règle 1 session = 1 compte). */
  readonly startDisabled = input<boolean>(false);

  readonly startSession = output<void>();
  readonly tradeClosed = output<{ tradeId: string; exitPrice: number }>();
  readonly sessionClosed = output<{ mood: MoodState; note?: string; question?: string | null }>();
  readonly tradeLogged = output<CreateTradeDto>();
  readonly ecoCalendarRefreshed = output<EcoCalendarData>();
  readonly goToDebrief = output<void>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly ecoSocket = inject(EcoSocketService);
  private readonly ecoCalendarApi = inject(EcoCalendarApi);
  private readonly userStore = inject(UserStore);
  private readonly tradesApi = inject(TradesApi);
  protected readonly setupsStore = inject(SetupsStore);
  private readonly toast = inject(ToastService);

  // News live + contexte marché = IA mutualisée → FREE (PROMPT-169), accessible à tous.

  // Icônes Lucide (headers de colonnes, design « Session live »).
  protected readonly NewsIcon  = Newspaper;
  protected readonly CalIcon   = CalendarDays;
  protected readonly FeedIcon  = ListOrdered;
  protected readonly QuickIcon = Zap;
  protected readonly ChevronIcon = ChevronRight;

  // Calendrier éco : événement publié déplié au clic (null = tous repliés, style maquette compact)
  protected readonly expandedEcoEvent = signal<string | null>(null);
  protected toggleEcoEvent(name: string): void {
    this.expandedEcoEvent.update((v) => (v === name ? null : name));
  }
  protected impactedInstruments(currency: string | null | undefined): string {
    return currencyToInstruments(currency);
  }

  // Timer
  private readonly now = signal(new Date());
  private readonly startTime = signal<Date | null>(null);

  protected readonly elapsed = computed(() => {
    const start = this.startTime();
    if (!start) return '00:00:00';
    return formatDuration(Math.floor((this.now().getTime() - start.getTime()) / 1000));
  });

  // Close trade panel
  protected readonly closingTradeId = signal<string | null>(null);
  protected readonly exitPriceInput = signal('');

  // (close session gérée via onglet Débrief dans session-day)

  // Modal news
  protected readonly selectedNews = signal<NewsItem | null>(null);
  // Traduction paresseuse du corps : true pendant l'appel à /news/:id/text.
  protected readonly translatingNewsText = signal(false);
  private readonly newsDialogRef = viewChild<ElementRef<HTMLElement>>('newsDialog');
  private newsTrigger: HTMLElement | null = null;

  protected openNews(item: NewsItem): void {
    this.newsTrigger = (document.activeElement as HTMLElement) ?? null;
    this.selectedNews.set(item);
    this.translatingNewsText.set(false);

    // Traduction du texte à la demande (1re ouverture) : le corps n'est traduit
    // que pour les news réellement consultées. Hors démo, et seulement s'il y a du texte.
    if (item.textTranslated === false && !!item.text && !this.userStore.isDemo()) {
      this.translatingNewsText.set(true);
      this.tradesApi.newsText(item.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.translatingNewsText.set(false);
            const fr = res.data?.text ?? null;
            if (fr) {
              this.selectedNews.update((n) =>
                n && n.id === item.id ? { ...n, text: fr, textTranslated: true } : n,
              );
            }
          },
          error: () => this.translatingNewsText.set(false),
        });
    }
  }
  protected closeNews(): void {
    this.selectedNews.set(null);
    this.translatingNewsText.set(false);
    this.newsTrigger?.focus();
    this.newsTrigger = null;
  }


  // Quick trade form : asset selection
  protected readonly userAssets = signal<UserAssetItem[]>([]);
  protected readonly assetsLoading = signal(false);
  protected readonly assetsError = signal(false);
  protected readonly qtSelectedAsset = signal<UserAssetItem | null>(null);
  // Saisie libre d'actif (anti-blocage premier trade)
  protected readonly customAssetMode    = signal(false);
  protected readonly customAssetQuery   = signal('');
  protected readonly customAssetResults = signal<InstrumentSearchResult[]>([]);
  private readonly customAssetSearch$   = new Subject<string>();
  protected readonly qtSide = signal<'LONG' | 'SHORT'>('LONG');
  protected readonly qtEmotion = signal<'CONFIDENT' | 'STRESSED' | 'REVENGE' | 'FEAR' | 'FOCUSED' | 'NEUTRAL'>('CONFIDENT');
  protected readonly qtSetup = signal<string>('');
  protected readonly qtTimeframe = signal<string>('5m');
  protected readonly qtQty = signal('1');
  protected readonly qtSl = signal('');
  protected readonly qtTp = signal('');
  protected readonly qtSubmitting = signal(false);

  // Eco results cache
  private readonly ecoResults = signal<Record<string, EcoResultAnalysis>>({});

  // Pins chargés directement depuis l'API : indépendant du cache getTodayEvents
  private readonly freshPins = signal<string[] | null>(null);

  // Prix temps réel FMP
  protected readonly livePrice = signal<number | null>(null);
  protected readonly livePriceLoading = signal(false);
  private livePriceInterval?: ReturnType<typeof setInterval>;

  protected readonly livePricePlaceholder = computed(() => {
    const price = this.livePrice();
    if (price === null) return '0.00';
    const symbol = this.qtSelectedAsset()?.symbol ?? '';
    const dec = ((symbol.includes('/') && !symbol.includes('USDT')) || price < 10) ? 4 : 2;
    // Milliers espace + décimale point (fidélité maquette : « 20 142.25 »)
    return price.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).replace(',', '.');
  });

  protected readonly pinnedKeys = computed(() => {
    const fresh = this.freshPins();
    const raw = fresh !== null ? fresh : (this.ecoCalendar()?.pinnedEvents ?? []);
    return new Set(raw.map(normalizeEventKey));
  });

  protected readonly sessionEcoEvents = computed(() => {
    const events = (this.ecoCalendar()?.events ?? []).filter((e) => !!e.name?.trim());
    const pinned = this.pinnedKeys();
    const hasMatchingPins = pinned.size > 0 &&
      events.some(e => pinned.has(eventKey(e)));
    if (!hasMatchingPins) return events;
    return events
      .filter(e => pinned.has(eventKey(e)))
      .sort((a, b) => a.time.localeCompare(b.time));
  });

  /** Cap d'affichage : au-delà, on résume par un compteur « +N autres ». */
  private readonly MAX_ECO_EVENTS = 12;

  /** Événements pertinents : contenu réel + fenêtre de session (pas toute la
   *  journée éco, sinon empilement illisible de barres fines).
   *  - publié → seulement si une valeur a été publiée (actual != null), dans les 6 dernières heures
   *  - à venir → heure valide, de −30 min à +6 h autour de maintenant
   *  Triés par heure croissante. */
  protected readonly relevantEcoEvents = computed(() =>
    this.sessionEcoEvents()
      .filter((e) => {
        if (!e.name?.trim()) return false;
        const delta = this.eventMinutesFromNow(e.time);
        if (e.isReleased) {
          if (e.actual == null) return false;
          return delta === null || (delta >= -360 && delta <= 60);
        }
        return delta !== null && delta >= -30 && delta <= 360;
      })
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')),
  );

  /** Liste effectivement rendue (plafonnée). En démo, exemples figés si rien de réel. */
  protected readonly visibleEcoEvents = computed(() => {
    const real = this.relevantEcoEvents().slice(0, this.MAX_ECO_EVENTS);
    if (real.length > 0) return real;
    return this.userStore.isDemo() ? DEMO_LIVE_ECO_EVENTS : real;
  });

  /** Nombre d'événements pertinents masqués par le cap. */
  protected readonly hiddenEcoCount = computed(() =>
    Math.max(0, this.relevantEcoEvents().length - this.MAX_ECO_EVENTS),
  );

  // Eco WebSocket : nouvelles releases temps réel
  protected readonly newReleases = signal<EcoEvent[]>([]);
  protected readonly showReleaseAlert = signal(false);
  protected readonly releaseAlertState = signal<'analyzing' | 'ready' | 'error'>('analyzing');
  private releaseAlertTimer?: ReturnType<typeof setTimeout>;
  /** Events déjà analysés (dédup du déclenchement au montage). */
  private readonly analyzedNames = new Set<string>();

  protected readonly moods = MOODS;
  protected readonly emotions = EMOTIONS;

  constructor() {
    // Setups du user pour le sélecteur de trade rapide. Le choix est REVALIDÉ à
    // chaque changement de la liste active, jamais figé : le compagnon de session
    // vit des heures, et un setup supprimé/archivé entre-temps laissait sinon
    // `qtSetup` sur un id fantôme → 400 sur chaque trade rapide loggé (même défaut
    // que l'import CSV, PROMPT-182). Écriture dans `untracked` pour ne pas boucler.
    this.setupsStore.load();
    effect(() => {
      const active = this.setupsStore.active();
      untracked(() => {
        if (this.qtSetup() && active.some((s) => s.id === this.qtSetup())) return;
        this.qtSetup.set(active[0]?.id ?? '');
      });
    });

    // Démo : analyse IA figée pour les annonces du calendrier (zéro appel modèle).
    if (this.userStore.isDemo()) this.ecoResults.set(DEMO_ECO_ANALYSIS);

    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(new Date()));

    // triggerCloseModal → naviguer vers l'onglet Débrief
    effect(() => {
      if (this.triggerCloseModal()) {
        this.goToDebrief.emit();
      }
    });

    effect(() => {
      const s = this.session();
      if (s?.startedAt && s.status === 'ACTIVE') {
        this.startTime.set(new Date(s.startedAt));
      } else {
        this.startTime.set(null);
      }
    });

    // Modale news → focus sur le dialogue à l'ouverture (accessibilité clavier)
    effect(() => {
      const dialog = this.newsDialogRef()?.nativeElement;
      if (this.selectedNews() && dialog) dialog.focus();
    });

    // Assets chargés immédiatement : indépendamment de la session
    this.loadUserAssets();

    // Recherche d'instrument (saisie libre d'actif)
    this.customAssetSearch$
      .pipe(
        debounceTime(300),
        map((q) => q.trim()),
        distinctUntilChanged(),
        switchMap((q) =>
          q.length < 2
            ? of({ data: [] as InstrumentSearchResult[] })
            : this.tradesApi.searchInstruments(q).pipe(catchError(() => of({ data: [] as InstrumentSearchResult[] }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => this.customAssetResults.set(res.data ?? []));

    // Pins chargés directement : pas de dépendance au cache getTodayEvents
    this.ecoCalendarApi.getPins()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => this.freshPins.set(res.data ?? []));

    // Arrêter le polling prix au destroy
    this.destroyRef.onDestroy(() => this.stopLivePricePolling());

    // WebSocket éco : connecter quand session active (analyse IA éco = IA mutualisée → FREE).
    effect(() => {
      const s = this.session();
      if (s?.status === 'ACTIVE') {
        this.ecoSocket.connect();
      } else {
        this.ecoSocket.disconnect();
      }
    });

    // Analyse IA des events DÉJÀ publiés à l'ouverture (session active, hors démo).
    // Limité au FORT impact : ce sont eux qui bougent le marché. Sur une grosse journée
    // (~19 events US), ça évite une rafale d'appels modèle à la 1re ouverture ; le cache
    // mutualisé sert les suivantes. Les releases live restent couvertes par newReleases$.
    effect(() => {
      const s = this.session();
      if (s?.status !== 'ACTIVE' || this.userStore.isDemo()) return;
      const released = this.sessionEcoEvents().filter(
        (e) => e.impact === 'high' && e.isReleased && e.actual != null && !!e.name?.trim(),
      );
      const pending = released.filter((e) => !this.analyzedNames.has(e.name));
      // Échelonné (400 ms) pour ne pas lancer N requêtes simultanées.
      pending.forEach((e, i) => {
        this.analyzedNames.add(e.name);
        timer(i * 400)
          .pipe(
            switchMap(() => this.ecoCalendarApi.analyzeResult(e.name).pipe(catchError(() => of(null)))),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe((res) => {
            if (res?.data) this.ecoResults.update((prev) => ({ ...prev, [e.name]: res.data }));
          });
      });
    });

    // Écouter les nouvelles releases
    this.ecoSocket.newReleases$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((events) => {
        this.newReleases.set(events);
        this.releaseAlertState.set('analyzing');
        this.showReleaseAlert.set(true);
        clearTimeout(this.releaseAlertTimer);

        // Re-synchroniser le calendrier (actual values) pour le parent
        this.ecoCalendarApi.refreshAnalysis()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((res) => this.ecoCalendarRefreshed.emit(res.data));

        // Analyse IA ciblée par événement publié
        const calls = events.map((ev) =>
          this.ecoCalendarApi.analyzeResult(ev.name).pipe(
            map((res) => ({ name: ev.name, analysis: res.data })),
            catchError(() => of({ name: ev.name, analysis: null as EcoResultAnalysis | null })),
          ),
        );
        if (!calls.length) { this.showReleaseAlert.set(false); return; }

        forkJoin(calls)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((results) => {
            const next = { ...this.ecoResults() };
            let anyOk = false;
            for (const r of results) {
              if (r.analysis) { next[r.name] = r.analysis; anyOk = true; }
            }
            this.ecoResults.set(next);
            this.releaseAlertState.set(anyOk ? 'ready' : 'error');
            // auto-dismiss UNIQUEMENT une fois l'analyse arrivée
            this.releaseAlertTimer = setTimeout(() => this.showReleaseAlert.set(false), 12000);
          });
      });

    this.destroyRef.onDestroy(() => clearTimeout(this.releaseAlertTimer));
  }

  protected readonly pnlDisplay = computed(() => {
    const pnl = this.liveStats()?.totalPnl ?? 0;
    return `${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}$`;
  });

  protected readonly pnlColor = computed(() => {
    const pnl = this.liveStats()?.totalPnl ?? 0;
    if (pnl === 0) return 'var(--text-2)';
    return pnl > 0 ? 'var(--green)' : 'var(--red)';
  });

  protected readonly canSubmitQuickTrade = computed(
    () => this.qtSelectedAsset() !== null,
  );

  protected moodEmoji(mood?: MoodState | null): string {
    const map: Record<string, string> = {
      CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', TIRED: '😰', STRESSED: '😰',
    };
    return map[mood ?? ''] ?? '😐';
  }

  protected tradeTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  protected closeBadgeClass(tags: string[]): string {
    if (tags.includes('TP')) return 'tp';
    if (tags.includes('SL')) return 'sl';
    return 'manual';
  }

  protected closeBadgeLabel(tags: string[]): string {
    if (tags.includes('TP')) return 'TP';
    if (tags.includes('SL')) return 'SL';
    return '-';
  }

  protected isOutsideSession(time: string): boolean {
    const h = parseInt(time.split(':')[0] ?? '0', 10);
    return h >= 16;
  }

  protected formatTime(iso: string): string {
    if (!iso) return '-';
    if (iso.includes('T')) {
      const d = new Date(iso);
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    return iso.slice(0, 5);
  }

  protected minutesUntil(time: string): number {
    const now = new Date();
    const h = parseInt(time.split(':')[0] ?? '0', 10);
    const min = parseInt(time.split(':')[1] ?? '0', 10);
    const eventMin = h * 60 + min;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return Math.max(0, eventMin - nowMin);
  }

  /** Minutes signées entre l'événement et maintenant (négatif = passé).
   *  Gère le format « HH:MM » comme l'ISO. null si l'heure est invalide. */
  private eventMinutesFromNow(time: string | null | undefined): number | null {
    if (!time) return null;
    let h: number, m: number;
    if (time.includes('T')) {
      const d = new Date(time);
      h = d.getHours();
      m = d.getMinutes();
    } else {
      h = parseInt(time.split(':')[0] ?? '', 10);
      m = parseInt(time.split(':')[1] ?? '0', 10);
    }
    if (!Number.isFinite(h)) return null;
    const now = new Date();
    return h * 60 + (Number.isFinite(m) ? m : 0) - (now.getHours() * 60 + now.getMinutes());
  }

  protected getEventAnalysis(eventName: string): EcoResultAnalysis | null {
    return this.ecoResults()[eventName] ?? null;
  }

  protected openClosePanel(tradeId: string): void {
    if (this.closingTradeId() === tradeId) {
      this.cancelClose();
    } else {
      this.closingTradeId.set(tradeId);
      this.exitPriceInput.set('');
    }
  }

  protected cancelClose(): void {
    this.closingTradeId.set(null);
    this.exitPriceInput.set('');
  }

  protected submitClose(): void {
    const tradeId = this.closingTradeId();
    const exitPrice = parseDecimal(this.exitPriceInput());
    if (!tradeId || exitPrice == null || exitPrice <= 0) return;
    this.tradeClosed.emit({ tradeId, exitPrice });
    this.cancelClose();
  }

  protected detectCloseType(trade: SessionTrade, exitRaw: string): string {
    const exitPrice = parseDecimal(exitRaw);
    if (exitPrice == null) return 'Clôture manuelle';
    if (trade.stopLoss !== null) {
      const isSl = trade.side === 'LONG' ? exitPrice <= trade.stopLoss : exitPrice >= trade.stopLoss;
      if (isSl) return 'SL détecté';
    }
    if (trade.takeProfit !== null) {
      const isTp = trade.side === 'LONG' ? exitPrice >= trade.takeProfit : exitPrice <= trade.takeProfit;
      if (isTp) return 'TP détecté';
    }
    return 'Clôture manuelle';
  }

  protected loadUserAssets(): void {
    this.assetsLoading.set(true);
    this.assetsError.set(false);
    this.tradesApi.getUserAssets()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const assets = res.data ?? [];
          this.userAssets.set(assets);
          const preselect = assets.find((a) => a.isFavorite) ?? assets[0] ?? null;
          if (preselect) this.applyAssetSelection(preselect);
          this.assetsLoading.set(false);
        },
        error: () => {
          this.assetsError.set(true);
          this.assetsLoading.set(false);
        },
      });
  }

  protected onAssetSelect(event: Event): void {
    const symbol = (event.target as HTMLSelectElement).value;
    if (symbol === '__custom__') {
      this.customAssetMode.set(true);
      this.customAssetQuery.set('');
      this.customAssetResults.set([]);
      return;
    }
    const asset = this.userAssets().find((a) => a.symbol === symbol) ?? null;
    this.qtSelectedAsset.set(asset);
    if (asset) this.applyAssetSelection(asset);
  }

  protected onCustomAssetSearch(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.customAssetQuery.set(v);
    this.customAssetSearch$.next(v);
  }

  protected submitCustomAsset(): void {
    const q = this.customAssetQuery().trim();
    if (q) this.addCustomAsset(q);
  }

  protected cancelCustomAsset(): void {
    this.customAssetMode.set(false);
    this.customAssetQuery.set('');
    this.customAssetResults.set([]);
  }

  /** Ajoute un actif saisi librement : local immédiat + persistance, sélectionné pour le trade. */
  protected addCustomAsset(symbol: string): void {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;

    let asset = this.userAssets().find((a) => a.symbol === sym) ?? null;
    if (!asset) {
      asset = {
        symbol: sym, label: sym, category: '',
        tradeCount: 0, lastEntry: null, lastQty: null, isFavorite: false,
      };
      this.userAssets.update((list) => [asset as UserAssetItem, ...list]);
    }

    this.applyAssetSelection(asset);
    this.cancelCustomAsset();

    // Persister la liste d'actifs (ne pas bloquer en cas d'erreur réseau)
    const symbols = this.userAssets().map((a) => a.symbol);
    const fav = this.userAssets().find((a) => a.isFavorite)?.symbol ?? null;
    this.tradesApi.saveUserAssets(symbols, fav)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => undefined, error: () => undefined });
  }

  private applyAssetSelection(asset: UserAssetItem): void {
    this.qtSelectedAsset.set(asset);
    // L'entry est capturée automatiquement au clic (prix marché de l'instant) : pas de saisie.
    if (asset.lastQty != null) this.qtQty.set(String(asset.lastQty));
    this.startLivePricePolling(asset.symbol);
  }

  private fetchLivePrice(symbol: string): void {
    if (!symbol) { this.livePrice.set(null); return; }
    this.livePriceLoading.set(true);
    this.tradesApi.getLivePrice(symbol).subscribe({
      next: (res) => {
        this.livePrice.set(res.data?.price ?? null);
        this.livePriceLoading.set(false);
      },
      error: () => {
        this.livePrice.set(null);
        this.livePriceLoading.set(false);
      },
    });
  }

  private startLivePricePolling(symbol: string): void {
    this.stopLivePricePolling();
    this.livePrice.set(null);
    this.fetchLivePrice(symbol);
    this.livePriceInterval = setInterval(() => {
      // Garde-fou : pas d'appels quand l'onglet est masqué
      if (!document.hidden) this.fetchLivePrice(symbol);
    }, POLLING_MS.LIVE_PRICE);
  }

  private stopLivePricePolling(): void {
    if (this.livePriceInterval) {
      clearInterval(this.livePriceInterval);
      this.livePriceInterval = undefined;
    }
  }

  protected setFavorite(): void {
    const asset = this.qtSelectedAsset();
    if (!asset) return;
    const newFav = asset.isFavorite ? null : asset.symbol;
    this.tradesApi.setFavoriteAsset(newFav).subscribe({
      next: () => {
        this.userAssets.update((list) =>
          list.map((a) => ({ ...a, isFavorite: a.symbol === newFav })),
        );
        this.qtSelectedAsset.update((a) =>
          a ? { ...a, isFavorite: !a.isFavorite } : null,
        );
      },
      // AVANT : échec muet, l'étoile ne changeait pas sans explication.
      error: () => this.toast.error('Favori non enregistré. Réessaie.'),
    });
  }

  protected submitQuickTrade(): void {
    const selected = this.qtSelectedAsset();
    if (!selected || this.qtSubmitting()) return;

    this.qtSubmitting.set(true);
    // Capture FRAÎCHE du prix au moment exact du clic (cache backend 3s).
    this.tradesApi
      .getLivePrice(selected.symbol)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.emitTrade(selected, res.data?.price ?? this.livePrice() ?? 0);
          this.qtSubmitting.set(false);
        },
        error: () => {
          // Fallback : dernier prix affiché (ne pas bloquer le log)
          this.emitTrade(selected, this.livePrice() ?? 0);
          this.qtSubmitting.set(false);
        },
      });
  }

  private emitTrade(selected: UserAssetItem, entry: number): void {
    const h = new Date().getHours();
    let session: CreateTradeDto['session'];
    if (h >= 7 && h < 16) session = 'LONDON';
    else if (h >= 14 && h < 22) session = 'NEW_YORK';
    else session = 'ASIAN';

    // Normalisation virgule → point avant envoi (champs filtrés par mtcNumericInput).
    const qty = parseDecimal(this.qtQty());
    const sl = parseDecimal(this.qtSl());
    const tp = parseDecimal(this.qtTp());

    const dto: CreateTradeDto = {
      asset: selected.symbol,
      side: this.qtSide(),
      emotion: this.qtEmotion(),
      setupId: this.qtSetup(),
      session,
      timeframe: this.qtTimeframe(),
      entry,
      ...(qty != null ? { quantity: qty } : {}),
      ...(sl != null ? { stopLoss: sl } : {}),
      ...(tp != null ? { takeProfit: tp } : {}),
    };

    this.tradeLogged.emit(dto);
    this.qtSl.set('');
    this.qtTp.set('');
    this.qtQty.set('1');
  }

  private readonly FLAGS: Record<string, string> = {
    US: '🇺🇸', EU: '🇪🇺', GB: '🇬🇧', JP: '🇯🇵',
    CA: '🇨🇦', AU: '🇦🇺', NZ: '🇳🇿', CH: '🇨🇭',
    CN: '🇨🇳', DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹',
    USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
    CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', CHF: '🇨🇭',
    CNY: '🇨🇳', CNH: '🇨🇳', SEK: '🇸🇪', NOK: '🇳🇴',
    DKK: '🇩🇰', HKD: '🇭🇰', SGD: '🇸🇬', MXN: '🇲🇽',
  };

  protected translate(name: string): string {
    return translateEcoEvent(name);
  }

  protected formatNewsTime(iso: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  protected getFlag(event: { country?: string | null; currency?: string | null }): string {
    if (event.country) {
      const flag = this.FLAGS[event.country.toUpperCase()];
      if (flag) return flag;
    }
    return this.FLAGS[event.currency?.toUpperCase() ?? ''] ?? '🌐';
  }

  private readonly ai_badge = 'ai-badge';
  protected get aiBadge() { return this.ai_badge; }
}