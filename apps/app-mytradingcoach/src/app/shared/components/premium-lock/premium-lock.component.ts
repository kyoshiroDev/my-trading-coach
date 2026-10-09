import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { PRICING } from '@app/core/constants/pricing.const';
import { ProductEventsService } from '@app/core/services/product-events.service';
import { OffersStore } from '@app/core/stores/offers.store';
import { UserStore } from '@app/core/stores/user.store';
import { OfferIntentService } from '@app/core/services/offer-intent.service';

@Component({
  selector: 'mtc-premium-lock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './premium-lock.component.css',
  template: `
    <div class="premium-lock" data-testid="premium-lock">
      <div class="pl-content">
        <span class="pl-icon">✦</span>
        <div class="pl-text">
          <div class="pl-title">{{ title() }}</div>
          @if (subtitle()) {
            <div class="pl-sub">{{ subtitle() }}</div>
          }
        </div>
        <!-- Ouvre la modale de plans (cta=cadenas), rendue par le shell. Avant : lien vers
             /parametres, une route qui n'existe pas (page introuvable). -->
        <button type="button" class="pl-btn" data-testid="premium-lock-cta" (click)="intent.open('cadenas')">
          @if (offers.founderAvailable()) {
            Passer Premium · dès {{ founderMonthly }} €/mois (offre fondateur) →
          } @else if (trialAvailable()) {
            Essayer Premium · 1 mois offert →
          } @else {
            Passer à Premium →
          }
        </button>
      </div>
    </div>
  `,
})
export class PremiumLockComponent {
  readonly title    = input<string>('Fonctionnalité Premium');
  readonly subtitle = input<string>('');

  protected readonly offers = inject(OffersStore);
  protected readonly trialAvailable = inject(UserStore).trialAvailable;
  protected readonly founderMonthly = PRICING.founder.monthly;
  protected readonly intent = inject(OfferIntentService);

  constructor() {
    // Entonnoir : un inscrit rencontre le Premium sur cet écran (une fois par onglet).
    inject(ProductEventsService).once('premium_seen');
    // Offre fondateur : le libellé du bouton en dépend (une seule requête par session).
    this.offers.load();
  }
}
