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

// Types d'échange avec l'API : source unique dans le contrat partagé (@mtc/shared),
// ré-exportés ici pour les importeurs existants (`from '../core/api/trades.api'`).
import type {
  CreateTradeRequest as CreateTradeDto,
  JournalStats,
  Trade,
  TradeFilters,
  TradeSetup,
  TradesPage,
  UpdateTradeRequest as UpdateTradeDto,
  InstrumentSearchResult,
} from '@mtc/shared';
export type { CreateTradeDto, InstrumentSearchResult, JournalStats, Trade, TradeFilters, TradeSetup, TradesPage, UpdateTradeDto };

export interface UserAssetItem {
  symbol: string;
  label: string;
  category: string;
  tradeCount: number;
  lastEntry: number | null;
  lastQty: number | null;
  isFavorite: boolean;
}

export interface MarketContextItem { value: number | null; changePct: number | null; source: string; }
export interface TreasuryRates {
  t2y: number | null;  t2yChg: number | null;
  t5y: number | null;  t5yChg: number | null;
  t10y: number | null; t10yChg: number | null;
  t30y: number | null; t30yChg: number | null;
}
export interface MarketContext {
  nq: MarketContextItem;
  spx: MarketContextItem;
  dxy: MarketContextItem;
  treasury: TreasuryRates;
  updatedAt: string;
}
export interface NewsItem {
  id: string;
  title: string;
  symbol: string;
  publishedDate: string;
  sentiment?: 'bull' | 'bear' | 'neutral';
  url?: string;
  text?: string;
  image?: string;
  site?: string;
  textTranslated?: boolean;
}

@Injectable({ providedIn: 'root' })
export class TradesApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/trades`;
  // Instruments et données de marché ont leurs propres routes (API-21), hors /trades.
  private readonly instrumentsBase = `${environment.apiUrl}/instruments`;
  private readonly marketBase = `${environment.apiUrl}/market`;

  /** Une page de trades ; `cursor` = `nextCursor` de la page précédente. */
  getAll(filters: TradeFilters | Record<string, string> = {}): Observable<{ data: TradesPage }> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null)
        params = params.set(key, String(val));
    });
    return this.http.get<{ data: TradesPage }>(this.base, { params });
  }

  /** KPIs du journal sur l'ensemble filtré complet (mêmes filtres que la liste, sans pagination). */
  getStats(filters: Record<string, string> = {}): Observable<{ data: JournalStats }> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') params = params.set(key, String(val));
    });
    return this.http.get<{ data: JournalStats }>(`${this.base}/stats`, { params });
  }

  getById(id: string): Observable<{ data: Trade }> {
    return this.http.get<{ data: Trade }>(`${this.base}/${id}`);
  }

  create(dto: CreateTradeDto): Observable<{ data: Trade }> {
    return this.http.post<{ data: Trade }>(this.base, dto);
  }

  /** Import CSV (multipart). `T` = le récap d'import, typé par l'écran qui l'affiche. */
  importCsv<T>(form: FormData): Observable<{ data: T }> {
    return this.http.post<{ data: T }>(`${this.base}/import`, form);
  }

  update(id: string, dto: UpdateTradeDto): Observable<{ data: Trade }> {
    return this.http.patch<{ data: Trade }>(`${this.base}/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  reassign(tradeIds: string[], accountId: string): Observable<{ data: { moved: number } }> {
    return this.http.patch<{ data: { moved: number } }>(`${this.base}/reassign`, { tradeIds, accountId });
  }

  getDuplicates(): Observable<{ data: { total: number; unique: number; duplicates: number } }> {
    return this.http.get<{ data: { total: number; unique: number; duplicates: number } }>(
      `${this.base}/duplicates`,
    );
  }

  removeDuplicates(): Observable<{ data: { removed: number; kept: number } }> {
    return this.http.delete<{ data: { removed: number; kept: number } }>(
      `${this.base}/duplicates`,
    );
  }

  getInstruments(): Observable<{ data: InstrumentDto[] }> {
    return this.http.get<{ data: InstrumentDto[] }>(`${this.instrumentsBase}`);
  }

  getUserAssets(): Observable<{ data: UserAssetItem[] }> {
    return this.http.get<{ data: UserAssetItem[] }>(`${this.instrumentsBase}/user-assets`);
  }

  saveUserAssets(assets: string[], favoriteAsset?: string | null): Observable<{ saved: boolean }> {
    return this.http.patch<{ saved: boolean }>(`${this.instrumentsBase}/user-assets`, { assets, favoriteAsset });
  }

  setFavoriteAsset(asset: string | null): Observable<void> {
    return this.http.patch<void>(`${this.instrumentsBase}/favorite-asset`, { asset });
  }

  getLivePrice(symbol: string): Observable<{ data: { price: number | null; symbol: string; cached: boolean } }> {
    return this.http.get<{ data: { price: number | null; symbol: string; cached: boolean } }>(
      `${this.marketBase}/live-price`,
      { params: { symbol } },
    );
  }

  searchInstruments(query: string): Observable<{ data: InstrumentSearchResult[] }> {
    const params = new HttpParams().set('q', query);
    return this.http.get<{ data: InstrumentSearchResult[] }>(`${this.instrumentsBase}/search`, { params });
  }

  getMarketContext(): Observable<{ data: MarketContext }> {
    return this.http.get<{ data: MarketContext }>(`${this.marketBase}/context`);
  }

  getNews(symbols: string[]): Observable<{ data: NewsItem[] }> {
    return this.http.get<{ data: NewsItem[] }>(
      `${this.marketBase}/news`,
      { params: { symbols: symbols.join(',') } },
    );
  }

  // Traduction paresseuse du corps d'une news, déclenchée à l'ouverture de la modale.
  newsText(id: string): Observable<{ data: { text: string | null } }> {
    return this.http.get<{ data: { text: string | null } }>(`${this.marketBase}/news/${id}/text`);
  }
}
