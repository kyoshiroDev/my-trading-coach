import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { type Observable, firstValueFrom, fromEvent, map, takeUntil } from 'rxjs';
import { environment } from '@app/environments/environment';
import type {
  AdminPushSubscriptionInput,
  AdminPushTestResult,
  TraderPushDeviceState,
  TraderPushPreferencesInput,
  TraderPushSettings,
} from '@mtc/shared';

/**
 * Notifications push des traders (`/push/*`, #666). L'appareil courant est identifié par son
 * endpoint, envoyé dans le corps (jamais dans l'URL : il contient un jeton).
 *
 * `signal` : annule la requête (changement de compte dans l'onglet, revue phase 2 I2). La promesse
 * est alors rejetée et la réponse, si elle arrive, n'est jamais lue.
 */
@Injectable({ providedIn: 'root' })
export class PushApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/push`;

  settings(signal?: AbortSignal): Promise<TraderPushSettings> {
    return this.send(this.http.get<{ data: TraderPushSettings }>(`${this.base}/settings`), signal);
  }

  device(endpoint: string, signal?: AbortSignal): Promise<TraderPushDeviceState> {
    return this.send(this.http.post<{ data: TraderPushDeviceState }>(`${this.base}/device`, { endpoint }), signal);
  }

  subscribe(sub: AdminPushSubscriptionInput, signal?: AbortSignal): Promise<TraderPushDeviceState> {
    return this.send(this.http.post<{ data: TraderPushDeviceState }>(`${this.base}/subscribe`, sub), signal);
  }

  removeDevice(id: string, signal?: AbortSignal): Promise<{ removed: true }> {
    return this.send(this.http.delete<{ data: { removed: true } }>(`${this.base}/devices/${encodeURIComponent(id)}`), signal);
  }

  preferences(input: TraderPushPreferencesInput, signal?: AbortSignal): Promise<TraderPushSettings> {
    return this.send(this.http.patch<{ data: TraderPushSettings }>(`${this.base}/preferences`, input), signal);
  }

  test(signal?: AbortSignal): Promise<AdminPushTestResult> {
    return this.send(this.http.post<{ data: AdminPushTestResult }>(`${this.base}/test`, {}), signal);
  }

  private send<T>(req: Observable<{ data: T }>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error('aborted'));
    const data = req.pipe(map((r) => r.data));
    return firstValueFrom(signal ? data.pipe(takeUntil(fromEvent(signal, 'abort'))) : data);
  }
}
