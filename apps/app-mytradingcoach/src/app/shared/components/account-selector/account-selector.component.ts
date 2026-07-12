import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Layers, Plus } from 'lucide-angular';
import { SelectedAccountStore } from '../../../core/stores/selected-account.store';
import { UserStore } from '../../../core/stores/user.store';
import { AccountType, TradingAccount } from '../../../core/api/accounts.api';
import { PlanModalComponent } from '../plan-modal/plan-modal.component';

// Sélecteur de compte réutilisable (dashboard, etc.). Pills « Tous les comptes » + 1 par
// compte (pastille de statut + tag + solde, fidèle à la maquette). Réservé Starter et +
// → sinon CTA upsell, aucun appel /accounts.
@Component({
  selector: 'mtc-account-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule, PlanModalComponent],
  templateUrl: './account-selector.component.html',
  styleUrl: './account-selector.component.css',
})
export class AccountSelectorComponent implements OnInit {
  protected readonly store = inject(SelectedAccountStore);
  protected readonly userStore = inject(UserStore);
  protected readonly showPlanModal = signal(false);

  protected readonly LayersIcon = Layers;
  protected readonly PlusIcon = Plus;

  /** Solde agrégé (comptes non archivés) — affiché sur la pill « Tous les comptes ». */
  protected readonly totalBalance = computed(() =>
    this.store
      .accounts()
      .filter((a) => a.status !== 'ARCHIVED')
      .reduce((s, a) => s + (a.metrics.currentBalance ?? 0), 0),
  );

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

  private typeLabel(t: AccountType): string {
    return t === 'EVALUATION' ? 'Éval' : t === 'FUNDED' ? 'Funded' : t === 'PERSONAL' ? 'Perso' : 'Démo';
  }

  /** Sous-titre de la pill : « Perso · Bybit » / « Éval · FTMO »… */
  protected tagFor(a: TradingAccount): string {
    return a.broker ? `${this.typeLabel(a.type)} · ${a.broker}` : this.typeLabel(a.type);
  }

  protected balanceFor(a: TradingAccount): string {
    return this.fmt(a.metrics.currentBalance ?? 0, a.currency);
  }

  protected totalBalanceStr(): string {
    return this.fmt(this.totalBalance(), this.store.accounts()[0]?.currency ?? 'USD');
  }

  private fmt(n: number, currency: string): string {
    const sym = currency === 'EUR' ? '€' : '$';
    return `${sym}${Math.round(n).toLocaleString('en-US')}`;
  }
}
