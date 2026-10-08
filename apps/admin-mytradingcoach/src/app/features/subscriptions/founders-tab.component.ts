import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { AdminApi, type AdminFoundersData, type FounderSeatStatus } from '../../core/api/admin.api';
import { FOUNDER_STATUS_BADGE, FOUNDER_STATUS_LABEL, ctaRecap } from '../../core/utils/offers.util';

/**
 * Onglet « Fondateurs » (#525) : interrupteur « Ouvrir l'offre » (confirmation dans la page),
 * date de fin optionnelle, récapitulatif par point de clic, tableau filtrable et paginé.
 */
@Component({
  selector: 'mtc-admin-founders-tab',
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './offers-tabs.css',
  templateUrl: './founders-tab.component.html',
})
export class FoundersTabComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  /** Données rechargées : le parent met à jour son KPI. */
  readonly changed = output<AdminFoundersData>();

  protected readonly STATUS_LABEL = FOUNDER_STATUS_LABEL;
  protected readonly STATUS_BADGE = FOUNDER_STATUS_BADGE;
  protected readonly STATUSES = Object.keys(FOUNDER_STATUS_LABEL) as FounderSeatStatus[];

  protected readonly data = signal<AdminFoundersData | null>(null);
  protected readonly loadError = signal(false);
  protected readonly status = signal<FounderSeatStatus | null>(null);
  protected readonly page = signal(1);
  protected readonly confirming = signal(false);
  protected readonly saving = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly endsAtInput = signal('');

  protected readonly recap = computed(() => ctaRecap(this.data()?.totals.byCta ?? []));
  protected readonly pages = computed(() => {
    const d = this.data();
    return d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.adminApi
      .founders({ status: this.status(), page: this.page() })
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.loadError.set(!r);
        if (!r) return;
        this.data.set(r.data);
        this.endsAtInput.set(r.data.offer.endsAt ? r.data.offer.endsAt.slice(0, 10) : '');
        this.changed.emit(r.data);
      });
  }

  protected filter(value: string): void {
    this.status.set(value ? (value as FounderSeatStatus) : null);
    this.page.set(1);
    this.load();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.load();
  }

  /** Ouvrir / fermer l'offre, après confirmation dans la page (aucune boîte navigateur). */
  protected applyToggle(): void {
    const d = this.data();
    if (!d) return;
    this.save({ open: !d.offer.open }, () => this.confirming.set(false));
  }

  protected saveEndsAt(): void {
    const v = this.endsAtInput();
    this.save({ endsAt: v ? new Date(`${v}T23:59:59`).toISOString() : null });
  }

  protected clearEndsAt(): void {
    this.endsAtInput.set('');
    this.save({ endsAt: null });
  }

  private save(dto: { open?: boolean; endsAt?: string | null }, done?: () => void): void {
    this.saving.set(true);
    this.actionError.set(null);
    this.adminApi
      .setFounderOffer(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          done?.();
          this.load();
        },
        error: () => {
          this.saving.set(false);
          this.actionError.set("La modification n'a pas été enregistrée. Réessaie.");
        },
      });
  }
}
