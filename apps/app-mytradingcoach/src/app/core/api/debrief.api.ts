import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { DebriefBadgeItem as DebriefItem, DebriefInsights, DebriefObjective, ObjectiveCheck, WeeklyDebrief } from '@mtc/shared';
export type { DebriefItem, DebriefInsights, DebriefObjective, ObjectiveCheck, WeeklyDebrief };

@Injectable({ providedIn: 'root' })
export class DebriefApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/debrief`;

  getCurrent(): Observable<{ data: WeeklyDebrief | null }> {
    return this.http.get<{ data: WeeklyDebrief | null }>(
      `${this.base}/current`,
    );
  }

  getByWeek(year: number, week: number): Observable<{ data: WeeklyDebrief }> {
    return this.http.get<{ data: WeeklyDebrief }>(
      `${this.base}/${year}/${week}`,
    );
  }

  getHistory(): Observable<{ data: WeeklyDebrief[] }> {
    return this.http.get<{ data: WeeklyDebrief[] }>(`${this.base}/history`);
  }

  /** PDF du débrief d'une semaine (blob à télécharger). */
  exportPdf(year: number, week: number): Observable<Blob> {
    return this.http.get(`${this.base}/${year}/${week}/pdf`, { responseType: 'blob' });
  }

  generate(): Observable<{ data: WeeklyDebrief }> {
    return this.http.post<{ data: WeeklyDebrief }>(`${this.base}/generate`, {});
  }

  addObjectiveNote(debriefId: string, index: number, note: string): Observable<{ data: WeeklyDebrief }> {
    return this.http.patch<{ data: WeeklyDebrief }>(
      `${this.base}/${debriefId}/objectives/${index}/note`,
      { note },
    );
  }
}
