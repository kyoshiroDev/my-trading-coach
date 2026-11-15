import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import { TRIAL_PERIOD_DAYS } from '@mtc/shared';
import { PRICING } from '../constants/pricing.const';
import { OffersStore } from '../stores/offers.store';
import { UserStore } from '../stores/user.store';

/** Essai Stripe (comptes antérieurs jamais essayés, Q1 #1013) : libellé unique, carte requise. */
export const TRIAL_LABEL = `${TRIAL_PERIOD_DAYS} jours d'essai`;

/**
 * Bouton des paywalls (cadenas, écrans Premium, Profil) : UN libellé pour tous les écrans (E3 #1013 ;
 * avant, l'offre fondateur n'était proposée que sur 2 écrans). Fondateur ouvert et accessible →
 * prix fondateur ; sinon essai Stripe s'il est disponible ; sinon « Passer à Premium ».
 * Les offres sont chargées une fois pour un compte gratuit (hors démo), dès qu'un écran l'utilise.
 */
@Injectable({ providedIn: 'root' })
export class PaywallCtaService {
  private readonly offers = inject(OffersStore);
  private readonly userStore = inject(UserStore);

  readonly label = computed(() => {
    if (this.offers.founderAvailable?.()) return `Passer à Premium · ${PRICING.founder.monthly} €/mois à vie (offre fondateur) →`;
    return this.userStore.trialAvailable?.() ? `Essayer Premium · ${TRIAL_LABEL} →` : 'Passer à Premium →';
  });

  constructor() {
    effect(() => {
      // Lecture prudente (`?.`), comme OffersStore : certains écrans sont testés avec un store partiel.
      const user = this.userStore.user?.();
      if (!user || user.isDemo || this.userStore.isPremium?.()) return;
      untracked(() => this.offers.load?.({ silent: true }));
    });
  }
}
