import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';
import type { EcoAnalysis, EcoBriefingLine, EcoEvent } from '@mtc/shared';
export type { EcoEvent, EcoAnalysis, EcoBriefingLine };

export interface EcoCalendarData {
  events: EcoEvent[];
  analysis: EcoAnalysis;
  userAssets: string[];
  pinnedEvents?: string[];
  /** Annonces fortes du jour : ligne factuelle (heure, prévision, précédent, actifs concernés). */
  briefing?: EcoBriefingLine[];
}

// Écart résultat / prévision calculé côté serveur + interprétation neutre (#920, conformité).
export type { EcoReleaseGap, EcoResultAnalysis } from '@mtc/shared';
import type { EcoReleaseGap, EcoResultAnalysis } from '@mtc/shared';

/** Libellés neutres de l'écart : un fait comparatif, jamais une direction de marché. */
export const ECO_GAP_LABEL: Record<EcoReleaseGap, string> = {
  above: 'Au-dessus de la prévision',
  inline: 'En ligne avec la prévision',
  below: 'En dessous de la prévision',
  no_consensus: 'Pas de consensus publié',
};

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

  /** Analyses déjà produites pour les annonces publiées d'un jour passé (lecture, sans IA). */
  getReleaseAnalyses(date: string): Observable<{ data: Record<string, EcoResultAnalysis> }> {
    return this.http.get<{ data: Record<string, EcoResultAnalysis> }>(`${this.base}/release-analyses`, { params: { date } });
  }

  refreshAnalysis(): Observable<{ data: EcoCalendarData }> {
    return this.http.post<{ data: EcoCalendarData }>(`${this.base}/refresh-today`, {});
  }

  getEventsRange(
    from: string,
    to: string,
  ): Observable<{ data: { date: string; events: EcoEvent[] }[] }> {
    return this.http.get<{ data: { date: string; events: EcoEvent[] }[] }>(
      `${this.base}/range?from=${from}&to=${to}`,
    );
  }

  getPinnedUpcoming(): Observable<{ data: EcoEvent[] }> {
    return this.http.get<{ data: EcoEvent[] }>(`${this.base}/pinned-upcoming`);
  }

  getPins(): Observable<{ data: string[] }> {
    return this.http.get<{ data: string[] }>(`${this.base}/pins`);
  }

  savePins(pins: string[]): Observable<{ data: string[] }> {
    return this.http.patch<{ data: string[] }>(`${this.base}/pins`, { pins });
  }
}
