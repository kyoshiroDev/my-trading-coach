import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '@app/environments/environment';
import { PUSH_BROWSER } from './push-browser';

/**
 * Désabonnement de CET appareil à la déconnexion (#666, revue #717 m2). Sans lui, sur un appareil
 * partagé, les alertes d'un compte arriveraient chez la personne suivante.
 *
 * Retiré côté API avec le jeton d'AVANT la déconnexion (capturé par `AuthService.logout`), par
 * `HttpBackend` : aucun intercepteur, donc ni jeton relu après effacement, ni renouvellement sur
 * un 401, ni toast. Puis retiré côté navigateur, même si l'API n'a pas répondu (le service push
 * répondra 410 au prochain envoi, et la ligne sera supprimée). Ne lève jamais.
 */
@Injectable({ providedIn: 'root' })
export class PushLogout {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly browser = inject(PUSH_BROWSER);

  async run(token: string | null): Promise<void> {
    try {
      const sub = await this.browser.currentSubscription();
      if (!sub) return;
      if (token) {
        await firstValueFrom(
          this.http.post(`${environment.apiUrl}/push/unsubscribe`, { endpoint: sub.endpoint }, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ).catch(() => undefined);
      }
      await sub.unsubscribe().catch(() => false);
    } catch {
      // Navigateur sans service worker, ou registre inaccessible : rien à retirer.
    }
  }
}
