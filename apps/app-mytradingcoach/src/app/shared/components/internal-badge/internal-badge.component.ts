import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SignupFunnelService } from '../../../core/services/signup-funnel.service';

/**
 * Rappel discret du mode interne (`?internal=1`) : ce navigateur n'envoie plus aucune étape du
 * parcours d'inscription. `?internal=0` l'annule.
 */
@Component({
  selector: 'mtc-internal-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './internal-badge.component.css',
  template: `@if (internal()) {
    <div class="internal-badge" title="Mode interne : parcours d'inscription non compté (?internal=0 pour annuler)">interne</div>
  }`,
})
export class InternalBadgeComponent {
  protected readonly internal = inject(SignupFunnelService).internal;
}
