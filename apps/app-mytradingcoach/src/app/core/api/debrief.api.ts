import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface DebriefItem {
  badge: string;
  text: string;
}

export interface DebriefObjective {
  title: string;
  reason: string;
}

export interface DebriefInsights {
  summary: string;
  strengths: DebriefItem[];
  weaknesses: DebriefItem[];
  emotionInsight: string;
  objectives: DebriefObjective[];
}

export interface WeeklyDebrief {
  id: string;
  weekNumber: number;
  year: number;
  startDate: string;
  endDate: string;
  aiSummary: string;
  insights: DebriefInsights;
  objectives: DebriefObjective[];
  stats: {
    winRate: number;
    totalPnl: number;
    totalTrades: number;
  };
  generatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class DebriefApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/debrief`;

  getCurrent(): Observable<{ data: WeeklyDebrief | null }> {
    return this.http.get<{ data: WeeklyDebrief | null }>(`${this.base}/current`);
  }

  getByWeek(year: number, week: number): Observable<{ data: WeeklyDebrief }> {
    return this.http.get<{ data: WeeklyDebrief }>(`${this.base}/${year}/${week}`);
  }

  getHistory(): Observable<{ data: WeeklyDebrief[] }> {
    return this.http.get<{ data: WeeklyDebrief[] }>(`${this.base}/history`);
  }

  generate(): Observable<{ data: WeeklyDebrief }> {
    return this.http.post<{ data: WeeklyDebrief }>(`${this.base}/generate`, {});
  }
}
