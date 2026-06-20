import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { AccountSelectorComponent } from '../../shared/components/account-selector/account-selector.component';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';
import {
  AccountType,
  AccountStatus,
  CreateAccountPayload,
  DrawdownType,
  TradingAccount,
  AccountsApi,
} from '../../core/api/accounts.api';

interface AccountFormState {
  label: string;
  type: AccountType;
  broker: string;
  currency: string;
  accountSize: number | null;
  startingBalance: number | null;
  profitTarget: number | null;
  maxDrawdown: number | null;
  drawdownType: DrawdownType;
  status: AccountStatus;
}

function emptyForm(): AccountFormState {
  return {
    label: '',
    type: 'EVALUATION',
    broker: '',
    currency: 'USD',
    accountSize: null,
    startingBalance: null,
    profitTarget: null,
    maxDrawdown: null,
    drawdownType: 'TRAILING',
    status: 'ACTIVE',
  };
}

// « Mes comptes » (PREMIUM) — CRUD des comptes + barres de règles prop firm
// ESTIMÉES d'après les trades loggés (objectif + marge drawdown), avec disclaimer obligatoire.
@Component({
  selector: 'mtc-accounts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, TopbarComponent, PlanModalComponent, AccountSelectorComponent],
  templateUrl: './accounts.component.html',
  styleUrl: './accounts.component.css',
})
export class AccountsComponent implements OnInit {
  protected readonly store = inject(SelectedAccountStore);
  protected readonly userStore = inject(UserStore);
  private readonly api = inject(AccountsApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly showPlanModal = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly menuOpenId = signal<string | null>(null);
  protected readonly form = signal<AccountFormState>(emptyForm());

  // ── Vue agrégée (tous comptes non archivés) ─────────────────────────────
  private readonly visibleAccounts = computed(() =>
    this.store.accounts().filter((a) => a.status !== 'ARCHIVED'),
  );
  protected readonly visibleAccountsCount = computed(() => this.visibleAccounts().length);
  protected readonly trackedCapital = computed(() =>
    this.visibleAccounts().reduce((s, a) => s + (a.metrics.startingBalance ?? 0), 0),
  );
  protected readonly totalPnl = computed(() =>
    this.visibleAccounts().reduce((s, a) => s + a.metrics.realizedPnl, 0),
  );
  protected readonly totalTrades = computed(() =>
    this.visibleAccounts().reduce((s, a) => s + a.metrics.tradesCount, 0),
  );
  // Comptes proches du drawdown (marge ≤ 25 % du max, ou dépassée) — à surveiller.
  protected readonly atRiskCount = computed(
    () =>
      this.visibleAccounts().filter((a) => {
        const dd = a.metrics.drawdown;
        return dd && (dd.breached || dd.pct <= 0.25);
      }).length,
  );

  // ── Quota par plan (Starter 3 · Premium illimité). null = illimité. ──────
  // Seuls les comptes non archivés comptent (visibleAccounts).
  protected readonly accountLimit = this.userStore.maxAccounts;
  protected readonly atLimit = computed(() => {
    const limit = this.accountLimit();
    return limit !== null && this.visibleAccountsCount() >= limit;
  });

  ngOnInit(): void {
    if (this.userStore.isStarterOrAbove() && !this.store.loaded() && !this.store.isLoading()) {
      this.store.load();
    }
  }

  // ── Helpers d'affichage ─────────────────────────────────────────────────
  protected typeIcon(t: AccountType): string {
    switch (t) {
      case 'FUNDED': return '🏦';
      case 'EVALUATION': return '🎯';
      case 'DEMO': return '🎮';
      default: return '🪙';
    }
  }
  protected typeLabel(t: AccountType): string {
    switch (t) {
      case 'FUNDED': return 'Funded';
      case 'EVALUATION': return 'Évaluation';
      case 'DEMO': return 'Démo';
      default: return 'Personnel';
    }
  }
  protected typeTagClass(t: AccountType): string {
    switch (t) {
      case 'FUNDED': return 'funded';
      case 'EVALUATION': return 'eval';
      default: return 'perso';
    }
  }
  protected statusLabel(s: AccountStatus): string {
    switch (s) {
      case 'PASSED': return 'Validé';
      case 'FAILED': return 'Échoué';
      case 'ARCHIVED': return 'Archivé';
      default: return 'Actif';
    }
  }
  protected dotColor(a: TradingAccount): string {
    if (a.status === 'ARCHIVED') return 'var(--text-3)';
    if (a.status === 'FAILED') return 'var(--red)';
    if (a.status === 'PASSED') return 'var(--green)';
    return a.type === 'EVALUATION' ? 'var(--yellow)' : 'var(--green)';
  }

  // Largeur de barre bornée à [0,100] (un objectif dépassé donne pct > 1 côté funded).
  private barWidth(pct: number | undefined): number {
    return Math.min(100, Math.max(0, Math.round((pct ?? 0) * 100)));
  }
  // Barre objectif : largeur = pct atteint (0..1) ; verte si atteint, sinon bleue.
  protected objWidth(a: TradingAccount): number {
    return this.barWidth(a.metrics.objective?.pct);
  }
  protected objReached(a: TradingAccount): boolean {
    return (a.metrics.objective?.pct ?? 0) >= 1;
  }
  // Barre marge drawdown : largeur = marge restante (pct du max) ; rouge si dépassé/critique.
  protected ddWidth(a: TradingAccount): number {
    return this.barWidth(a.metrics.drawdown?.pct);
  }
  protected ddColor(a: TradingAccount): string {
    const dd = a.metrics.drawdown;
    if (!dd) return 'var(--blue)';
    if (dd.breached || dd.pct <= 0.25) return 'var(--red)';
    if (dd.pct <= 0.5) return 'var(--yellow)';
    return 'var(--green)';
  }

  protected isPropFirm(t: AccountType): boolean {
    return t === 'EVALUATION' || t === 'FUNDED';
  }

  // ── Menu carte ──────────────────────────────────────────────────────────
  protected toggleMenu(id: string): void {
    this.menuOpenId.update((cur) => (cur === id ? null : id));
  }

  // ── Formulaire create / edit ────────────────────────────────────────────
  protected openCreate(): void {
    // Quota du plan atteint → on propose l'upgrade au lieu d'ouvrir le formulaire.
    if (this.atLimit()) {
      this.showPlanModal.set(true);
      return;
    }
    this.editingId.set(null);
    this.form.set(emptyForm());
    this.menuOpenId.set(null);
    this.formOpen.set(true);
  }
  protected openEdit(a: TradingAccount): void {
    this.editingId.set(a.id);
    this.form.set({
      label: a.label,
      type: a.type,
      broker: a.broker ?? '',
      currency: a.currency,
      accountSize: a.accountSize,
      startingBalance: a.startingBalance,
      profitTarget: a.profitTarget,
      maxDrawdown: a.maxDrawdown,
      drawdownType: a.drawdownType,
      status: a.status,
    });
    this.menuOpenId.set(null);
    this.formOpen.set(true);
  }
  protected closeForm(): void {
    this.formOpen.set(false);
  }

  protected patch(p: Partial<AccountFormState>): void {
    this.form.update((f) => ({ ...f, ...p }));
  }

  protected canSubmit(): boolean {
    // En création, on respecte le quota (belt-and-suspenders avec openCreate).
    if (!this.editingId() && this.atLimit()) return false;
    return this.form().label.trim().length > 0 && !this.saving();
  }

  protected submitForm(): void {
    if (!this.canSubmit()) return;
    const f = this.form();
    const propFirm = this.isPropFirm(f.type);
    const payload: CreateAccountPayload = {
      label: f.label.trim(),
      type: f.type,
      broker: propFirm ? (f.broker.trim() || null) : null,
      currency: f.currency.trim() || 'USD',
      accountSize: f.accountSize,
      startingBalance: f.startingBalance,
      profitTarget: propFirm ? f.profitTarget : null,
      maxDrawdown: propFirm ? f.maxDrawdown : null,
      drawdownType: f.drawdownType,
    };
    this.saving.set(true);
    const id = this.editingId();
    const req$ = id
      ? this.api.update(id, { ...payload, status: f.status })
      : this.api.create(payload);
    req$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.store.load(); // recharge la liste + métriques
      },
      error: () => this.saving.set(false),
    });
  }

  // ── Suppression / archivage ──────────────────────────────────────────────
  protected confirmDelete(a: TradingAccount): void {
    this.menuOpenId.set(null);
    const msg =
      `Supprimer « ${a.label} » ? Les trades et sessions rattachés ne sont pas supprimés ` +
      `mais perdent leur compte. Un compte avec historique est archivé plutôt que supprimé.`;
    if (!confirm(msg)) return;
    this.api
      .remove(a.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.store.load() });
  }
}
