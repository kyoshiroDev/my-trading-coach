import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { AdminApi, type AdminPlanLinkStats } from '../../../core/api/admin.api';

/**
 * Liaison des comptes aux plans prop firm (#612) : comptes connectés reliés à un plan /
 * comptes connectés (hors démo et ADMIN), réponses des comptes sans plan, et firms signalées
 * absentes du catalogue — ce qu'il faut y ajouter ensuite.
 */
@Component({
  selector: 'mtc-admin-plan-links-card',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan-links-card.component.html',
  styleUrl: './plan-links-card.component.css',
})
export class PlanLinksCardComponent {
  private readonly api = inject(AdminApi);

  protected readonly stats = signal<AdminPlanLinkStats | null>(null);
  protected readonly failed = signal(false);

  constructor() {
    this.api
      .planLinks()
      .pipe(catchError(() => of(null)), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((r) => {
        this.stats.set(r?.data ?? null);
        this.failed.set(!r);
      });
  }
}
