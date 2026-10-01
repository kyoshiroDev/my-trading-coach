import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { AdminApi, AcquisitionData } from '../../core/api/admin.api';

/** Inscrits et conversion Premium par source UTM (GET /admin/acquisition). */
@Component({
  selector: 'mtc-admin-acquisition',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './acquisition.component.css',
  templateUrl: './acquisition.component.html',
})
export class AcquisitionComponent {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = signal<AcquisitionData | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.api.acquisition().pipe(
      catchError((e: unknown) => { this.error.set(e instanceof Error ? e.message : 'Erreur de chargement'); return of(null); }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { if (r) this.data.set(r.data); });
  }
}
