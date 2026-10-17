import { Injectable, computed, inject, signal } from '@angular/core';
import { timeout, type Subscription } from 'rxjs';
import { BillingApi, type BillingOffers } from '../api/billing.api';
import { UserStore } from './user.store';

/**
 * Offres de l'utilisateur (#525) : offre fondateur (places, éligibilité, place prise), code
 * partenaire actif, intervalle. Chargées À LA DEMANDE (modale, cadenas, Profil, et dès l'inscription
 * réussie avec un lien d'offre), une fois par utilisateur connecté ; `refresh()` après un paiement ou
 * un changement d'intervalle. `status` dit où en est le chargement (#578) : la modale de plans
 * n'autorise aucun choix avant `loaded`, et affiche l'échec (`error`) avec « Réessayer ».
 */
export type OffersStatus = 'idle' | 'loading' | 'loaded' | 'error';

@Injectable({ providedIn: 'root' })
export class OffersStore {
  private readonly api = inject(BillingApi);
  private readonly userStore = inject(UserStore);

  readonly offers = signal<BillingOffers | null>(null);
  /** `idle` : rien demandé (pas connecté, démo) · `loading` · `loaded` · `error` (réessayable). */
  readonly status = signal<OffersStatus>('idle');
  /** Utilisateur pour qui les offres sont chargées (ou en cours) : un autre compte recharge. */
  private loadedFor: string | null = null;
  private request?: Subscription;

  /** L'utilisateur peut prendre une place fondateur maintenant. */
  readonly founderAvailable = computed(() => {
    const o = this.offers();
    return !!o && o.founderOffer.open && o.founderOffer.seatsLeft > 0 && o.founder.eligible;
  });
  readonly isFounder = computed(() => this.offers()?.founder.isFounder === true);
  readonly partner = computed(() => this.offers()?.partner ?? null);

  /** Charge une fois par utilisateur (une requête restée en attente, ex. session périmée, est relancée). */
  load(): void {
    const id = this.currentUserId();
    if (!id || this.loadedFor === id) return;
    this.fetch(id);
  }

  refresh(): void {
    const id = this.currentUserId();
    if (id) this.fetch(id);
  }

  /** Connecté et pas en démo (la démo ne vend rien). */
  private currentUserId(): string | null {
    const user = this.userStore.user?.();
    return user && user.isDemo !== true ? (user.id ?? user.email) : null;
  }

  private fetch(id: string): void {
    this.request?.unsubscribe();
    this.loadedFor = id;
    if (this.offers() && this.offersOwner !== id) this.offers.set(null);
    // Rafraîchissement d'offres déjà là pour ce compte : elles restent utilisables pendant ce temps.
    if (!(this.offers() && this.offersOwner === id)) this.status.set('loading');
    // Délai max : une requête bloquée (session périmée, réseau) ne fige pas le store.
    this.request = this.api.offers().pipe(timeout(10_000)).subscribe({
      next: (res) => {
        this.offers.set(res.data);
        this.offersOwner = id;
        this.status.set('loaded');
      },
      // Échec : `error` (la modale propose « Réessayer ») ; le prochain écran retentera aussi.
      error: () => {
        this.loadedFor = null;
        if (!(this.offers() && this.offersOwner === id)) this.status.set('error');
      },
    });
  }

  private offersOwner: string | null = null;
}
