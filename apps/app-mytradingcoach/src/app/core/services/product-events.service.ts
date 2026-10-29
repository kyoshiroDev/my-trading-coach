import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '@app/environments/environment';

/** Événements d'usage (même liste blanche que l'API, `PRODUCT_EVENTS`). */
export type ProductEvent =
  | 'premium_seen'
  | 'plan_modal_open'
  | 'trial_click'
  | 'checkout_return'
  | 'demo_signup_click'
  | InstallEvent;

/** Installation de l'app et activation des alertes, `place` = plateforme (`devicePlace`). */
export type InstallEvent =
  | 'install_shown'
  | 'install_click'
  | 'install_done'
  | 'install_later'
  | 'install_never'
  | 'inapp_seen'
  | 'push_enabled'
  | 'push_denied';

/**
 * Événements d'usage : entonnoir Premium (où les inscrits rencontrent le Premium, ouvrent les
 * offres, cliquent) et installation de l'app. Envoi best-effort (jamais d'erreur affichée, jamais
 * bloquant) : un nom d'événement et l'écran (1er segment de la route) ou la plateforme. Agrégé par
 * jour côté API et RATTACHÉ AU COMPTE (`ProductEventDaily.userId`) : ce ne sont pas des compteurs
 * anonymes. Conservés 13 mois, effacés avec le compte (politique de confidentialité).
 */
@Injectable({ providedIn: 'root' })
export class ProductEventsService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  /** `premium_seen` une fois par écran et par session d'onglet : un cadenas re-rendu ne compte pas. */
  private readonly sent = new Set<string>();

  /** Écran courant : `/ai-insights?x` → `ai-insights`, racine → `dashboard`. */
  place(): string {
    const seg = this.router.url.split(/[?#]/)[0].split('/').filter(Boolean)[0] ?? 'dashboard';
    return seg.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  }

  track(event: ProductEvent, place = this.place()): void {
    this.http.post(`${environment.apiUrl}/events`, { event, place }).subscribe({ error: () => undefined });
  }

  /** Comme `track`, mais une seule fois par (événement, écran) dans cet onglet. */
  once(event: ProductEvent, place = this.place()): void {
    const key = `${event}:${place}`;
    if (this.sent.has(key)) return;
    this.sent.add(key);
    this.track(event, place);
  }
}
