import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { SelectedAccountStore } from '../../../core/stores/selected-account.store';
import { UserStore } from '../../../core/stores/user.store';
import { TradingAccount } from '../../../core/api/accounts.api';
import { PlanModalComponent } from '../plan-modal/plan-modal.component';

// Sélecteur de compte réutilisable (dashboard, etc.). Onglets « Tous les comptes » + 1 par
// compte avec pastille de statut. Réservé Starter et + → sinon CTA upsell, aucun appel /accounts.
@Component({
  selector: 'mtc-account-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlanModalComponent],
  templateUrl: './account-selector.component.html',
  styleUrl: './account-selector.component.css',
})
export class AccountSelectorComponent implements OnInit {
  protected readonly store = inject(SelectedAccountStore);
  protected readonly userStore = inject(UserStore);
  protected readonly showPlanModal = signal(false);

  ngOnInit(): void {
    // Charge les comptes si Starter et + (le store no-op pour les FREE).
    if (this.userStore.isStarterOrAbove() && !this.store.loaded() && !this.store.isLoading()) {
      this.store.load();
    }
  }

  /** Couleur de la pastille : vert actif · jaune évaluation en cours · rouge échec · gris archivé. */
  protected dotColor(a: TradingAccount): string {
    if (a.status === 'ARCHIVED') return 'var(--text-3)';
    if (a.status === 'FAILED') return 'var(--red)';
    if (a.status === 'PASSED') return 'var(--green)';
    return a.type === 'EVALUATION' ? 'var(--yellow)' : 'var(--green)';
  }
}
