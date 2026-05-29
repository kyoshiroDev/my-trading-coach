import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface InstrumentDto {
  symbol: string;
  label: string;
  category: 'FUTURES_US' | 'CRYPTO' | 'FOREX' | 'INDICES' | 'ACTIONS';
  tickValue: number | null;
  tickSize?: number;
  pipDecimals?: number;
}

export interface Trade {
  id: string;
  userId: string;
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
  emotion:
    | 'CONFIDENT'
    | 'STRESSED'
    | 'REVENGE'
    | 'FEAR'
    | 'FOCUSED'
    | 'NEUTRAL';
  setup: 'BREAKOUT' | 'PULLBACK' | 'RANGE' | 'REVERSAL' | 'SCALPING' | 'NEWS';
  session: 'LONDON' | 'NEW_YORK' | 'ASIAN';
  timeframe: string;
  notes: string | null;
  tags: string[];
  tradedAt: string;
  createdAt: string;
}

export interface CreateTradeDto {
  asset: string;
  side: Trade['side'];
  entry: number;
  exit?: number;
  stopLoss?: number;
  takeProfit?: number;
  pnl?: number;
  commission?: number;
  riskReward?: number;
  quantity?: number;
  capitalEngaged?: number;
  emotion: Trade['emotion'];
  setup: Trade['setup'];
  session: Trade['session'];
  timeframe: string;
  notes?: string;
  tags?: string[];
  tradedAt?: string;
}

export type UpdateTradeDto = Partial<CreateTradeDto>;

export interface TradeFilters {
  page?: number;
  limit?: number;
  side?: Trade['side'];
  setup?: Trade['setup'];
  emotion?: Trade['emotion'];
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
}

export interface PaginatedTrades {
  data: Trade[];
  meta: {
    total: number;
    page: number;
    limit: number;
    nextCursor: string | null;
  };
}

export interface UserAssetItem {
  symbol: string;
  label: string;
  category: string;
  tradeCount: number;
  lastEntry: number | null;
  lastQty: number | null;
  isFavorite: boolean;
}

export interface InstrumentSearchResult {
  symbol: string;
  label: string;
  category: string;
}

export interface MarketContextItem { value: number | null; source: string; }
export interface TreasuryRates { t2y: number | null; t5y: number | null; t10y: number | null; t30y: number | null; }
export interface MarketContext {
  nq: MarketContextItem;
  spx: MarketContextItem;
  dxy: MarketContextItem;
  treasury: TreasuryRates;
  updatedAt: string;
}
export interface NewsItem {
  title: string;
  symbol: string;
  publishedDate: string;
  sentiment?: 'bull' | 'bear' | 'neutral';
  url?: string;
}

@Injectable({ providedIn: 'root' })
export class TradesApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/trades`;

  getAll(filters: TradeFilters = {}): Observable<{ data: PaginatedTrades }> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null)
        params = params.set(key, String(val));
    });
    return this.http.get<{ data: PaginatedTrades }>(this.base, { params });
  }

  getById(id: string): Observable<{ data: Trade }> {
    return this.http.get<{ data: Trade }>(`${this.base}/${id}`);
  }

  create(dto: CreateTradeDto): Observable<{ data: Trade }> {
    return this.http.post<{ data: Trade }>(this.base, dto);
  }

  update(id: string, dto: UpdateTradeDto): Observable<{ data: Trade }> {
    return this.http.patch<{ data: Trade }>(`${this.base}/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  getInstruments(): Observable<{ data: InstrumentDto[] }> {
    return this.http.get<{ data: InstrumentDto[] }>(`${this.base}/instruments`);
  }

  getUserAssets(): Observable<{ data: UserAssetItem[] }> {
    return this.http.get<{ data: UserAssetItem[] }>(`${this.base}/user-assets`);
  }

  saveUserAssets(assets: string[], favoriteAsset?: string | null): Observable<{ saved: boolean }> {
    return this.http.patch<{ saved: boolean }>(`${this.base}/user-assets`, { assets, favoriteAsset });
  }

  setFavoriteAsset(asset: string | null): Observable<void> {
    return this.http.patch<void>(`${this.base}/favorite-asset`, { asset });
  }

  getLivePrice(symbol: string): Observable<{ data: { price: number | null; symbol: string; cached: boolean } }> {
    return this.http.get<{ data: { price: number | null; symbol: string; cached: boolean } }>(
      `${this.base}/live-price`,
      { params: { symbol } },
    );
  }

  searchInstruments(query: string): Observable<{ data: InstrumentSearchResult[] }> {
    const params = new HttpParams().set('q', query);
    return this.http.get<{ data: InstrumentSearchResult[] }>(`${this.base}/instruments/search`, { params });
  }

  getMarketContext(): Observable<{ data: MarketContext }> {
    return this.http.get<{ data: MarketContext }>(`${this.base}/market-context`);
  }

  getNews(symbols: string[]): Observable<{ data: NewsItem[] }> {
    return this.http.get<{ data: NewsItem[] }>(
      `${this.base}/news`,
      { params: { symbols: symbols.join(',') } },
    );
  }
}
