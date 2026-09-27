import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import {
  LucideDynamicIcon,
  LucideCheck as Check,
  LucideX as X,
  LucideZap as Zap,
} from '@lucide/angular';
import { PRICING } from '@app/core/constants/pricing.const';
import { BillingService } from '@app/core/services/billing.service';
import { DialogDirective } from '@mtc/front-ui';

type Interval = 'monthly' | 'yearly';
type PlanId = `premium_${Interval}`;

@Component({
  selector: 'mtc-plan-modal',
  imports: [DialogDirective, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan-modal.component.html',
  styleUrl: './plan-modal.component.css',
})
export class PlanModalComponent {
  closed = output<void>();


  protected readonly PRICING = PRICING;

  // Icônes lucide, comme partout ailleurs dans l'app : les glyphes texte (✕ ⚡ ✓) ne
  // suivaient ni la graisse ni l'alignement du reste de l'interface.
  protected readonly XIcon = X;
  protected readonly ZapIcon = Zap;
  protected readonly CheckIcon = Check;

  // Palier payant unique (Premium) : seul l'intervalle est réglable.
  // L'essai 30j n'est accordé qu'au mensuel (l'annuel est facturé immédiatement).
  protected interval = signal<Interval>('monthly');
  private readonly billing = inject(BillingService);
  protected readonly isLoading = this.billing.starting;

  protected setInterval(value: Interval) {
    this.interval.set(value);
  }

  /** Recompose l'id attendu par l'API checkout. */
  protected planId(): PlanId {
    return `premium_${this.interval()}`;
  }

  /** Pourcentage d'économie de l'annuel vs 12× mensuel (~17%). */
  protected savingsPct(): number {
    const p = PRICING.premium;
    return Math.round((1 - p.yearly / (p.monthly * 12)) * 100);
  }

  /** Libellé prix sous le CTA selon l'intervalle sélectionné. */
  protected ctaPriceLabel(): string {
    const p = PRICING.premium;
    return this.interval() === 'yearly'
      ? `${p.yearly}€/an (économise ${p.savings}€)`
      : `${p.monthly}€/mois`;
  }

  protected close() {
    this.closed.emit();
  }

  protected onOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) this.close();
  }

  protected confirmPlan() {
    this.billing.startCheckout(this.planId());
  }

}
