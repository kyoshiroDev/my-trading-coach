import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AnalyticsSummary {
  winRate: number;
  totalPnl: number;
  totalTrades: number;
  maxDrawdown: number;
  streak: number;
}

export interface SetupStat {
  setup: string;
  winRate: number;
  avgRR: number;
  count: number;
}

export interface EmotionStat {
  emotion: string;
  winRate: number;
  avgRR: number;
  count: number;
}

export interface HourStat {
  hour: number;
  winRate: number;
  count: number;
}

export interface EquityPoint {
  date: string;
  cumulativePnl: number;
}

export interface TopAsset {
  asset: string;
  winRate: number;
  pnl: number;
  count: number;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/analytics`;

  getSummary(): Observable<{ data: AnalyticsSummary }> {
    return this.http.get<{ data: AnalyticsSummary }>(`${this.base}/summary`);
  }

  getBySetup(): Observable<{ data: SetupStat[] }> {
    return this.http.get<{ data: SetupStat[] }>(`${this.base}/by-setup`);
  }

  getByEmotion(): Observable<{ data: EmotionStat[] }> {
    return this.http.get<{ data: EmotionStat[] }>(`${this.base}/by-emotion`);
  }

  getByHour(): Observable<{ data: HourStat[] }> {
    return this.http.get<{ data: HourStat[] }>(`${this.base}/by-hour`);
  }

  getEquityCurve(): Observable<{ data: EquityPoint[] }> {
    return this.http.get<{ data: EquityPoint[] }>(`${this.base}/equity-curve`);
  }

  getTopAssets(): Observable<{ data: TopAsset[] }> {
    return this.http.get<{ data: TopAsset[] }>(`${this.base}/top-assets`);
  }
}
