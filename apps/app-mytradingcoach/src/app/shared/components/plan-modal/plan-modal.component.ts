import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule, Check, X, Zap } from 'lucide-angular';
import { BillingApi } from '../../../core/api/billing.api';
import { PRICING } from '../../../core/constants/pricing.const';
import { ToastService } from '../../../core/services/toast.service';
import { apiErrorMessage } from '../../../core/utils/api-error';

type Interval = 'monthly' | 'yearly';
type PlanId = `premium_${Interval}`;

@Component({
  selector: 'mtc-plan-modal',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan-modal.component.html',
  styleUrl: './plan-modal.component.css',
})
export class PlanModalComponent {
  closed = output<void>();

  private readonly billingApi = inject(BillingApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly PRICING = PRICING;

  // Icônes lucide, comme partout ailleurs dans l'app : les glyphes texte (✕ ⚡ ✓) ne
  // suivaient ni la graisse ni l'alignement du reste de l'interface.
  protected readonly XIcon = X;
  protected readonly ZapIcon = Zap;
  protected readonly CheckIcon = Check;

  // Palier payant unique (Premium) depuis PROMPT-169 : seul l'intervalle est réglable.
  // L'essai 30j n'est accordé qu'au mensuel (l'annuel est facturé immédiatement).
  protected interval = signal<Interval>('monthly');
  protected isLoading = signal(false);

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
    this.isLoading.set(true);
    this.billingApi.checkout(this.planId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { window.location.href = res.data.url; },
        // AVANT : échec muet, le bouton se réactivait sans explication.
        error: (err) => {
          this.isLoading.set(false);
          this.toast.error(apiErrorMessage(err, 'Le paiement n’a pas pu démarrer. Réessaie dans un instant.'));
        },
      });
  }
}
