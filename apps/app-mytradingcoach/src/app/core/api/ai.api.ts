import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';

/** Message d'historique envoyé au chat IA (6 derniers échanges). */
export interface AiChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Appels IA (Premium). Le type de réponse des insights reste celui de l'écran qui l'affiche
 * (`T`), pour ne pas coupler la couche API à un composant.
 */
@Injectable({ providedIn: 'root' })
export class AiApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ai`;

  cooldown(): Observable<{ data: { cooldownSeconds: number } }> {
    return this.http.get<{ data: { cooldownSeconds: number } }>(`${this.base}/cooldown`);
  }

  insights<T>(): Observable<{ data: T }> {
    return this.http.post<{ data: T }>(`${this.base}/insights`, {});
  }

  chat(message: string, history: readonly AiChatTurn[]): Observable<{ data: { response: string } }> {
    return this.http.post<{ data: { response: string } }>(`${this.base}/chat`, { message, history });
  }
}
