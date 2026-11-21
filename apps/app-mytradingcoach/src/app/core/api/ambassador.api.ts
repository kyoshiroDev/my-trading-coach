import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';
import type { AmbassadorStats } from '@mtc/shared';

/** Contrat partagé (#1073), ré-exporté pour les importeurs existants. */
export type { AmbassadorReferral as ReferralUser, AmbassadorStats } from '@mtc/shared';

@Injectable({ providedIn: 'root' })
export class AmbassadorApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ambassador`;

  getStats(): Observable<{ data: AmbassadorStats }> {
    return this.http.get<{ data: AmbassadorStats }>(`${this.base}/stats`);
  }

  getNewCount(since: string): Observable<{ data: { count: number } }> {
    return this.http.get<{ data: { count: number } }>(`${this.base}/new-count`, {
      params: { since },
    });
  }
}