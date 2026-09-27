import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { AdminApi, AdminStats, SubscriptionsData } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-subscriptions',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './subscriptions.component.css',
  templateUrl: './subscriptions.component.html',
})
export class SubscriptionsComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly loading = signal(true);
  protected readonly data = signal<SubscriptionsData | null>(null);
  protected readonly stats = signal<AdminStats | null>(null);

  constructor() {
    this.adminApi.subscriptions().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r) this.data.set(r.data); this.loading.set(false); });
    this.adminApi.stats().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r) this.stats.set(r.data); });
  }

  protected av(name: string | null, email: string): string {
    return (name ?? email).slice(0, 2).toUpperCase();
  }
}
