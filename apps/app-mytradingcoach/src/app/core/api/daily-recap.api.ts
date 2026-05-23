import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface DailyRecap {
  id: string;
  date: string;
  tradesCount: number;
  pnl: number;
  winRate: number;
  dominantEmotion?: string;
  aiOneLiner?: string;
}

@Injectable({ providedIn: 'root' })
export class DailyRecapApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/analytics`;

  getYesterdayRecap(): Observable<{ data: DailyRecap | null }> {
    return this.http.get<{ data: DailyRecap | null }>(
      `${this.base}/daily-recap/yesterday`,
    );
  }
}
