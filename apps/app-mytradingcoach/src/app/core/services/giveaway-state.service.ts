import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import type { GiveawayAppState } from '@mtc/shared';
import { GiveawayApi } from '../api/giveaway.api';
import { UserScopedReset } from '../auth/user-scoped-reset';

/**
 * État du tirage mensuel partagé par la barre latérale (entrée « Concours du mois » dès qu'un tirage
 * est allumé) et la page. Une erreur de chargement laisse la navigation comme avant (Score trader).
 */
@Injectable({ providedIn: 'root' })
export class GiveawayStateService {
  private readonly api = inject(GiveawayApi);

  readonly state = signal<GiveawayAppState | null>(null);
  readonly loadError = signal(false);
  readonly loading = signal(false);
  /** Au moins un tirage allumé (ou compte démo) : l'entrée « Score trader » devient « Concours du mois ». */
  readonly enabled = computed(() => this.state()?.enabled ?? false);

  constructor() {
    inject(UserScopedReset).register(() => this.reset());
  }

  load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.api
      .state()
      .pipe(catchError(() => of(null)))
      .subscribe((r) => {
        this.loading.set(false);
        this.loadError.set(!r);
        if (r) this.state.set(r.data);
      });
  }

  /** Remise à zéro à la déconnexion (aucun état d'un autre compte gardé). */
  reset(): void {
    this.state.set(null);
    this.loadError.set(false);
  }
}
