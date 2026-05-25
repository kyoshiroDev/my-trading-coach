import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface EcoEvent {
  time: string;
  name: string;
  impact: 'high' | 'medium';
  country: string;
  currency: string;
  actual: number | null;
  estimate: number | null;
  previous: number | null;
  isReleased: boolean;
  unit?: string | null;
}

export interface EcoAnalysis {
  summary: string;
  recommendation: string;
  assetImpacts: {
    asset: string;
    sentiment: 'bull' | 'bear' | 'neutral';
    reason: string;
  }[];
}

export interface EcoCalendarData {
  events: EcoEvent[];
  analysis: EcoAnalysis;
  userAssets: string[];
}

export interface EcoResultAnalysis {
  interpretation: string;
  assetSentiments: {
    asset: string;
    sentiment: 'bull' | 'bear' | 'neutral';
    shortReason: string;
  }[];
}

@Injectable({ providedIn: 'root' })
export class EcoCalendarApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/eco-calendar`;

  getTodayEvents(): Observable<{ data: EcoCalendarData }> {
    return this.http.get<{ data: EcoCalendarData }>(`${this.base}/today`);
  }

  getNextTradingDayEvents(): Observable<{ data: EcoCalendarData }> {
    return this.http.get<{ data: EcoCalendarData }>(`${this.base}/next-trading-day`);
  }

  analyzeResult(eventName: string): Observable<{ data: EcoResultAnalysis }> {
    return this.http.post<{ data: EcoResultAnalysis }>(
      `${this.base}/analyze-result`,
      { eventName },
    );
  }

  refreshAnalysis(): Observable<{ data: EcoCalendarData }> {
    return this.http.post<{ data: EcoCalendarData }>(`${this.base}/refresh-today`, {});
  }
}
