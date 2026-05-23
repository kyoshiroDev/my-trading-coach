import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type MoodState = 'CONFIDENT' | 'FOCUSED' | 'NEUTRAL' | 'TIRED' | 'STRESSED';

export interface TradingSession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt?: string;
  moodStart?: MoodState;
  moodEnd?: MoodState;
  totalPnl?: number;
  totalTrades: number;
  winRate?: number;
  status: 'ACTIVE' | 'CLOSED';
  notes?: string;
}

export interface LiveStats {
  totalPnl: number;
  winRate: number;
  tradesCount: number;
  closedCount: number;
  trades: SessionTrade[];
}

export interface SessionTrade {
  id: string;
  asset: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  exit: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  pnl: number | null;
  emotion: string;
  tags: string[];
  tradedAt: string;
  sessionId: string | null;
}

@Injectable({ providedIn: 'root' })
export class SessionApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/session`;

  startSession(mood: MoodState): Observable<{ data: TradingSession }> {
    return this.http.post<{ data: TradingSession }>(`${this.base}/start`, { mood });
  }

  getActiveSession(): Observable<{ data: TradingSession | null }> {
    return this.http.get<{ data: TradingSession | null }>(`${this.base}/active`);
  }

  closeSession(id: string, mood: MoodState, notes?: string): Observable<{ data: TradingSession }> {
    return this.http.post<{ data: TradingSession }>(`${this.base}/${id}/close`, { mood, notes });
  }

  getTodayTrades(): Observable<{ data: SessionTrade[] }> {
    return this.http.get<{ data: SessionTrade[] }>(`${this.base}/today/trades`);
  }

  getLiveStats(): Observable<{ data: LiveStats }> {
    return this.http.get<{ data: LiveStats }>(`${this.base}/today/stats`);
  }

  closeTrade(tradeId: string, exitPrice: number): Observable<{ data: SessionTrade }> {
    return this.http.post<{ data: SessionTrade }>(
      `${this.base}/trades/${tradeId}/close`,
      { exitPrice },
    );
  }
}
