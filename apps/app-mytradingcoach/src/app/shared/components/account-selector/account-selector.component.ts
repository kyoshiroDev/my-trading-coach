import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideLayers as Layers,
  LucidePlus as Plus,
  LucideCheck as Check,
  LucideChevronDown as ChevronDown,
} from '@lucide/angular';
import { SelectedAccountStore } from '../../../core/stores/selected-account.store';
import { AccountType, TradingAccount } from '../../../core/api/accounts.api';
import { CurrencyCode, formatMoney } from '../../../core/utils/money';

// Sélecteur de compte réutilisable (dashboard, etc.) : trigger compact affichant le compte
// courant (ou « Tous les comptes ») + menu déroulant listant tous les comptes. Largeur fixe,
// quel que soit le nombre de comptes (remplace la barre de pills qui débordait à 7+ comptes).
// Accessible à tous (FREE : 1 compte · Premium : illimité). Aucun gating ici, c'est côté API.
@Component({
  selector: 'mtc-account-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideDynamicIcon],
  templateUrl: './account-selector.component.html',
  styleUrl: './account-selector.component.css',
})
export class AccountSelectorComponent implements OnInit {
  protected readonly store = inject(SelectedAccountStore);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly LayersIcon = Layers;
  protected readonly PlusIcon = Plus;
  protected readonly CheckIcon = Check;
  protected readonly ChevronDownIcon = ChevronDown;

  /** État d'ouverture du menu déroulant. */
  protected readonly open = signal(false);
  protected toggle(): void {
    this.open.update((v) => !v);
  }
  protected close(): void {
    this.open.set(false);
  }

  /** Vrai quand la vue agrégée (« Tous les comptes ») est active. */
  protected readonly isAll = computed(() => this.store.selectedAccountId() === 'all');

  /** Sélectionne un compte (ou 'all') et referme le menu. */
  protected pick(id: string | 'all'): void {
    this.store.select(id);
    this.close();
  }

  /** Ferme le menu au clic hors du composant. */
  @HostListener('document:click', ['$event'])
  protected onDocClick(e: MouseEvent): void {
    if (!this.host.nativeElement.contains(e.target as Node)) this.close();
  }
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }

  /** Solde agrégé (comptes non archivés) : affiché sur l'option « Tous les comptes ». */
  protected readonly totalBalance = computed(() =>
    this.store
      .accounts()
      .filter((a) => a.status !== 'ARCHIVED')
      .reduce((s, a) => s + (a.metrics.currentBalance ?? 0), 0),
  );

  ngOnInit(): void {
    if (!this.store.loaded() && !this.store.isLoading()) {
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

  /** Sous-titre : « Perso · Bybit » / « Éval · FTMO »… */
  protected tagFor(a: TradingAccount): string {
    return a.broker ? `${this.typeLabel(a.type)} · ${a.broker}` : this.typeLabel(a.type);
  }

  protected balanceFor(a: TradingAccount): string {
    return this.fmt(a.metrics.currentBalance ?? 0, a.currency);
  }

  protected totalBalanceStr(): string {
    // Devise commune des comptes (null si mêlées : pas de symbole deviné).
    return this.fmt(this.totalBalance(), this.store.displayCurrency());
  }

  private fmt(n: number, currency: CurrencyCode): string {
    return formatMoney(n, currency, { decimals: 0, sign: false });
  }
}
