import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { BillingApi } from '../../../core/api/billing.api';

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

  protected selectedPlan = signal<'monthly' | 'yearly'>('yearly');
  protected isLoading = signal(false);

  protected selectPlan(plan: 'monthly' | 'yearly') {
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
    this.billingApi.checkout(this.selectedPlan()).subscribe({
      next: (res) => { window.location.href = res.data.url; },
      error: () => this.isLoading.set(false),
    });
  }
}
