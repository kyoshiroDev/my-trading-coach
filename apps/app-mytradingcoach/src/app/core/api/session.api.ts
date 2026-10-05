import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';
import type { MoodState, SessionHistoryItem, SessionStatus, TradeSide } from '@mtc/shared';

export type { MoodState };

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
  status: SessionStatus;
  notes?: string;
  reflectionNote?: string;
  reflectionQuestion?: string;
  planNote?: string | null;
  marketContext?: string | null;
  accountId?: string | null;
}

export type { SessionHistoryItem };

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
  side: TradeSide;
  entry: number;
  exit: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  /** P&L BRUT ; le net (affiché) = pnl − commission, cf. netPnl (@mtc/shared). */
  pnl: number | null;
  commission?: number | null;
  emotion: string;
  setupId?: string;
  setup?: { id: string; title: string; color: string };
  riskReward?: number | null;
  tags: string[];
  tradedAt: string;
  sessionId: string | null;
}

@Injectable({ providedIn: 'root' })
export class SessionApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/session`;

  startSession(mood: MoodState, accountId?: string): Observable<{ data: TradingSession }> {
    return this.http.post<{ data: TradingSession }>(`${this.base}/start`, {
      mood,
      ...(accountId ? { accountId } : {}),
    });
  }

  /** Session du jour : l'active, sinon la dernière clôturée aujourd'hui (avec ses trades). */
  getTodaySession(): Observable<{ data: (TradingSession & { trades?: SessionTrade[] }) | null }> {
    return this.http.get<{ data: (TradingSession & { trades?: SessionTrade[] }) | null }>(`${this.base}/today`);
  }

  closeSession(
    id: string,
    mood: MoodState,
    notes?: string,
    reflectionNote?: string,
    reflectionQuestion?: string,
  ): Observable<{ data: TradingSession }> {
    return this.http.post<{ data: TradingSession }>(`${this.base}/${id}/close`, {
      mood, notes, reflectionNote, reflectionQuestion,
    });
  }

  updateSession(
    id: string,
    data: { planNote?: string; marketContext?: string; notes?: string; reflectionNote?: string; moodEnd?: string },
  ): Observable<{ data: TradingSession }> {
    return this.http.patch<{ data: TradingSession }>(`${this.base}/${id}`, data);
  }

  getSessionHistory(limit = 50, offset = 0): Observable<{ data: SessionHistoryItem[] }> {
    return this.http.get<{ data: SessionHistoryItem[] }>(
      `${this.base}/history?limit=${limit}&offset=${offset}`,
    );
  }

  getSessionsByMonth(year: number, month: number, accountId?: string, limit = 50): Observable<{ data: SessionHistoryItem[] }> {
    const acc = accountId ? `&accountId=${encodeURIComponent(accountId)}` : '';
    return this.http.get<{ data: SessionHistoryItem[] }>(
      `${this.base}/history?year=${year}&month=${month}&limit=${limit}${acc}`,
    );
  }

  getSessionDetail(id: string): Observable<{ data: TradingSession & { trades: SessionTrade[] } }> {
    return this.http.get<{ data: TradingSession & { trades: SessionTrade[] } }>(
      `${this.base}/history/${id}`,
    );
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
