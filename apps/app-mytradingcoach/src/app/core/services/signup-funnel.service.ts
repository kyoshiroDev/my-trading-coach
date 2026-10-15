import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  INTERNAL_STORAGE_KEY,
  internalFlagFromSearch,
  isInAppBrowser,
  type SignupFunnelError,
  type SignupFunnelStep,
} from '@mtc/shared';
import { environment } from '@app/environments/environment';

/** Origine du parcours (UTM d'arrivée), gardée pour l'onglet : survit au nettoyage de `mtc_utm`. */
export interface FunnelOrigin {
  source?: string;
  medium?: string;
  campaign?: string;
}

const ORIGIN_KEY = 'mtc_funnel';

/** Code d'erreur normalisé d'une inscription refusée (jamais le message brut). */
export function registerErrorCode(status: number | undefined): SignupFunnelError {
  if (status === 409) return 'email_taken';
  if (status === 400 || status === 422) return 'validation';
  if (status === 0) return 'network';
  if (status !== undefined && status >= 500) return 'server';
  return 'other';
}

/**
 * Parcours d'inscription par source (`POST /public/funnel`) : page d'inscription, envoi, succès,
 * erreur, départ vers le paiement. Anonyme et sans cookie (étape, source, medium, campagne,
 * navigateur intégré, detail d'une liste fermée), envoi best-effort jamais bloquant.
 * Mode interne (`?internal=1`, localStorage `mtc_internal`) : rien n'est envoyé depuis ce navigateur.
 */
@Injectable({ providedIn: 'root' })
export class SignupFunnelService {
  private readonly http = inject(HttpClient);
  readonly internal = signal(this.readInternal());
  /** Origine en mémoire (repli si sessionStorage est indisponible). */
  private memory: FunnelOrigin | null = null;
  private readonly inApp = isInAppBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent);

  /** Appelé au démarrage (`App`) : `?internal=1` active le mode interne, `?internal=0` l'annule. */
  captureInternal(search: string = window.location.search): void {
    const flag = internalFlagFromSearch(search);
    if (flag === null) return;
    try {
      if (flag) localStorage.setItem(INTERNAL_STORAGE_KEY, '1');
      else localStorage.removeItem(INTERNAL_STORAGE_KEY);
    } catch {
      /* stockage indisponible : le mode vaut pour cette page seulement */
    }
    this.internal.set(flag);
  }

  /** Ouverture de /register : retient l'origine du parcours pour l'onglet, puis `register_view`. */
  start(origin: FunnelOrigin): void {
    try {
      sessionStorage.setItem(ORIGIN_KEY, JSON.stringify(origin));
    } catch {
      /* sans stockage, les étapes suivantes de cette page gardent l'origine en mémoire */
    }
    this.memory = origin;
    this.track('register_view');
  }

  track(step: SignupFunnelStep, detail?: string): void {
    if (this.internal()) return;
    const origin = this.origin() ?? {};
    this.http
      .post(`${environment.apiUrl}/public/funnel`, { step, ...origin, inApp: this.inApp, ...(detail ? { detail } : {}) })
      .subscribe({ error: () => undefined });
  }

  /**
   * Départ vers le paiement, compté SEULEMENT si cet onglet est passé par /register : un abonné
   * qui paie depuis son Profil n'est pas une étape du parcours d'inscription.
   */
  trackCheckout(plan: string): void {
    if (!this.origin()) return;
    this.track('checkout_redirect', plan.startsWith('founder') ? 'founder' : 'premium');
  }

  private origin(): FunnelOrigin | null {
    if (this.memory) return this.memory;
    try {
      const raw = sessionStorage.getItem(ORIGIN_KEY);
      return raw ? (JSON.parse(raw) as FunnelOrigin) : null;
    } catch {
      return null;
    }
  }

  private readInternal(): boolean {
    try {
      return localStorage.getItem(INTERNAL_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }
}
