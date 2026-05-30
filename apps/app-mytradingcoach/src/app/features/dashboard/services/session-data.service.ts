import { Injectable, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TradesApi, MarketContext, NewsItem } from '../../../core/api/trades.api';
import { POLLING_MS } from '../../../core/constants/polling.const';

@Injectable()
export class SessionDataService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly tradesApi  = inject(TradesApi);

  readonly marketCtx    = signal<MarketContext | null>(null);
  readonly newsItems    = signal<NewsItem[]>([]);
  readonly breakingNews = signal<string | null>(null);

  private marketCtxInterval?: ReturnType<typeof setInterval>;
  private newsInterval?: ReturnType<typeof setInterval>;

  startPolling(getTradeSymbols: () => string[]): void {
    this.fetchMarketContext();
    this.fetchNewsItems(getTradeSymbols());
    this.marketCtxInterval = setInterval(() => this.fetchMarketContext(), POLLING_MS.MARKET_CONTEXT);
    this.newsInterval      = setInterval(() => this.fetchNewsItems(getTradeSymbols()), POLLING_MS.NEWS);
  }

  stopPolling(): void {
    if (this.marketCtxInterval) { clearInterval(this.marketCtxInterval); this.marketCtxInterval = undefined; }
    if (this.newsInterval)      { clearInterval(this.newsInterval);      this.newsInterval      = undefined; }
  }

  private fetchMarketContext(): void {
    this.tradesApi.getMarketContext()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.marketCtx.set(res.data) });
  }

  private fetchNewsItems(symbols: string[]): void {
    this.tradesApi.getNews(symbols)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.newsItems.set(res.data ?? []);
          const breaking = (res.data ?? []).find(i => /fed|powell|ecb|fomc/i.test(i.title));
          this.breakingNews.set(breaking?.title ?? null);
        },
      });
  }
}
