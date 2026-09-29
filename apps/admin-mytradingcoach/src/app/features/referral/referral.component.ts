import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminApi, ReferralAdminOverview } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-referral',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './referral.component.css',
  templateUrl: './referral.component.html',
})
export class ReferralComponent {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = signal<ReferralAdminOverview | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly error = signal(false);

  constructor() {
    this.api.referralOverview()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.data.set(res.data); this.isLoading.set(false); },
        error: () => { this.error.set(true); this.isLoading.set(false); },
      });
  }

  protected initials(name: string | null, email: string): string {
    return (name ?? email).slice(0, 2).toUpperCase();
  }
  protected statusLabel(s: 'payant' | 'essai' | 'inscrit'): string {
    return s === 'payant' ? 'Payant' : s === 'essai' ? 'Essai' : 'Inscrit';
  }
}
