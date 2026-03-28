import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

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
  riskReward: number | null;
  emotion: 'CONFIDENT' | 'STRESSED' | 'REVENGE' | 'FEAR' | 'FOCUSED' | 'NEUTRAL';
  setup: 'BREAKOUT' | 'PULLBACK' | 'RANGE' | 'REVERSAL' | 'SCALPING' | 'NEWS';
  session: 'LONDON' | 'NEW_YORK' | 'ASIAN' | 'PRE_MARKET' | 'OVERLAP';
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
  riskReward?: number;
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

@Injectable({ providedIn: 'root' })
export class TradesApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/trades`;

  getAll(filters: TradeFilters = {}): Observable<{ data: PaginatedTrades }> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null) params = params.set(key, String(val));
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
}
