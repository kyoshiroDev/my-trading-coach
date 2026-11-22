import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { LucideDynamicIcon, LucideLock as Lock } from '@lucide/angular';
import { ProductEventsService } from '@app/core/services/product-events.service';
import { OfferIntentService } from '@app/core/services/offer-intent.service';
import { PaywallCtaService } from '@app/core/services/paywall-cta.service';

@Component({
  selector: 'mtc-premium-lock',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './premium-lock.component.css',
  template: `
    <div class="premium-lock" data-testid="premium-lock">
      <div class="pl-content">
        <svg class="pl-icon" [lucideIcon]="LockIcon" [size]="16" aria-hidden="true"></svg>
        <div class="pl-text">
          <h3 class="pl-title">{{ heading() }}</h3>
          @if (subtitle()) {
            <div class="pl-sub">{{ subtitle() }}</div>
          }
        </div>
        <!-- Ouvre la modale de plans (cta=cadenas), rendue par le shell. Avant : lien vers
             /parametres, une route qui n'existe pas (page introuvable). -->
        <button type="button" class="pl-btn" data-testid="premium-lock-cta" (click)="intent.open('cadenas')">
          {{ paywall.label() }}
        </button>
      </div>
    </div>
  `,
})
export class PremiumLockComponent {
  /** Libellé unique des boutons de paywall (E3 #1013). */
  protected readonly paywall = inject(PaywallCtaService);
  protected readonly LockIcon = Lock;
  /** Titre du bloc. Pas « title » : un attribut statique title= poserait aussi l'info-bulle native du navigateur (#1189). */
  readonly heading  = input<string>('Fonctionnalité Premium');
  readonly subtitle = input<string>('');

  protected readonly intent = inject(OfferIntentService);

  constructor() {
    // Entonnoir : un inscrit rencontre le Premium sur cet écran (une fois par onglet).
    inject(ProductEventsService).once('premium_seen');
    // Offres (libellé fondateur du bouton) : chargées par PaywallCtaService pour un compte gratuit.
  }
}
