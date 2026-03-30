import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface Trade {
  id: string;
  asset: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  exit: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  pnl: number | null;
  riskReward: number | null;
  emotion: string;
  setup: string;
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
  private readonly baseUrl = `${environment.apiUrl}/trades`;

  readonly trades$ = signal<Trade[]>([]);
  readonly isLoading$ = signal(false);
  readonly isLoadingMore$ = signal(false);
  readonly error$ = signal<string | null>(null);
  readonly nextCursor$ = signal<string | null>(null);
  readonly hasNextPage$ = signal(false);

  readonly totalTrades = computed(() => this.trades$().length);
  readonly winningTrades = computed(() => this.trades$().filter((t) => (t.pnl ?? 0) > 0).length);
  readonly winRate = computed(() => {
    const total = this.totalTrades();
    return total > 0 ? (this.winningTrades() / total) * 100 : 0;
  });

  // Charge une première page (remplace les trades existants)
  loadTrades(filters?: Record<string, string>) {
    this.isLoading$.set(true);
    this.error$.set(null);

    const params = new URLSearchParams(filters ?? {});
    this.http.get<{ data: TradesPage }>(`${this.baseUrl}?${params}`).subscribe({
      next: (res) => {
        this.trades$.set(res.data.data);
        this.nextCursor$.set(res.data.nextCursor);
        this.hasNextPage$.set(res.data.hasNextPage);
        this.isLoading$.set(false);
      },
      error: (err) => {
        this.error$.set(err.message);
        this.isLoading$.set(false);
      },
    });
  }

  // Charge la page suivante (APPEND — ne remplace pas)
  loadMore() {
    const cursor = this.nextCursor$();
    if (!cursor || this.isLoadingMore$()) return;

    this.isLoadingMore$.set(true);
    const params = new URLSearchParams({ cursor });
    this.http.get<{ data: TradesPage }>(`${this.baseUrl}?${params}`).subscribe({
      next: (res) => {
        this.trades$.update((existing) => [...existing, ...res.data.data]);
        this.nextCursor$.set(res.data.nextCursor);
        this.hasNextPage$.set(res.data.hasNextPage);
        this.isLoadingMore$.set(false);
      },
      error: (err) => {
        this.error$.set(err.message);
        this.isLoadingMore$.set(false);
      },
    });
  }

  addTrade(trade: Trade) {
    this.trades$.update((trades) => [trade, ...trades]);
  }

  updateTrade(updated: Trade) {
    this.trades$.update((trades) =>
      trades.map((t) => (t.id === updated.id ? updated : t)),
    );
  }

  removeTrade(id: string) {
    this.trades$.update((trades) => trades.filter((t) => t.id !== id));
  }

  reset() {
    this.trades$.set([]);
    this.nextCursor$.set(null);
    this.hasNextPage$.set(false);
  }
}
