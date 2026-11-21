import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';
import type { GiveawayAppState, GiveawayMyWin, UpdateMyGiveawayWinRequest } from '@mtc/shared';

/** Tirage mensuel (PROMPT-tirage-mensuel, lot B) : page « Concours du mois » et page gagnant. */
@Injectable({ providedIn: 'root' })
export class GiveawayApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/giveaway`;

  state(): Observable<{ data: GiveawayAppState }> {
    return this.http.get<{ data: GiveawayAppState }>(`${this.base}/state`);
  }

  updateMyWin(dto: UpdateMyGiveawayWinRequest): Observable<{ data: GiveawayMyWin }> {
    return this.http.patch<{ data: GiveawayMyWin }>(`${this.base}/me/win`, dto);
  }
}
