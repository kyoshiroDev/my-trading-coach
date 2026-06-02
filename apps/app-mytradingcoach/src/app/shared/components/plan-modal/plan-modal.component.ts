import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BillingApi } from '../../../core/api/billing.api';
import { PRICING } from '../../../core/constants/pricing.const';

type PlanTier = 'starter' | 'premium';
type Interval = 'monthly' | 'yearly';
type PlanId = `${PlanTier}_${Interval}`;

@Component({
  selector: 'mtc-plan-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan-modal.component.html',
  styleUrl: './plan-modal.component.css',
})
export class PlanModalComponent {
  closed = output<void>();

  private readonly billingApi = inject(BillingApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly PRICING = PRICING;

  // Plan (carte) et intervalle (global) sont indépendants → les 2 cartes
  // suivent toujours le même intervalle (corrige l'incohérence d'affichage).
  protected selectedTier = signal<PlanTier>('premium'); // Premium recommandé par défaut
  protected interval = signal<Interval>('yearly'); // annuel par défaut (meilleure valeur)
  protected isLoading = signal(false);

  protected selectTier(tier: PlanTier) {
    this.selectedTier.set(tier);
  }

  protected setInterval(value: Interval) {
    this.interval.set(value);
  }

  /** Recompose l'id attendu par l'API checkout. */
  protected planId(): PlanId {
    return `${this.selectedTier()}_${this.interval()}`;
  }

  /** Pourcentage d'économie de l'annuel vs 12× mensuel (~25%). */
  protected savingsPct(tier: PlanTier): number {
    const p = PRICING[tier];
    return Math.round((1 - p.yearly / (p.monthly * 12)) * 100);
  }

  /** Libellé prix sous le CTA selon plan + intervalle sélectionnés. */
  protected ctaPriceLabel(): string {
    const p = PRICING[this.selectedTier()];
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
        error: () => this.isLoading.set(false),
      });
  }
}
