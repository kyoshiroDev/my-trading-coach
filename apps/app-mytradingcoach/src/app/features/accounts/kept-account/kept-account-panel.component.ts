import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SelectedAccountStore } from '../../../core/stores/selected-account.store';
import { AccountsApi } from '../../../core/api/accounts.api';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Choix du compte gardé actif en gratuit (#769), en haut de Mes comptes : affiché seulement quand
 * l'API signale des comptes au-delà du quota gratuit (fin d'essai ou d'abonnement). Rien n'est
 * supprimé ni masqué : les autres comptes restent visibles avec leur historique.
 */
@Component({
  selector: 'mtc-kept-account-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-empty]': '!visible()' },
  templateUrl: './kept-account-panel.component.html',
  styleUrl: './kept-account-panel.component.css',
})
export class KeptAccountPanelComponent {
  private readonly store = inject(SelectedAccountStore);
  private readonly api = inject(AccountsApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly active = computed(() => this.store.accounts().filter((a) => a.status === 'ACTIVE'));
  protected readonly visible = computed(() => this.active().some((a) => a.overFreeLimit));
  /** Compte gardé selon l'API : le compte actif qui n'est pas en trop. */
  protected readonly kept = computed(() => this.active().find((a) => !a.overFreeLimit)?.id ?? null);
  private readonly picked = signal<string | null>(null);
  protected readonly selected = computed(() => this.picked() ?? this.kept());
  protected readonly saving = signal(false);

  protected pick(id: string): void {
    this.picked.set(id);
  }

  protected save(): void {
    const id = this.selected();
    if (!id || id === this.kept() || this.saving()) return;
    this.saving.set(true);
    this.api
      .keep(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.picked.set(null);
          this.toast.success('Compte gardé enregistré');
          this.store.load();
        },
        error: () => {
          this.saving.set(false);
          this.toast.error('Le choix n’a pas pu être enregistré, réessaie dans un instant');
        },
      });
  }
}
