import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { excludedAccountsLine } from '@app/core/utils/account-status.util';

/**
 * Compte perdu, écran 5 : « 2 comptes exclus des chiffres : 1 échoué, 1 archivé. » et
 * l'interrupteur « Inclure les comptes échoués et archivés » (état partagé par le store : mêmes
 * chiffres sur le tableau de bord, les statistiques et le journal). Affiché seulement en « Tous
 * les comptes » et s'il existe un compte échoué ou archivé : un compte précis s'affiche toujours.
 */
@Component({
  selector: 'mtc-inactive-accounts-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-empty]': '!visible()' },
  templateUrl: './inactive-accounts-toggle.component.html',
  styleUrl: './inactive-accounts-toggle.component.css',
})
export class InactiveAccountsToggleComponent {
  protected readonly store = inject(SelectedAccountStore);

  protected readonly excludedTotal = computed(() => {
    const e = this.store.excludedAccounts();
    return e.failed + e.archived;
  });
  protected readonly visible = computed(
    () => this.store.selectedAccountId() === 'all' && this.excludedTotal() > 0,
  );
  protected readonly line = computed(() =>
    this.store.includeInactive() ? 'Aucun compte exclu.' : excludedAccountsLine(this.store.excludedAccounts()),
  );

  protected onToggle(e: Event): void {
    this.store.setIncludeInactive((e.target as HTMLInputElement).checked);
  }
}
