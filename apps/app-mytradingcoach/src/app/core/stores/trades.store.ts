import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { TradesApi, JournalStats } from '../api/trades.api';
import { computeTradeStats } from '../utils/trade-stats.util';

export interface Trade {
  id: string;
  asset: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  exit: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  pnl: number | null;
  commission: number | null;
  riskReward: number | null;
  quantity: number | null;
  capitalEngaged: number | null;
  emotion: string | null; // override optionnel (PROMPT-163)
  effectiveEmotion?: string | null; // émotion effective calculée API (override sinon humeur session)
  // Note d'exécution CALCULÉE (PROMPT-161) : null = « Non évalué ».
  executionScore?: number | null;
  executionGrade?: 'EXCELLENT' | 'BON' | 'MOYEN' | 'MAUVAIS' | null;
  // Barème ayant produit la note (PROMPT-168) : stop-based (4 critères) ou comportemental (sans stop).
  executionMethod?: 'STOP_BASED' | 'BEHAVIORAL' | null;
  setupId: string;
  setup: { id: string; title: string; color: string };
  session: string;
  timeframe: string;
  notes: string | null;
  tags: string[];
  tradedAt: string;
  createdAt: string;
}

interface TradesPage {
  data: Trade[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

@Injectable({ providedIn: 'root' })
export class TradesStore {
  private readonly http = inject(HttpClient);
  private readonly tradesApi = inject(TradesApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly baseUrl = `${environment.apiUrl}/trades`;

  readonly trades = signal<Trade[]>([]);
  /**
   * Une première page a-t-elle abouti ? Sans cet état, `totalTrades() === 0` est
   * ambigu : il vaut 0 avant tout chargement, PENDANT un rechargement (reset + load),
   * et pour un compte réellement vide. Le dashboard lisait ce 0 comme « compte vide »
   * et affichait « Fais ton premier pas » juste après un import réussi (PROMPT-196).
   * Mis à `true` uniquement sur une réponse reçue : une erreur réseau laisse
   * « on ne sait pas », jamais « il n'a rien ». Miroir de `SelectedAccountStore.loaded`.
   */
  readonly loaded = signal(false);
  readonly isLoading = signal(false);
  readonly isLoadingMore = signal(false);
  readonly error = signal<string | null>(null);
  readonly nextCursor = signal<string | null>(null);
  readonly hasNextPage = signal(false);

  // KPIs du journal agrégés côté serveur (stables, indépendants de la pagination).
  readonly stats = signal<JournalStats | null>(null);
  readonly isLoadingStats = signal(false);

  /** Derniers filtres de loadTrades (ex. accountId) : réappliqués par loadMore. */
  private lastFilters: Record<string, string> = {};

  // Stats locales via le helper unique (BE exclus du win rate, PROMPT-160).
  private readonly localStats = computed(() => computeTradeStats(this.trades()));
  readonly totalTrades = computed(() => this.localStats().total);
  readonly winningTrades = computed(() => this.localStats().wins);
  readonly winRate = computed(() => this.localStats().winRate);

  // Charge une première page (remplace les trades existants)
  loadTrades(filters?: Record<string, string>) {
    this.isLoading.set(true);
    this.error.set(null);

    this.lastFilters = filters ?? {};
    const params = new URLSearchParams(this.lastFilters);
    this.http
      .get<{ data: TradesPage }>(`${this.baseUrl}?${params}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.trades.set(res.data.data);
          this.nextCursor.set(res.data.nextCursor);
          this.hasNextPage.set(res.data.hasNextPage);
          this.loaded.set(true);
          this.isLoading.set(false);
        },
        error: (err) => {
          this.error.set(err.message);
          this.isLoading.set(false);
        },
      });
  }

  // Charge la page suivante (APPEND, ne remplace pas)
  loadMore() {
    const cursor = this.nextCursor();
    if (!cursor || this.isLoadingMore()) return;

    this.isLoadingMore.set(true);
    const params = new URLSearchParams({ ...this.lastFilters, cursor });
    this.http
      .get<{ data: TradesPage }>(`${this.baseUrl}?${params}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.trades.update((existing) => [...existing, ...res.data.data]);
          this.nextCursor.set(res.data.nextCursor);
          this.hasNextPage.set(res.data.hasNextPage);
          this.isLoadingMore.set(false);
        },
        error: (err) => {
          this.error.set(err.message);
          this.isLoadingMore.set(false);
        },
      });
  }

  // Charge les KPIs agrégés sur l'ensemble filtré complet (mêmes filtres que loadTrades).
  loadStats(filters?: Record<string, string>) {
    this.isLoadingStats.set(true);
    this.tradesApi
      .getStats(filters ?? {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.stats.set(res.data); this.isLoadingStats.set(false); },
        error: () => { this.isLoadingStats.set(false); },
      });
  }

  addTrade(trade: Trade) {
    this.trades.update((trades) => [trade, ...trades]);
  }

  updateTrade(updated: Trade) {
    this.trades.update((trades) =>
      trades.map((t) => (t.id === updated.id ? updated : t)),
    );
  }

  removeTrade(id: string) {
    this.trades.update((trades) => trades.filter((t) => t.id !== id));
  }

  /**
   * Vide le store. `loaded` retombe à false : après un reset on ne sait plus ce que
   * le compte contient tant que le rechargement n'a pas répondu — c'est exactement la
   * fenêtre pendant laquelle le dashboard affichait « premier pas » à tort.
   */
  reset() {
    this.trades.set([]);
    this.loaded.set(false);
    this.nextCursor.set(null);
    this.hasNextPage.set(false);
  }
}
