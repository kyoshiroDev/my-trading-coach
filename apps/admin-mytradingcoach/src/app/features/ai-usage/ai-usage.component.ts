import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminApi, AiUsageData } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-ai-usage',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ai-usage.component.css',
  templateUrl: './ai-usage.component.html',
})
export class AiUsageComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly data = signal<AiUsageData | null>(null);

  constructor() {
    this.adminApi.aiUsage().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => this.data.set(r.data));
  }
}
