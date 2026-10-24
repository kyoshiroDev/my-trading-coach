import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
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
 */
@Injectable({ providedIn: 'root' })
export class PushApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/push`;

  settings(): Promise<TraderPushSettings> {
    return firstValueFrom(this.http.get<{ data: TraderPushSettings }>(`${this.base}/settings`).pipe(map((r) => r.data)));
  }

  device(endpoint: string): Promise<TraderPushDeviceState> {
    return firstValueFrom(this.http.post<{ data: TraderPushDeviceState }>(`${this.base}/device`, { endpoint }).pipe(map((r) => r.data)));
  }

  subscribe(sub: AdminPushSubscriptionInput): Promise<TraderPushDeviceState> {
    return firstValueFrom(this.http.post<{ data: TraderPushDeviceState }>(`${this.base}/subscribe`, sub).pipe(map((r) => r.data)));
  }

  removeDevice(id: string): Promise<{ removed: true }> {
    return firstValueFrom(this.http.delete<{ data: { removed: true } }>(`${this.base}/devices/${encodeURIComponent(id)}`).pipe(map((r) => r.data)));
  }

  preferences(input: TraderPushPreferencesInput): Promise<TraderPushSettings> {
    return firstValueFrom(this.http.patch<{ data: TraderPushSettings }>(`${this.base}/preferences`, input).pipe(map((r) => r.data)));
  }

  test(): Promise<AdminPushTestResult> {
    return firstValueFrom(this.http.post<{ data: AdminPushTestResult }>(`${this.base}/test`, {}).pipe(map((r) => r.data)));
  }
}
