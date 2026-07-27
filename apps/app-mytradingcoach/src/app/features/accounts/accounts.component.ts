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
import {
  LucideAngularModule,
  User, Target, Building2, FlaskConical,
  Wallet, TrendingUp, List, Eye, Layers,
  ClipboardList, MoreHorizontal, Info, Plus, Lock,
  Pencil, Trash2, X, Briefcase,
} from 'lucide-angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
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
  imports: [DecimalPipe, FormsModule, LucideAngularModule, TopbarComponent, PlanModalComponent],
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

  // ── Vue agrégée (source des KPI), scopée par la sélection du topbar ──────
  // null = « Tous les comptes » → tous (non archivés) ; sinon le seul compte choisi.
  protected readonly visibleAccounts = computed(() => {
    const sel = this.store.selectedAccountId();
    const base = this.store.accounts().filter((a) => a.status !== 'ARCHIVED');
    return sel === 'all' ? base : base.filter((a) => a.id === sel);
  });
  // Cartes affichées dans la grille : toutes, ou la seule sélectionnée.
  protected readonly displayedAccounts = computed(() => {
    const sel = this.store.selectedAccountId();
    const all = this.store.accounts();
    return sel === 'all' ? all : all.filter((a) => a.id === sel);
  });
  // Nom du compte sélectionné (sous-libellé KPI P&L), null en vue « Tous les comptes ».
  protected readonly selectedAccountName = computed(() => {
    const sel = this.store.selectedAccountId();
    return sel === 'all' ? null : (this.store.accounts().find((a) => a.id === sel)?.label ?? null);
  });
  // Quota : seuls les comptes ACTIVE consomment un slot (aligné backend). PASSED /
  // FAILED / ARCHIVED le libèrent → c'est ce count qu'on affiche et qui borne le quota.
  protected readonly activeAccountsCount = computed(
    () => this.store.accounts().filter((a) => a.status === 'ACTIVE').length,
  );
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
  // Au moins un compte prop firm (éval / funded) → affiche la note disclaimer globale unique.
  protected readonly hasPropAccount = computed(() =>
    this.store.accounts().some((a) => a.type === 'EVALUATION' || a.type === 'FUNDED'),
  );

  // ── Quota par plan (FREE 1 · Premium illimité). null = illimité. ──────────
  // Seuls les comptes ACTIVE consomment le quota (aligné backend).
  protected readonly accountLimit = this.userStore.maxAccounts;
  protected readonly atLimit = computed(() => {
    const limit = this.accountLimit();
    return limit !== null && this.activeAccountsCount() >= limit;
  });

  ngOnInit(): void {
    if (!this.store.loaded() && !this.store.isLoading()) {
      this.store.load();
    }
  }

  // ── Icônes lucide ────────────────────────────────────────────────────────
  protected readonly UserIcon = User;
  protected readonly TargetIcon = Target;
  protected readonly Building2Icon = Building2;
  protected readonly FlaskIcon = FlaskConical;
  protected readonly WalletIcon = Wallet;
  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly ListIcon = List;
  protected readonly EyeIcon = Eye;
  protected readonly LayersIcon = Layers;
  protected readonly ClipboardListIcon = ClipboardList;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly InfoIcon = Info;
  protected readonly PlusIcon = Plus;
  protected readonly LockIcon = Lock;
  protected readonly PencilIcon = Pencil;
  protected readonly TrashIcon = Trash2;
  protected readonly XIcon = X;
  protected readonly BriefcaseIcon = Briefcase;

  // ── Helpers d'affichage ─────────────────────────────────────────────────
  // Icône lucide selon le type de compte.
  protected typeIcon(t: AccountType) {
    switch (t) {
      case 'FUNDED': return this.Building2Icon;
      case 'EVALUATION': return this.TargetIcon;
      case 'DEMO': return this.FlaskIcon;
      default: return this.UserIcon;
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

  // Objectif en % (pastille). FUNDED → objectif "payout", éval/passed → objectif d'éval.
  protected objPct(a: TradingAccount): number {
    return Math.round((a.metrics.objective?.pct ?? 0) * 100);
  }
  protected objLabel(a: TradingAccount): string {
    return a.type === 'FUNDED' ? 'Objectif payout' : 'Objectif';
  }

  // Couleur d'accent stable par compte (identité visuelle, pas l'état). Perso → vert ;
  // sinon dérivée d'un hash du broker/label (même firm = même couleur, stable au reorder).
  private readonly ACCENT_VARS = ['--blue', '--yellow', '--purple', '--cyan', '--green', '--red', '--blue-bright'];
  protected accentVar(a: TradingAccount): string {
    if (a.type === 'PERSONAL') return 'var(--green)';
    const key = a.broker ?? a.label ?? a.id;
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return `var(${this.ACCENT_VARS[h % this.ACCENT_VARS.length]})`;
  }

  // ── Bloc « Activité » carte perso (métriques du 126, dégradation propre si absentes) ──
  // Groupe milliers en fr-FR, comme DecimalPipe '1.0-0'.
  private fmt0(n: number): string {
    return Math.round(n).toLocaleString('fr-FR');
  }
  protected bestDayLabel(a: TradingAccount): string {
    const v = a.metrics.bestDay;
    return v == null ? '—' : `${v > 0 ? '+' : ''}${this.fmt0(v)} $`;
  }
  protected worstDayLabel(a: TradingAccount): string {
    const v = a.metrics.worstDay;
    return v == null ? '—' : `${this.fmt0(v)} $`;
  }
  protected winRateLabel(a: TradingAccount): string {
    const v = a.metrics.winRate;
    return v == null ? '—' : `${this.fmt0(v * 100)} %`;
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
