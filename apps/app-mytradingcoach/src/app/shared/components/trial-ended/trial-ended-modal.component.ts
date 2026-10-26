import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DialogDirective } from '@mtc/front-ui';
import { PLAN_BENEFITS } from '@mtc/shared';
import { UserStore } from '../../../core/stores/user.store';
import { SelectedAccountStore } from '../../../core/stores/selected-account.store';
import { OfferIntentService } from '../../../core/services/offer-intent.service';

/** Clé du stockage local : la fenêtre ne s'affiche qu'une fois par compte et par appareil. */
export const TRIAL_ENDED_SEEN_KEY = 'mtc_trial_ended_seen';

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function seenIds(): string[] {
  try {
    const raw = storage()?.getItem(TRIAL_ENDED_SEEN_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Fin de l'essai d'inscription (#769) : à la première ouverture de l'app après la fin, une fenêtre
 * courte et honnête (ce qui reste gratuit, ce qui demande Premium, les offres). Une seule fois
 * (stockage local, décision du 26/10). Jamais pour la démo ni pour qui a encore un accès Premium.
 */
@Component({
  selector: 'mtc-trial-ended-modal',
  imports: [DialogDirective, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './trial-ended-modal.component.html',
  styleUrl: './trial-ended-modal.component.css',
})
export class TrialEndedModalComponent {
  private readonly userStore = inject(UserStore);
  private readonly accounts = inject(SelectedAccountStore);
  private readonly offerIntent = inject(OfferIntentService);

  protected readonly freeBenefits = PLAN_BENEFITS.free;
  protected readonly premiumBenefits = PLAN_BENEFITS.premium;

  private readonly dismissed = signal(false);
  protected readonly show = computed(() => {
    const id = this.userStore.user()?.id;
    return !!id && this.userStore.signupTrialEnded() && !this.dismissed() && !seenIds().includes(id);
  });
  /** Plusieurs comptes actifs : un seul reste actif en gratuit, le choix se fait dans Mes comptes. */
  protected readonly tooManyAccounts = computed(() => this.accounts.accounts().some((a) => a.overFreeLimit));

  protected close(): void {
    const id = this.userStore.user()?.id;
    if (id) {
      try {
        storage()?.setItem(TRIAL_ENDED_SEEN_KEY, JSON.stringify([...seenIds(), id]));
      } catch {
        /* stockage indisponible : la fenêtre se ferme quand même pour cette visite */
      }
    }
    this.dismissed.set(true);
  }

  protected seeOffers(): void {
    this.close();
    this.offerIntent.open('modale');
  }
}
