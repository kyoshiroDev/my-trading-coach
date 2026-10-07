import { Injectable, signal } from '@angular/core';

/**
 * Intention d'achat venue d'un lien (#525) : `plan=founder|premium`, `promo=CODE`, `cta=…`
 * (landing, e-mail). Gardée en sessionStorage pour survivre à l'inscription ou à la connexion,
 * puis consommée par la modale de plans ouverte automatiquement (`OfferIntentHostComponent`).
 * Jamais de checkout direct : l'utilisateur voit les conditions et choisit (fondateur ou code).
 */
export interface OfferIntent {
  plan: 'founder' | 'premium' | null;
  promo: string | null;
  cta: string | null;
}

const KEY = 'mtc_offer_intent';
const PROMO_PATTERN = /^[A-Z0-9_-]{3,20}$/;
const CTA_PATTERN = /^[a-z]{3,12}$/;

/** Lit l'intention d'une URL (query string), `null` si elle n'en porte pas. */
export function intentFromSearch(search: string): OfferIntent | null {
  const params = new URLSearchParams(search);
  const rawPlan = params.get('plan');
  const plan = rawPlan === 'founder' || rawPlan === 'premium' ? rawPlan : null;
  const promoRaw = (params.get('promo') ?? '').trim().toUpperCase();
  const promo = PROMO_PATTERN.test(promoRaw) ? promoRaw : null;
  const ctaRaw = params.get('cta') ?? '';
  const cta = CTA_PATTERN.test(ctaRaw) ? ctaRaw : null;
  if (!plan && !promo) return null;
  return { plan, promo, cta };
}

@Injectable({ providedIn: 'root' })
export class OfferIntentService {
  /** Intention en attente (modale à ouvrir dès que l'utilisateur est connecté). */
  readonly pending = signal<OfferIntent | null>(this.read());
  /**
   * Ouverture demandée depuis un écran (cadenas Premium…) : la modale est rendue par l'hôte du
   * shell, au niveau de la page (un `position: fixed` dans une carte floutée serait mal placé).
   */
  readonly requested = signal<{ cta: string } | null>(null);

  open(cta: string): void {
    this.requested.set({ cta });
  }

  /** Capture l'intention de l'URL d'arrivée (appelé au démarrage et sur /register). */
  capture(search: string = window.location.search): OfferIntent | null {
    const intent = intentFromSearch(search);
    if (!intent) return null;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(intent));
    } catch {
      /* stockage indisponible : l'intention vit le temps de la page */
    }
    this.pending.set(intent);
    return intent;
  }

  /** L'intention mène-t-elle à la modale (offre fondateur ou code) plutôt qu'au checkout direct ? */
  needsChoice(intent: OfferIntent | null = this.pending()): boolean {
    return !!intent && (intent.plan === 'founder' || !!intent.promo);
  }

  clear(): void {
    this.requested.set(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* rien à nettoyer */
    }
    this.pending.set(null);
  }

  private read(): OfferIntent | null {
    try {
      const raw = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as OfferIntent | null;
      return raw && (raw.plan || raw.promo) ? raw : null;
    } catch {
      return null;
    }
  }
}
