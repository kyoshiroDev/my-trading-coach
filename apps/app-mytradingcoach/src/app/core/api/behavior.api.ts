import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';
import type { BehaviorAlertHistoryItem, BehaviorConfig, BehaviorMutableDetector, BehaviorMute } from '@mtc/shared';

/** Alertes de comportement, affichage (#671) : derrière `BEHAVIOR_ALERTS_UI` côté API. */
@Injectable({ providedIn: 'root' })
export class BehaviorApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/behavior`;

  getConfig(): Observable<{ data: BehaviorConfig }> {
    return this.http.get<{ data: BehaviorConfig }>(`${this.base}/config`);
  }

  getMutes(): Observable<{ data: BehaviorMute[] }> {
    return this.http.get<{ data: BehaviorMute[] }>(`${this.base}/mutes`);
  }

  mute(detector: BehaviorMutableDetector): Observable<{ data: BehaviorMute }> {
    return this.http.post<{ data: BehaviorMute }>(`${this.base}/mutes`, { detector });
  }

  unmute(detector: BehaviorMutableDetector): Observable<void> {
    return this.http.delete<void>(`${this.base}/mutes/${detector}`);
  }

  /** Jours AAAA-MM-JJ inclus (31 au plus). */
  getAlerts(from: string, to: string): Observable<{ data: BehaviorAlertHistoryItem[] }> {
    return this.http.get<{ data: BehaviorAlertHistoryItem[] }>(`${this.base}/alerts`, { params: new HttpParams().set('from', from).set('to', to) });
  }
}
