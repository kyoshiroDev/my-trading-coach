import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';
import type { InsightsCooldownResponse, InsightsResponse } from '@mtc/shared';

/** Message d'historique envoyé au chat IA (6 derniers échanges). */
export interface AiChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Appels IA (Premium). Formes des réponses : contrat `@mtc/shared` (`contracts/ai.ts`). */
@Injectable({ providedIn: 'root' })
export class AiApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ai`;

  /** Délai restant et dernière analyse réussie, gardée par l'API pendant le délai (C4 #1046). */
  cooldown(): Observable<{ data: InsightsCooldownResponse }> {
    return this.http.get<{ data: InsightsCooldownResponse }>(`${this.base}/cooldown`);
  }

  insights(): Observable<{ data: InsightsResponse }> {
    return this.http.post<{ data: InsightsResponse }>(`${this.base}/insights`, {});
  }

  chat(message: string, history: readonly AiChatTurn[]): Observable<{ data: { response: string } }> {
    return this.http.post<{ data: { response: string } }>(`${this.base}/chat`, { message, history });
  }
}
