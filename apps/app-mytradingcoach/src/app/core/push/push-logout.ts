import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '@app/environments/environment';
import { PUSH_BROWSER } from './push-browser';

/** Délai maximal du retrait côté API à la déconnexion. */
export const PUSH_LOGOUT_TIMEOUT_MS = 5_000;

/**
 * Désabonnement de CET appareil à la déconnexion (#666, revue #717 m2). Sans lui, sur un appareil
 * partagé, les alertes d'un compte arriveraient chez la personne suivante.
 *
 * D'abord le navigateur (revue phase 2 I6) : `unsubscribe()` est local, sans réseau, et l'adresse
 * meurt aussitôt chez le service push, même si l'onglet est fermé juste après. Puis l'API, avec le
 * jeton d'AVANT la déconnexion (capturé par `AuthService.logout`), par `HttpBackend` : aucun
 * intercepteur, donc ni jeton relu après effacement, ni renouvellement sur un 401, ni toast.
 * Délai maximal de 5 s et `keepalive` (la requête survit à la fermeture de l'onglet). Si elle
 * échoue, la ligne serveur sera supprimée au premier envoi (404 ou 410). Ne lève jamais.
 */
@Injectable({ providedIn: 'root' })
export class PushLogout {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly browser = inject(PUSH_BROWSER);

  async run(token: string | null): Promise<void> {
    let endpoint: string;
    try {
      const sub = await this.browser.currentSubscription();
      if (!sub) return;
      endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => false);
    } catch {
      // Navigateur sans service worker, ou registre inaccessible : rien à retirer.
      return;
    }
    if (!token) return;
    await firstValueFrom(
      this.http
        .post(`${environment.apiUrl}/push/unsubscribe`, { endpoint }, {
          headers: { Authorization: `Bearer ${token}` },
          keepalive: true,
        })
        .pipe(timeout(PUSH_LOGOUT_TIMEOUT_MS)),
    ).catch(() => undefined);
  }
}
