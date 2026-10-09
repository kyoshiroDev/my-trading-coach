import { Injectable, computed, inject, signal } from '@angular/core';
import { timeout, type Subscription } from 'rxjs';
import { BillingApi, type BillingOffers } from '../api/billing.api';
import { UserStore } from './user.store';

/**
 * Offres de l'utilisateur (#525) : offre fondateur (places, éligibilité, place prise), code
 * partenaire actif, intervalle. Chargées À LA DEMANDE (modale, cadenas, Profil), une fois par
 * utilisateur connecté ; `refresh()` après un paiement ou un changement d'intervalle. Échec → `null` :
 * aucune offre affichée, le Premium au prix normal reste proposé.
 */
@Injectable({ providedIn: 'root' })
export class OffersStore {
  private readonly api = inject(BillingApi);
  private readonly userStore = inject(UserStore);

  readonly offers = signal<BillingOffers | null>(null);
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
    // Délai max : une requête bloquée (session périmée, réseau) ne fige pas le store.
    this.request = this.api.offers().pipe(timeout(10_000)).subscribe({
      next: (res) => {
        this.offers.set(res.data);
        this.offersOwner = id;
      },
      // Échec : pas d'offre affichée ; le prochain écran retentera.
      error: () => {
        this.loadedFor = null;
      },
    });
  }

  private offersOwner: string | null = null;
}
