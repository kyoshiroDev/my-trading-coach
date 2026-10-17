import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { environment } from '@admin/environments/environment';
import type {
  AdminPushDevice,
  AdminPushEvent,
  AdminPushPublicKey,
  AdminPushSubscriptionInput,
  AdminPushTestResult,
} from '@mtc/shared';

/** Notifications push de l'admin (`/admin/push/*`). L'appareil est identifié par son endpoint. */
@Injectable({ providedIn: 'root' })
export class PushApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/admin/push`;

  publicKey(): Promise<AdminPushPublicKey> {
    return firstValueFrom(this.http.get<{ data: AdminPushPublicKey }>(`${this.base}/public-key`).pipe(map((r) => r.data)));
  }

  subscribe(sub: AdminPushSubscriptionInput): Promise<AdminPushDevice> {
    return firstValueFrom(this.http.post<{ data: AdminPushDevice }>(`${this.base}/subscribe`, sub).pipe(map((r) => r.data)));
  }

  unsubscribe(endpoint: string): Promise<{ removed: boolean }> {
    return firstValueFrom(this.http.post<{ data: { removed: boolean } }>(`${this.base}/unsubscribe`, { endpoint }).pipe(map((r) => r.data)));
  }

  device(endpoint: string): Promise<AdminPushDevice> {
    return firstValueFrom(this.http.post<{ data: AdminPushDevice }>(`${this.base}/device`, { endpoint }).pipe(map((r) => r.data)));
  }

  preferences(endpoint: string, mutedEvents: AdminPushEvent[]): Promise<AdminPushDevice> {
    return firstValueFrom(
      this.http.patch<{ data: AdminPushDevice }>(`${this.base}/preferences`, { endpoint, mutedEvents }).pipe(map((r) => r.data)),
    );
  }

  test(): Promise<AdminPushTestResult> {
    return firstValueFrom(this.http.post<{ data: AdminPushTestResult }>(`${this.base}/test`, {}).pipe(map((r) => r.data)));
  }
}
