import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideUser as User,
  LucideTarget as Target,
  LucideBuilding2 as Building2,
  LucideFlaskConical as FlaskConical,
  LucideWallet as Wallet,
  LucideTrendingUp as TrendingUp,
  LucideList as List,
  LucideEye as Eye,
  LucideLayers as Layers,
  LucideMoreHorizontal as MoreHorizontal,
  LucideInfo as Info,
  LucideLock as Lock,
  LucideChevronDown as ChevronDown,
  LucideUnlink as Unlink,
  LucidePencil as Pencil,
  LucideTrash2 as Trash2,
  LucideX as X,
  LucideBriefcase as Briefcase,
  LucideAlertCircle as AlertCircle,
  LucideLink2 as Link2,
  LucideRefreshCw as RefreshCw,
  LucideBadgeCheck as BadgeCheck,
} from '@lucide/angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { TradovateConnectModalComponent } from '../../shared/components/tradovate-connect/tradovate-connect-modal.component';
import { TradovateAccountPickerComponent } from '../../shared/components/tradovate-connect/tradovate-account-picker.component';
import { TradovateStore } from '../../core/stores/tradovate.store';
import { TradesStore } from '../../core/stores/trades.store';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/api-error';
import { TradovateApi, type TradovateSyncResult } from '../../core/api/tradovate.api';
import { catchError, forkJoin, of } from 'rxjs';
import {
  TRADOVATE_RETURN_PARAMS,
  excludedAccountsMessage,
  feesLine,
  parseTradovateReturn,
  relativeTime,
  tradesLine,
  tradovateErrorMessage,
} from '../../core/utils/tradovate-return.util';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';
import { ACCOUNT_CURRENCIES, commonCurrency, formatMoney, matchPlans } from '@mtc/shared';
import {
  AccountType,
  AccountStatus,
  CreateAccountPayload,
  DrawdownType,
  TradingAccount,
  AccountsApi,
} from '../../core/api/accounts.api';
import { ConfirmService, DialogDirective } from '@mtc/front-ui';
import { PropFirmsApi, type PropFirmCatalogFirm, type PropFirmPlanDetail } from '../../core/api/prop-firms.api';
import { PropFirmRulesComponent } from './prop-firm-rules/prop-firm-rules.component';
import type { PropFirmPlanSummary } from '@mtc/shared';
import {
  OTHER_FIRM,
  PropFirmPlanPickerComponent,
  type FirmChoice,
} from './prop-firm-plan-picker/prop-firm-plan-picker.component';
import { findPlan, platformLabel, rulesFromPlan } from './prop-firm-plan-picker/prop-firm-plans.util';
import { progressTitle, requirementLabel } from './account-progress.util';
import { assignBrokerTones, brokerBadge } from './broker-badge.util';

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
  propFirmPlanId: string | null;
  platform: string | null;
  /** `AAAA-MM-JJ` (champ date), null = aucun payout reçu. */
  lastPayoutAt: string | null;
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
    propFirmPlanId: null,
    platform: null,
    lastPayoutAt: null,
  };
}

const DISMISSED_LINKS_KEY = 'mtc.accounts.planLinkDismissed';

function readDismissedLinks(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DISMISSED_LINKS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// « Mes comptes » (PREMIUM) : CRUD des comptes + barres de règles prop firm
// ESTIMÉES d'après les trades loggés (objectif + marge drawdown), avec disclaimer obligatoire.
@Component({
  selector: 'mtc-accounts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DialogDirective,
    DecimalPipe, FormsModule, LucideDynamicIcon, TopbarComponent, PlanModalComponent,
    TradovateConnectModalComponent, TradovateAccountPickerComponent, PropFirmPlanPickerComponent,
    PropFirmRulesComponent,
  ],
  templateUrl: './accounts.component.html',
  styleUrl: './accounts.component.css',
})
export class AccountsComponent implements OnInit {
  protected readonly store = inject(SelectedAccountStore);
  protected readonly userStore = inject(UserStore);
  private readonly api = inject(AccountsApi);
  private readonly propFirmsApi = inject(PropFirmsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly tradesStore = inject(TradesStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  // ── Connexion Tradovate par compte ──────────────────────────
  protected readonly tv = inject(TradovateStore);
  /** Compte pour lequel l'écran de réassurance est ouvert. */
  protected readonly connectTarget = signal<{ id: string; label: string } | null>(null);
  /** Déconnexion en attente de confirmation (clé, pas l'objet : cf. angular.md). */
  protected readonly confirmDisconnectId = signal<string | null>(null);
  protected readonly relativeTime = relativeTime;

  protected readonly showPlanModal = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly menuOpenId = signal<string | null>(null);
  /**
   * Ligne dépliée (mobile) : en desktop les 8 colonnes tiennent à l'écran, en mobile
   * seules les colonnes vitales restent visibles et le reste s'ouvre ici. Un seul
   * dépli à la fois, la clé plutôt que l'objet (cf. angular.md).
   */
  protected readonly expandedId = signal<string | null>(null);
  protected readonly form = signal<AccountFormState>(emptyForm());
  /** Catalogue prop firm, null tant qu'il n'est pas chargé. */
  protected readonly catalog = signal<PropFirmCatalogFirm[] | null>(null);
  private catalogLoading = false;
  /** Choix de firm du sélecteur : id du catalogue, `other` (saisie libre) ou ''. */
  protected readonly firmChoice = signal<FirmChoice>('');
  protected readonly OTHER_FIRM = OTHER_FIRM;
  /** Pastille initiales + couleur de la prop firm (null si `broker` vide). */
  protected readonly brokerBadge = brokerBadge;
  /**
   * Couleur DISTINCTE par prop firm dans cette liste (assignBrokerTones). Ordre d'ancienneté :
   * en cas de conflit, la firm dont le premier compte est le plus ancien garde sa couleur, donc
   * ajouter un compte d'une nouvelle firm ne recolore jamais les autres. Un compte prop firm sans
   * firm saisie est identifié par son libellé.
   */
  protected readonly brokerTones = computed(() =>
    assignBrokerTones(
      [...this.store.accounts()]
        .filter((a) => a.type !== 'PERSONAL')
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
        .map((a) => a.broker || a.label),
    ),
  );
  /** Comptes dont l'utilisateur a écarté la proposition de plan (ce navigateur seulement). */
  private readonly dismissedLinks = signal<string[]>(readDismissedLinks());
  /**
   * Comptes prop firm saisis avant le catalogue, dont la firm y figure : on propose de les relier
   * à leur plan (id du compte → nom de la firm). L'API relie seule ceux qu'un plan unique désigne ;
   * pour les autres, plusieurs programmes partagent les mêmes règles et seul l'utilisateur sait
   * lequel il a acheté.
   */
  protected readonly linkSuggestions = computed(() => {
    const catalog = this.catalog();
    const out = new Map<string, string>();
    if (!catalog?.length) return out;
    const dismissed = this.dismissedLinks();
    for (const a of this.store.accounts()) {
      if (a.propFirmPlanId || a.status === 'ARCHIVED' || dismissed.includes(a.id)) continue;
      const match = matchPlans(catalog, a);
      if (match?.plans.length) out.set(a.id, match.firm.name);
    }
    return out;
  });
  /** Règles complètes des plans reliés, chargées au premier dépli d'un compte (par id de plan). */
  protected readonly planRules = signal<Record<string, PropFirmPlanDetail | 'loading' | 'error'>>({});

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
  /**
   * Échec de suppression (règle métier du back). Sans lui, un 400 ne produisait
   * strictement RIEN à l'écran : le compte restait dans la liste, sans explication.
   * Retour Val : « je rafraîchis la page il est toujours dessus c'est normal ? ».
   */
  protected readonly deleteError = signal<string | null>(null);

  /**
   * Suppression vouée à échouer : dernier compte ACTIVE ET porteur d'historique.
   * Sous-ensemble VOLONTAIREMENT conservateur de la règle back (`accounts.service.remove`),
   * qui compte aussi les sessions — invisibles depuis le front. On ne désactive donc que
   * les cas certains : jamais on ne bloque une suppression que le back accepterait.
   * Le reste (compte sans trade mais avec sessions) part, échoue, et `deleteError`
   * l'explique. Le back reste la seule autorité.
   */
  protected readonly suppressionBloquee = (a: TradingAccount): boolean =>
    a.status === 'ACTIVE' &&
    this.activeAccountsCount() <= 1 &&
    (a.metrics?.tradesCount ?? 0) > 0;

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

  // ── Devise : propriété DU COMPTE, jamais convertie ──────────
  protected readonly accountCurrencies = ACCOUNT_CURRENCIES;
  /** Devise des totaux (capital suivi, P&L cumulé) ; null si les comptes affichés en ont plusieurs. */
  protected readonly totalsCurrency = computed(() =>
    commonCurrency(this.visibleAccounts().map((a) => a.currency)),
  );
  /**
   * Plateformes du plan choisi dont le verrouillage du drawdown diffère (Apex : Rithmic,
   * Tradovate, Wealthcharts). Vide → pas de choix à proposer. Un compte connecté via Tradovate
   * n'en a pas besoin : la plateforme est connue.
   */
  protected readonly formPlatformChoices = computed(() => {
    if (this.formSynced()) return [];
    const sel = findPlan(this.catalog() ?? [], this.form().propFirmPlanId);
    return sel?.plan.platformDependent ?? [];
  });
  protected readonly platformLabel = platformLabel;
  protected readonly progressTitle = progressTitle;
  protected readonly requirementLabel = requirementLabel;

  /** `2026-10-01` → « 01/10 » (date de séance, sans fuseau : c'est une date, pas un instant). */
  protected sessionDate(day: string | null): string {
    return day ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : '';
  }
  /** « Rithmic, Tradovate, Wealthcharts » */
  protected platformList(keys: readonly string[]): string {
    return keys.map(platformLabel).join(', ');
  }

  /** Compte synchronisé en édition : sa devise vient du broker, non modifiable. */
  protected readonly formSynced = computed(() => {
    const id = this.editingId();
    return !!id && this.tv.byAccount().has(id);
  });
  /** Montant dans la devise donnée (celle du compte), sans conversion. */
  protected money(value: number | null | undefined, currency: string | null, sign = false): string {
    return formatMoney(value ?? 0, currency, { decimals: 0, sign });
  }
  // Comptes proches du drawdown (marge ≤ 25 % du max, ou dépassée) : à surveiller.
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

  private readonly tradovateApi = inject(TradovateApi);
  /** Comptes dont le solde broker est en cours de relecture (bouton « Actualiser »). */
  protected readonly balanceBusy = signal<ReadonlySet<string>>(new Set());
  private brokerRefreshed = false;

  /**
   * Relit solde et equity chez le broker pour les comptes connectés, puis recharge la liste.
   * À l'ouverture de la page et sur « Actualiser » seulement : jamais en boucle (le serveur bride
   * en plus à 20 s par compte). Le temps réel, lui, arrive par le WebSocket (`tradovate:balance`).
   */
  protected refreshBrokerBalances(accountIds?: string[]): void {
    if (this.userStore.isDemo()) return;
    const ids = (accountIds ?? this.tv.connections()
      .filter((c) => c.status === 'CONNECTED' && c.externalAccountId && !c.needsAccountSelection)
      .map((c) => c.accountId));
    if (ids.length === 0) return;
    this.balanceBusy.update((s) => new Set([...s, ...ids]));
    forkJoin(ids.map((id) => this.tradovateApi.refreshBalance(id).pipe(catchError(() => of(null)))))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.balanceBusy.update((s) => new Set([...s].filter((id) => !ids.includes(id))));
        this.store.load();
      });
  }

  /** Relevé broker affiché : « il y a 2 min », sur la date la plus récente (equity ou solde). */
  protected brokerAge(b: NonNullable<TradingAccount['metrics']['broker']>): string {
    const at = [b.equityAt, b.balanceAt].filter((x): x is string => !!x).sort().at(-1) ?? null;
    return relativeTime(at);
  }

  constructor() {
    // Une fois les connexions connues : solde et equity à jour pour chaque compte connecté.
    effect(() => {
      if (!this.tv.loaded() || this.brokerRefreshed) return;
      this.brokerRefreshed = true;
      untracked(() => this.refreshBrokerBalances());
    });
    // Changement de vue (sélecteur de compte) : le message ne décrit plus la liste
    // affichée, on le retire. `untracked` pour ne pas se réveiller sur sa propre écriture.
    effect(() => {
      this.store.selectedAccountId();
      untracked(() => this.deleteError.set(null));
    });
    // Un compte prop firm sans plan : le catalogue sert à lui proposer le sien.
    effect(() => {
      if (this.store.accounts().some((a) => this.isPropFirm(a.type) && !a.propFirmPlanId)) {
        untracked(() => this.loadCatalog());
      }
    });
  }

  ngOnInit(): void {
    if (!this.store.loaded() && !this.store.isLoading()) {
      this.store.load();
    }
    this.tv.load();
    this.readTradovateReturn();
  }

  /**
   * Retour du consentement Tradovate lancé depuis cette page (`/accounts?tradovate=…`).
   * Le retour « wizard » est lu par l'onboarding, pas ici. Les paramètres sont retirés de
   * l'URL aussitôt lus : un rechargement ne rejoue pas le message.
   */
  private readTradovateReturn(): void {
    const ret = parseTradovateReturn(
      this.router.routerState.snapshot.root.queryParams as Record<string, string>,
    );
    if (!ret || ret.fromWizard) return;

    // Retour ponctuel → toasts. L'état durable (pilule, sélecteur de compte,
    // « à reconnecter ») vit dans la carte du compte.
    if (ret.status === 'error') {
      this.toast.error(tradovateErrorMessage(ret.reason, false));
    } else if (ret.status === 'select_account') {
      this.toast.info('Compte Tradovate connecté : confirme ci-dessous le compte à synchroniser.');
    } else if (ret.syncFailed) {
      this.toast.warning("Compte Tradovate connecté, mais la première synchronisation n'a pas abouti : relance-la avec « Synchroniser ».");
    } else {
      this.toast.success(`Compte connecté · ${tradesLine(ret.trades ?? 0)}`);
      const fees = feesLine(ret.fees);
      if (fees) this.toast.warning(fees.text);
      if ((ret.trades ?? 0) > 0) this.refreshAfterImport();
    }

    const excluded = excludedAccountsMessage(ret.excluded);
    if (excluded) this.toast.warning(excluded);

    const cleared = Object.fromEntries(TRADOVATE_RETURN_PARAMS.map((k) => [k, null]));
    // Commandes vides : même chemin, seuls les paramètres Tradovate disparaissent.
    this.router.navigate([], {
      queryParams: cleared,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected openTradovateConnect(a: TradingAccount): void {
    this.connectTarget.set({ id: a.id, label: a.label });
  }

  protected syncTradovate(a: TradingAccount): void {
    this.tv.sync(a.id, (r) => this.onSynced(r));
  }

  protected pickTradovateAccount(a: TradingAccount, externalId: string): void {
    this.tv.selectThenSync(a.id, externalId, (r) => this.onSynced(r));
  }

  protected askDisconnect(a: TradingAccount): void {
    this.confirmDisconnectId.set(a.id);
  }

  /** `deleteTrades` : supprime aussi les trades importés par Tradovate (jamais manuels ni CSV). */
  protected confirmDisconnect(a: TradingAccount, deleteTrades = false): void {
    this.confirmDisconnectId.set(null);
    this.tv.disconnect(a.id, { deleteTrades }, (deleted) => {
      if (deleted) this.refreshAfterImport();
    });
  }

  /** « 12 trades importés » : nombre affiché AVANT de proposer la suppression. */
  protected brokerTradesLabel(n: number): string {
    const s = n > 1 ? 's' : '';
    return `${n} trade${s} importé${s}`;
  }

  private onSynced(r: TradovateSyncResult | null): void {
    if (r && r.created > 0) this.refreshAfterImport();
  }

  /** Trades ajoutés ou supprimés : métriques des comptes et journal/dashboard repartent du serveur. */
  private refreshAfterImport(): void {
    this.store.load();
    this.tradesStore.reset();
  }

  // ── Icônes lucide ────────────────────────────────────────────────────────
  protected readonly AlertCircleIcon = AlertCircle;
  protected readonly UserIcon = User;
  protected readonly TargetIcon = Target;
  protected readonly Building2Icon = Building2;
  protected readonly FlaskIcon = FlaskConical;
  protected readonly WalletIcon = Wallet;
  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly ListIcon = List;
  protected readonly EyeIcon = Eye;
  protected readonly LayersIcon = Layers;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly InfoIcon = Info;
  protected readonly LockIcon = Lock;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly UnlinkIcon = Unlink;
  protected readonly PencilIcon = Pencil;
  protected readonly TrashIcon = Trash2;
  protected readonly XIcon = X;
  protected readonly BriefcaseIcon = Briefcase;
  protected readonly LinkIcon = Link2;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly BadgeCheckIcon = BadgeCheck;

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

  // Couleur d'accent du compte (liseré, icône, tag firm, sous-lignes du dépli) = couleur de la
  // pastille de sa prop firm : une firm a UNE couleur partout, quel que soit le compte. Perso → vert ;
  // compte prop firm sans firm saisie → même palette, dérivée du libellé (stable au reorder).
  protected accentVar(a: TradingAccount): string {
    if (a.type === 'PERSONAL') return 'var(--green)';
    return brokerBadge(a.broker || a.label, this.brokerTones())?.color ?? 'var(--blue)';
  }

  // ── Bloc « Activité » carte perso (métriques du 126, dégradation propre si absentes) ──
  // Groupe milliers en fr-FR, comme DecimalPipe '1.0-0'.
  private fmt0(n: number): string {
    return Math.round(n).toLocaleString('fr-FR');
  }
  protected bestDayLabel(a: TradingAccount): string {
    const v = a.metrics.bestDay;
    return v == null ? '-' : `${v > 0 ? '+' : ''}${this.fmt0(v)} $`;
  }
  protected worstDayLabel(a: TradingAccount): string {
    const v = a.metrics.worstDay;
    return v == null ? '-' : `${this.fmt0(v)} $`;
  }
  protected winRateLabel(a: TradingAccount): string {
    const v = a.metrics.winRate;
    return v == null ? '-' : `${this.fmt0(v * 100)} %`;
  }

  /** Libellé de la colonne marge : « trailing » n'est affiché que s'il s'applique. */
  protected phaseLabel(phase: 'evaluation' | 'funded' | 'direct'): string {
    return phase === 'evaluation' ? 'évaluation' : phase === 'funded' ? 'compte funded' : 'compte funded direct';
  }
  protected ddLabel(a: TradingAccount): string {
    return a.metrics.drawdown?.type === 'TRAILING' ? 'Marge trailing drawdown' : 'Marge drawdown';
  }

  // ── Ligne dépliable (mobile) ────────────────────────────────────────────
  protected toggleExpand(id: string): void {
    this.expandedId.update((cur) => (cur === id ? null : id));
    const planId = this.store.accounts().find((a) => a.id === id)?.propFirmPlanId;
    if (this.expandedId() === id && planId) this.loadPlanRules(planId);
  }

  // ── Menu ligne ──────────────────────────────────────────────────────────
  protected toggleMenu(id: string): void {
    // Une nouvelle interaction efface le message : sinon il traîne indéfiniment sous
    // une liste qui a pu changer entre-temps, et ne décrit plus rien.
    this.deleteError.set(null);
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
    this.firmChoice.set('');
    this.loadCatalog();
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
      propFirmPlanId: a.propFirmPlanId,
      platform: a.platform,
      lastPayoutAt: a.lastPayoutAt ? a.lastPayoutAt.slice(0, 10) : null,
    });
    this.firmChoice.set(this.startFirmOf(a));
    this.loadCatalog();
    this.menuOpenId.set(null);
    this.formOpen.set(true);
  }
  /** Firm sur laquelle ouvrir le sélecteur d'un compte sans plan : celle du catalogue qu'il désigne, sinon « Autre ». */
  private startFirmOf(a: TradingAccount): FirmChoice {
    if (a.propFirmPlanId) return '';
    const firm = matchPlans(this.catalog() ?? [], a)?.firm;
    return firm ? firm.id : a.broker ? OTHER_FIRM : '';
  }

  protected dismissLinkSuggestion(id: string): void {
    this.dismissedLinks.update((ids) => [...ids, id]);
    try {
      localStorage.setItem(DISMISSED_LINKS_KEY, JSON.stringify(this.dismissedLinks()));
    } catch {
      // Stockage indisponible (navigation privée) : la proposition reviendra au prochain chargement.
    }
  }

  protected closeForm(): void {
    this.formOpen.set(false);
  }

  protected patch(p: Partial<AccountFormState>): void {
    this.form.update((f) => ({ ...f, ...p }));
  }

  /** Règles du plan relié : un appel par plan, réessayé au dépli suivant en cas d'échec. */
  private loadPlanRules(planId: string): void {
    const cur = this.planRules()[planId];
    if (cur && cur !== 'error') return;
    this.planRules.update((m) => ({ ...m, [planId]: 'loading' }));
    this.propFirmsApi
      .getPlan(planId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.planRules.update((m) => ({ ...m, [planId]: res.data })),
        error: () => this.planRules.update((m) => ({ ...m, [planId]: 'error' })),
      });
  }

  protected rulesOf(planId: string): PropFirmPlanDetail | 'loading' | 'error' | undefined {
    return this.planRules()[planId];
  }

  protected isPlanDetail(v: PropFirmPlanDetail | 'loading' | 'error' | undefined): v is PropFirmPlanDetail {
    return typeof v === 'object';
  }

  // ── Catalogue prop firm (choix du plan) ─────────────────────────────────
  /** Chargé à la première ouverture du formulaire ; [] si l'appel échoue (saisie libre seule). */
  private loadCatalog(): void {
    if (this.catalog() !== null || this.catalogLoading) return;
    this.catalogLoading = true;
    this.propFirmsApi
      .getCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.catalog.set(res.data),
        error: () => this.catalog.set([]),
        complete: () => (this.catalogLoading = false),
      });
  }

  protected onFirmChoice(choice: FirmChoice): void {
    this.firmChoice.set(choice);
    const firm = this.catalog()?.find((f) => f.id === choice);
    this.patch({ broker: firm ? firm.name : '', propFirmPlanId: null });
  }

  /** Plan choisi : relie le compte et pré-remplit ses règles (toujours modifiables). */
  protected onPlanChoice(plan: PropFirmPlanSummary | null): void {
    if (!plan) {
      this.patch({ propFirmPlanId: null });
      return;
    }
    const f = this.form();
    const rules = rulesFromPlan(plan, f.type);
    this.patch({
      propFirmPlanId: plan.id,
      accountSize: rules.accountSize,
      startingBalance: rules.startingBalance,
      currency: this.formSynced() ? f.currency : rules.currency,
      profitTarget: rules.profitTarget,
      maxDrawdown: rules.maxDrawdown,
      drawdownType: rules.drawdownType ?? f.drawdownType,
    });
  }

  /** Changer évaluation ↔ funded avec un plan choisi : les règles suivent la phase. */
  protected onTypeChange(type: AccountType): void {
    this.patch({ type });
    const sel = findPlan(this.catalog() ?? [], this.form().propFirmPlanId);
    if (sel && this.isPropFirm(type)) this.onPlanChoice(sel.plan);
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
      propFirmPlanId: propFirm ? f.propFirmPlanId : null,
      platform: propFirm && f.propFirmPlanId ? f.platform : null,
      // Le cycle de payout ne concerne qu'un compte funded relié à un plan.
      lastPayoutAt: f.type === 'FUNDED' && f.propFirmPlanId ? f.lastPayoutAt || null : null,
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
        this.toast.success(id ? 'Compte mis à jour' : 'Compte créé');
      },
      // AVANT : échec muet, la modale restait ouverte sans explication (quota, champ refusé…).
      error: (err) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(err, "Le compte n'a pas pu être enregistré."));
      },
    });
  }

  // ── Suppression / archivage ──────────────────────────────────────────────
  protected async confirmDelete(a: TradingAccount): Promise<void> {
    this.menuOpenId.set(null);
    const confirmed = await this.confirm.ask({
      title: `Supprimer « ${a.label} » ?`,
      message:
        'Les trades et sessions rattachés ne sont pas supprimés mais perdent leur compte. ' +
        'Un compte avec historique est archivé plutôt que supprimé.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!confirmed) return;
    this.deleteError.set(null);
    this.api
      .remove(a.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.store.load(),
        // Le back refuse d'archiver le dernier compte actif porteur d'historique. Son
        // message est déjà clair et actionnable : on l'affiche tel quel.
        error: (err) =>
          this.deleteError.set(err?.error?.message ?? 'Suppression impossible.'),
      });
  }
}
