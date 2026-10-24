import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { SILENT_ERRORS } from '@mtc/front-ui';
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
 *
 * Toutes en `SILENT_ERRORS` (revue phase 2 m2) : la section a son propre message pour chaque
 * échec (ou se masque), le toast global de l'intercepteur en ferait un second.
 */
const SILENT = () => ({ context: new HttpContext().set(SILENT_ERRORS, true) });
@Injectable({ providedIn: 'root' })
export class PushApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/push`;

  settings(signal?: AbortSignal): Promise<TraderPushSettings> {
    return this.send(this.http.get<{ data: TraderPushSettings }>(`${this.base}/settings`, SILENT()), signal);
  }

  device(endpoint: string, signal?: AbortSignal): Promise<TraderPushDeviceState> {
    return this.send(this.http.post<{ data: TraderPushDeviceState }>(`${this.base}/device`, { endpoint }, SILENT()), signal);
  }

  subscribe(sub: AdminPushSubscriptionInput, signal?: AbortSignal): Promise<TraderPushDeviceState> {
    return this.send(this.http.post<{ data: TraderPushDeviceState }>(`${this.base}/subscribe`, sub, SILENT()), signal);
  }

  removeDevice(id: string, signal?: AbortSignal): Promise<{ removed: true }> {
    return this.send(this.http.delete<{ data: { removed: true } }>(`${this.base}/devices/${encodeURIComponent(id)}`, SILENT()), signal);
  }

  preferences(input: TraderPushPreferencesInput, signal?: AbortSignal): Promise<TraderPushSettings> {
    return this.send(this.http.patch<{ data: TraderPushSettings }>(`${this.base}/preferences`, input, SILENT()), signal);
  }

  test(signal?: AbortSignal): Promise<AdminPushTestResult> {
    return this.send(this.http.post<{ data: AdminPushTestResult }>(`${this.base}/test`, {}, SILENT()), signal);
  }

  private send<T>(req: Observable<{ data: T }>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error('aborted'));
    const data = req.pipe(map((r) => r.data));
    return firstValueFrom(signal ? data.pipe(takeUntil(fromEvent(signal, 'abort'))) : data);
  }
}
