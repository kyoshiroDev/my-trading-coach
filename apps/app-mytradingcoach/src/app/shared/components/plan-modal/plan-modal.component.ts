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
import { PRICING, yearlyPerMonth } from '../../../core/constants/pricing.const';

type PlanId = 'starter_monthly' | 'starter_yearly' | 'premium_monthly' | 'premium_yearly';

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
  protected readonly yearlyPerMonth = yearlyPerMonth;

  protected selectedPlan = signal<PlanId>('starter_yearly');
  protected isLoading = signal(false);

  protected selectPlan(plan: PlanId) {
    this.selectedPlan.set(plan);
  }

  protected close() {
    this.closed.emit();
  }

  protected onOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) this.close();
  }

  protected confirmPlan() {
    this.isLoading.set(true);
    this.billingApi.checkout(this.selectedPlan())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { window.location.href = res.data.url; },
        error: () => this.isLoading.set(false),
      });
  }
}
