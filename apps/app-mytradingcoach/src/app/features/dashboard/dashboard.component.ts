import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideCoins as Coins,
  LucideBarChart3 as BarChart3,
  LucideSparkles as Sparkles,
  LucideLayers as Layers,
  LucideHeartPulse as HeartPulse,
  LucideList as List,
  LucideRocket as Rocket,
} from '@lucide/angular';
import { httpResource } from '@angular/common/http';
import { UserStore } from '../../core/stores/user.store';
import { MoneyService } from '../../core/services/money.service';
import { cumulativePayouts, periodStartBalance, viewBalance, withPayoutsByTrade } from '../../core/services/equity-period.util';
import { maxDrawdownOfCumulative } from '@mtc/shared';
import { planObjectiveLine } from '../../core/services/chart-series.util';
import { drawdownScopeLabel, isMultiAccountView } from '../../core/services/drawdown-scope.util';
import { MixedCurrencyNoticeComponent } from '../../shared/components/mixed-currency-notice/mixed-currency-notice.component';
import { TradesStore } from '../../core/stores/trades.store';
import { SessionStore } from '../../core/stores/session.store';
import { PRICING } from '../../core/constants/pricing.const';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { TradeFormComponent } from '../journal/trade-form.component';
import { CsvImportComponent } from '../journal/csv-import.component';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { InfoTooltipComponent } from '../../shared/components/info-tooltip/info-tooltip.component';
import { CreateTradeDto, TradesApi } from '../../core/api/trades.api';
import {
  AnalyticsSummary,
  TradesEquityCurve,
  SetupStat,
  EmotionStat,
  TopAsset,
} from '../../core/api/analytics.api';
import { environment } from '@app/environments/environment';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { ToastService } from '../../core/services/toast.service';
import { TradovateLiveSocketService } from '../../core/services/tradovate-live-socket.service';
import { apiErrorMessage } from '../../core/utils/api-error';
import {
  DashboardTradeRow,
  buildCoachInsights,
  buildEmotionsDonut,
  buildPlBuckets,
  buildTradeRows,
  emotionSharesFromStats,
  plGranularityFor,
  plTitleFor,
  plTooltipFor,
  setupsDonutFromStats,
  setupsDonutFromTrades,
  tradeCountBars,
  topAssetBars,
} from './dashboard-charts.util';
import { DashboardKpisComponent } from './panels/dashboard-kpis/dashboard-kpis.component';
import { PerfChartComponent } from '../../shared/components/perf-chart/perf-chart.component';
import { TopAssetsComponent } from './panels/top-assets/top-assets.component';
import { PlBarsComponent } from './panels/pl-bars/pl-bars.component';
import { CoachFeedbackComponent } from './panels/coach-feedback/coach-feedback.component';
import { DonutChartComponent } from './panels/donut-chart/donut-chart.component';
import { RecentTradesTableComponent } from './panels/recent-trades-table/recent-trades-table.component';
import { MoneyPipe } from '../../shared/pipes';
import { ErrorStateComponent } from '@mtc/front-ui';
import { FloorReachedBannerComponent } from '../accounts/lost-account/floor-reached-banner.component';
import { InactiveAccountsToggleComponent } from '../../shared/components/inactive-accounts-toggle/inactive-accounts-toggle.component';
import { NO_AUTO_PERIOD, periodChosenByUser, periodOnSelection, type AutoPeriodState } from '../../core/utils/inactive-period.util';

/**
 * Dashboard : état (période, compte, resources analytics), cadre des panneaux et états
 * vides. Les visualisations sont des composants (`panels/`) et leurs calculs des fonctions
 * pures (`dashboard-charts.util.ts`).
 */
@Component({
  selector: 'mtc-dashboard',
  imports: [
    ErrorStateComponent,
    RouterLink,
    TopbarComponent,
    TradeFormComponent,
    CsvImportComponent,
    PlanModalComponent,
    LucideDynamicIcon,
    InfoTooltipComponent,
    DashboardKpisComponent,
    PerfChartComponent,
    TopAssetsComponent,
    PlBarsComponent,
    CoachFeedbackComponent,
    DonutChartComponent,
    RecentTradesTableComponent,
    MoneyPipe,
    MixedCurrencyNoticeComponent,
    FloorReachedBannerComponent,
    InactiveAccountsToggleComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dashboard.component.css',
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  protected readonly RocketIcon = Rocket;
  protected readonly userStore    = inject(UserStore);
  protected readonly money        = inject(MoneyService);
  protected readonly tradesStore  = inject(TradesStore);
  protected readonly sessionStore = inject(SessionStore);
  protected readonly selectedAccount = inject(SelectedAccountStore);
  private  readonly tradesApi     = inject(TradesApi);
  private  readonly destroyRef    = inject(DestroyRef);
  private  readonly toast         = inject(ToastService);
  private  readonly router        = inject(Router);

  protected goToSettings(): void { this.router.navigate(['/profil']); }

  protected readonly showTradeForm = signal(false);
  protected readonly showCsvImport = signal(false);
  protected readonly showPlanModal = signal(false);
  protected readonly isSavingTrade = signal(false);
  protected readonly PRICING = PRICING;

  // Icônes d'en-tête de panel (Lucide) : fidélité design.
  protected readonly AssetsIcon   = Coins;
  protected readonly PlDayIcon     = BarChart3;
  protected readonly CoachIcon    = Sparkles;
  protected readonly SetupsIcon   = Layers;
  protected readonly EmotionIcon  = HeartPulse;
  protected readonly TableIcon    = List;

  // ── Période unique du dashboard ────────────────────────────────────────────
  // KPIs, courbe d'équité et P&L par jour lisent TOUS cette même période.
  // Fenêtres glissantes (to = maintenant) pour que l'historique importé d'un mois passé
  // réapparaisse dès qu'on élargit la période. 'ALL' = tout l'historique (pas de borne basse).
  protected readonly periods = [
    { key: '1M', label: '1M' },
    { key: '3M', label: '3M' },
    { key: '6M', label: '6M' },
    { key: 'ALL', label: 'Tout' },
  ] as const;
  protected readonly dashboardPeriod = signal<'1M' | '3M' | '6M' | 'ALL'>('1M');
  /** L'élargissement auto (fenêtre vide + historique existant) n'a lieu qu'une fois,
   *  et jamais après un choix explicite : sinon on écraserait la volonté de l'utilisateur. */
  private periodAutoAdjusted = false;
  /** Période posée sur « Tout » pour un compte échoué ou archivé (cf. `inactive-period.util.ts`). */
  private inactivePeriod: AutoPeriodState<'1M' | '3M' | '6M' | 'ALL'> = NO_AUTO_PERIOD;
  /** Compte sélectionné au dernier passage (`id:statut` ou `all`), null avant le premier. */
  private lastSelectionKey: string | null = null;
  protected setPeriod(p: '1M' | '3M' | '6M' | 'ALL'): void {
    this.periodAutoAdjusted = true;
    // Choix de l'utilisateur : il prime sur la période posée pour un compte échoué ou archivé.
    this.inactivePeriod = periodChosenByUser();
    this.dashboardPeriod.set(p);
  }

  /**
   * Bornes glissantes de la période courante. `from = null` → tout l'historique. `to` = fin de la
   * journée, pas « maintenant » : ce computed ne se recalcule qu'au changement de période, et un
   * `to` figé à l'ouverture de la page excluait des KPI un trade saisi ou importé ensuite (#947).
   */
  protected readonly periodRange = computed<{ from: Date | null; to: Date }>(() => {
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    const p = this.dashboardPeriod();
    if (p === 'ALL') return { from: null, to };
    const days = p === '1M' ? 30 : p === '3M' ? 90 : 180;
    const from = new Date(to);
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  });

  /** Libellé humain de la période (topbar + sous-titres). */
  protected readonly periodLabel = computed(() => {
    switch (this.dashboardPeriod()) {
      case '1M': return '30 derniers jours';
      case '3M': return '3 derniers mois';
      case '6M': return '6 derniers mois';
      default:   return "Tout l'historique";
    }
  });
  /** Suffixe court pour le sous-titre de la courbe d'équité (« +X sur 3 mois »). */
  protected readonly periodShort = computed(() => {
    switch (this.dashboardPeriod()) {
      case '1M': return 'sur 30 jours';
      case '3M': return 'sur 3 mois';
      case '6M': return 'sur 6 mois';
      default:   return 'au total';
    }
  });

  // Query compte + bornes de période (KPIs / équité / P&L par jour). Lu dans les URL des
  // resources → refetch auto au changement de compte OU de période.
  private rangeQuery(): string {
    const { from, to } = this.periodRange();
    const parts: string[] = [];
    for (const [k, v] of Object.entries(this.selectedAccount.statsParams())) parts.push(`${k}=${encodeURIComponent(v)}`);
    if (from) parts.push(`from=${from.toISOString()}`);
    parts.push(`to=${to.toISOString()}`);
    return `?${parts.join('&')}`;
  }

  // KPIs scopés à la période sélectionnée (from/to glissants).
  private readonly summaryResource = httpResource<{ data: AnalyticsSummary }>(
    () => `${environment.apiUrl}/analytics/summary${this.rangeQuery()}`,
  );
  // Courbe d'équité simple = vue de base FREE (on ne verrouille pas la vue de ses données).
  // Scopée à la même période que les KPIs. UN POINT PAR CLÔTURE DE TRADE (un creux intrajournalier
  // entre deux trades se voit) + drawdown max de la période calculé sur toutes les clôtures.
  private readonly equityCurveResource = httpResource<{
    data: TradesEquityCurve;
  }>(() => `${environment.apiUrl}/analytics/equity-curve/trades${this.rangeQuery()}`);
  // Activité journalière (P&L par jour) sur la même période : agrégée jour/semaine/mois côté front.
  private readonly activityResource = httpResource<{
    data: { days: { date: string; pnl: number; tradesCount: number }[] };
  }>(() => `${environment.apiUrl}/analytics/activity/range${this.rangeQuery()}`);
  // Setups, émotions et top actifs sur la MÊME période que les KPI (#947) : avant, by-setup et
  // top-assets portaient sur tout l'historique et le donut des émotions sur les 6 derniers trades.
  private readonly bySetupResource = httpResource<{ data: SetupStat[] }>(() =>
    this.userStore.isPremium() ? `${environment.apiUrl}/analytics/by-setup${this.rangeQuery()}` : undefined,
  );
  // by-emotion = vue de base FREE : chargée pour tous les plans (donut des états émotionnels).
  private readonly byEmotionResource = httpResource<{ data: EmotionStat[] }>(
    () => `${environment.apiUrl}/analytics/by-emotion${this.rangeQuery()}`,
  );
  // Top actifs (P&L par instrument) vue simple = vue de base FREE.
  private readonly topAssetsResource = httpResource<{ data: TopAsset[] }>(() =>
    `${environment.apiUrl}/analytics/top-assets${this.rangeQuery()}`,
  );

  /**
   * Une donnée du dashboard n'a pas pu être chargée. Sans ce signal, une panne de l'API
   * s'affichait comme un compte vide (KPI à zéro, graphiques vides).
   */
  protected readonly loadError = computed(
    () =>
      !!(
        this.summaryResource.error() ||
        this.equityCurveResource.error() ||
        this.activityResource.error() ||
        this.bySetupResource.error() ||
        this.byEmotionResource.error() ||
        this.topAssetsResource.error()
      ),
  );

  protected reload(): void {
    for (const resource of [
      this.summaryResource,
      this.equityCurveResource,
      this.activityResource,
      this.bySetupResource,
      this.byEmotionResource,
      this.topAssetsResource,
    ]) {
      resource.reload();
    }
  }

  protected readonly summary = computed(() => this.summaryResource.value()?.data ?? null);

  /** Top actifs par P&L (HBars) : largeur de barre précalculée sur le max absolu. */
  protected readonly topAssets = computed(() => topAssetBars(this.topAssetsResource.value()?.data ?? []));

  /**
   * Capital de base, source unique scopée au compte sélectionné : miroir EXACT
   * de la page Mes comptes :
   * - compte sélectionné → son `metrics.startingBalance` ;
   * - « Tous les comptes » → somme des `startingBalance` des comptes qui entrent dans les
   *   chiffres (ni échoués ni archivés, sauf interrupteur ; cf. `trackedCapital` de Mes comptes) ;
   * - comptes non chargés → fallback sur le capital du profil user.
   */
  protected readonly baseCapital = computed(() => {
    if (!this.selectedAccount.loaded()) {
      return this.userStore.startingCapital();
    }
    const account = this.selectedAccount.selected();
    if (account) return account.metrics.startingBalance ?? 0;
    const active = this.selectedAccount.aggregateAccounts();
    // AUCUN compte (l'utilisateur a passé l'ajout de trade : le compte n'est créé
    // qu'au premier trade) → le capital déclaré à l'onboarding faisait place à
    // « $0.00 », comme si sa saisie avait été perdue. On retombe donc sur le profil,
    // exactement comme le backend le fait à la création implicite du compte
    // (accounts.service ensureDefaultAccountId).
    if (active.length === 0) return this.userStore.startingCapital();
    return active.reduce((s, a) => s + (a.metrics.startingBalance ?? 0), 0);
  });
  /**
   * Capital affiché = solde actuel du compte (ou des comptes non archivés), le MÊME que le
   * sélecteur et Mes comptes (celui du broker pour un compte connecté). Avant : capital de départ
   * + P&L de la PÉRIODE, donc faux dès que des trades précédaient la période.
   * Sans compte chargé → capital de départ + P&L, comme avant.
   */
  protected readonly currentCapital = computed(() => {
    const current = this.selectedAccount.loaded()
      ? viewBalance(this.selectedAccount.selected(), this.selectedAccount.accounts(), 'currentBalance', this.selectedAccount.includeInactive())
      : null;
    return current ?? this.baseCapital() + (this.summary()?.totalPnl ?? 0);
  });
  /**
   * Solde au début de la période (base du %, de la sparkline et de la courbe) : solde de départ +
   * P&L d'avant la période ; la taille du compte quand la période couvre son début.
   */
  protected readonly periodStartCapital = computed(() =>
    periodStartBalance(
      this.baseCapital(),
      this.currentCapital(),
      this.summary()?.totalPnl ?? 0,
      this.equityCurveResource.value()?.data?.before,
    ),
  );
  /**
   * Drawdown après chaque clôture de trade de la période (≤ 0, départ compris), règle unique
   * `@mtc/shared` : sommet = solde du début de période puis plus haut atteint. Source de la
   * sparkline ; la valeur du KPI est celle de l'API (toutes les clôtures, avant réduction).
   */
  protected readonly drawdownSeries = computed(() =>
    this.multiAccountView() ? [] : maxDrawdownOfCumulative(this.equityCurve().map((p) => p.cumulativePnl)).series,
  );
  /**
   * Vue « Tous les comptes » avec plusieurs comptes (PROMPT-drawdown-max-par-compte) : le drawdown
   * max est celui du PIRE compte (API), la sparkline est masquée (la courbe additionne les comptes,
   * ce n'est le drawdown d'aucun d'eux) et le repli ne recalcule jamais une série mélangée.
   * Un compte plus des trades sans compte compte aussi comme plusieurs séries (#940, chiffre API).
   */
  protected readonly multiAccountView = computed(() =>
    isMultiAccountView(
      this.selectedAccount.selectedAccountId(),
      this.selectedAccount.aggregateAccounts().length,
      this.equityCurveResource.value()?.data?.maxDrawdownAccountCount,
    ),
  );
  protected readonly maxDrawdown = computed(
    () =>
      this.equityCurveResource.value()?.data?.maxDrawdown ??
      (this.multiAccountView() ? 0 : Math.min(0, ...this.drawdownSeries())),
  );
  /** « sur le compte X » sous le drawdown max en vue multi-comptes ; null sinon. */
  protected readonly drawdownScope = computed(() => {
    if (!this.multiAccountView()) return null;
    const data = this.equityCurveResource.value()?.data;
    return drawdownScopeLabel(data?.maxDrawdownAccountId, data?.maxDrawdown ?? 0, this.selectedAccount.accounts());
  });
  /**
   * Message quand la courbe ne se trace pas : ne JAMAIS dire « aucun trade » si les KPIs en
   * comptent (critère d'acceptation de la courbe). Une courbe a besoin d'au moins 2 jours tradés ;
   * avec des trades sur un seul jour on l'explique au lieu de contredire les KPIs.
   */
  protected readonly equityEmptyMsg = computed(() =>
    (this.summary()?.totalTrades ?? 0) > 0
      ? 'Pas assez de jours tradés pour tracer la courbe'
      : 'Aucun trade sur la période',
  );
  /** Points de la période, payouts reçus insérés (déduits des courbes de solde, pas du P&L). */
  protected readonly equityCurve = computed(() => {
    const data = this.equityCurveResource.value()?.data;
    return withPayoutsByTrade(data?.points ?? [], data?.payouts);
  });
  /** Objectif de gain du compte sélectionné, tracé sur la courbe d'équité. */
  protected readonly equityObjective = computed(() =>
    planObjectiveLine(this.selectedAccount.selected(), this.equityCurve()),
  );
  /** P&L cumulé le long de la courbe : source de la courbe d'équité et des sparklines. */
  protected readonly eqSeries = computed(() => this.equityCurve().map((p) => p.cumulativePnl));
  protected readonly payoutSeries = computed(() => cumulativePayouts(this.equityCurve()));
  protected readonly bySetup = computed(() => this.bySetupResource.value()?.data ?? []);
  /** Stats par émotion (R moyen / win rate) : source du feedback coach. */
  protected readonly byEmotion = computed(() => this.byEmotionResource.value()?.data ?? []);
  /**
   * Chargement du dashboard : on affiche un squelette (jamais des zéros) tant que les
   * comptes ou les données de base (summary, courbe d'équité) ne sont PAS chargés, pour
   * FREE comme Premium. Le gating `isPremium()` d'avant rendait `isLoading` toujours faux
   * en FREE, d'où « Capital $0 / 0 compte » affiché au premier rendu post-onboarding.
   * Les resources by-setup/by-emotion ne comptent que pour un Premium (chargées pour lui seul).
   */
  protected readonly isLoading = computed(
    () =>
      !this.selectedAccount.loaded() ||
      this.selectedAccount.isLoading() ||
      this.summaryResource.isLoading() ||
      this.equityCurveResource.isLoading() ||
      (this.userStore.isPremium() &&
        (this.bySetupResource.isLoading() || this.byEmotionResource.isLoading())),
  );

  /**
   * « Fais ton premier pas » : le compte n'a RÉELLEMENT aucun trade.
   * Les trois conditions comptent — comptes chargés, trades chargés, et seulement
   * alors un total à 0. Sans le `tradesStore.loaded()`, le bandeau s'affichait
   * pendant la fenêtre reset+recharge d'un import réussi : l'utilisateur venait
   * d'importer son historique et lisait « tu n'as rien fait ».
   * Hors fenêtre de date ≠ inexistant : le store charge sans borne de date, donc un
   * historique ancien le remplit même quand les KPIs de la période sont à zéro.
   */
  protected readonly accountReallyEmpty = computed(
    () =>
      this.selectedAccount.loaded() &&
      this.tradesStore.loaded() &&
      this.tradesStore.totalTrades() === 0,
  );

  private readonly knownTradesCount = signal(-1);
  private readonly knownAccountsCount = signal(-1);
  /** Comptes exclus au dernier passage (`échoués:archivés`), null avant le premier chargement. */
  private knownExcluded: string | null = null;

  /**
   * Derniers trades : même périmètre que les chiffres (`statsParams` : compte précis, sinon comptes
   * échoués et archivés exclus sauf interrupteur), comme la liste du journal.
   */
  private recentTradesFilters(): Record<string, string> {
    return { limit: '6', ...this.selectedAccount.statsParams() };
  }

  constructor() {
    // Trades Tradovate poussés en direct : mêmes rechargements qu'après un import.
    inject(TradovateLiveSocketService)
      .imported$.pipe(takeUntilDestroyed())
      .subscribe(() => this.reloadAfterImport());

    // Trades récents + activité du compte sélectionné. L'effect relit `statsParams()` →
    // refetch automatique au changement de compte ou de l'interrupteur des comptes perdus.
    effect(() => {
      this.tradesStore.loadTrades(this.recentTradesFilters());
      // L'activité (P&L par jour) est un httpResource keyé sur rangeQuery() → refetch auto.
    });

    // Recharge les analytics si un trade est ajouté depuis l'extérieur (wizard, import).
    // Rien tant que le store n'est pas chargé : sinon le premier chargement (0 → N) passait pour
    // N nouveaux trades et rechargeait les 4 resources à peine demandées (SCA-B4-04). Pendant un
    // reset + rechargement (import), la référence reste celle d'avant : l'arrivée des trades
    // importés déclenche bien le rechargement.
    effect(() => {
      if (!this.tradesStore.loaded()) return;
      const count = this.tradesStore.totalTrades();
      const known = untracked(() => this.knownTradesCount());
      if (known !== -1 && count > known) this.reloadAnalytics();
      this.knownTradesCount.set(count);
    });

    // Recharge les analytics quand la LISTE de comptes change (import onboarding qui crée le
    // compte par défaut, sans forcément passer par le compteur de trades ci-dessus). Même garde :
    // la liste qui arrive au premier chargement n'est pas un changement.
    effect(() => {
      if (!this.selectedAccount.loaded()) return;
      const n = this.selectedAccount.accounts().length;
      const known = untracked(() => this.knownAccountsCount());
      if (known !== -1 && n !== known) this.reloadAnalytics();
      this.knownAccountsCount.set(n);
    });

    // Compte marqué échoué, archivé ou supprimé : la liste a la même taille mais les chiffres
    // « tous les comptes » changent (l'API a vidé son cache). Même garde que ci-dessus.
    effect(() => {
      if (!this.selectedAccount.loaded()) return;
      const e = this.selectedAccount.excludedAccounts();
      const key = `${e.failed}:${e.archived}`;
      const known = this.knownExcluded;
      if (known !== null && key !== known) {
        this.reloadAnalytics();
        untracked(() => this.tradesStore.loadTrades(this.recentTradesFilters()));
      }
      this.knownExcluded = key;
    });

    // Compte échoué ou archivé choisi : ses trades sont souvent plus vieux que la fenêtre « 1M ».
    // La période passe sur « Tout », et la précédente revient avec un compte actif.
    effect(() => {
      const sel = this.selectedAccount.selected();
      const key = sel ? `${sel.id}:${sel.status}` : 'all';
      if (key === this.lastSelectionKey) return;
      this.lastSelectionKey = key;
      untracked(() => {
        const r = periodOnSelection(this.inactivePeriod, sel, this.dashboardPeriod(), 'ALL');
        this.inactivePeriod = r.state;
        if (r.period) {
          this.periodAutoAdjusted = true;
          this.dashboardPeriod.set(r.period);
        }
      });
    });

    // Fenêtre par défaut CONSCIENTE DES DONNÉES.
    // Un historique importé date presque toujours de plus de 30 jours : la fenêtre 1M
    // par défaut affichait alors « Aucune donnée / 0 trade » juste après un import
    // réussi, pendant que « Top actifs » montrait les trades — l'import paraissait raté.
    // Si la fenêtre courante est vide ALORS que le compte a des trades, on l'élargit
    // une seule fois à « Tout ». L'utilisateur reste maître ensuite (cf. setPeriod).
    effect(() => {
      if (this.periodAutoAdjusted) return;
      const summary = this.summary();
      if (!summary) return; // KPIs pas encore chargés
      if (summary.totalTrades > 0) { this.periodAutoAdjusted = true; return; }
      // Store pas encore chargé (ou rechargé après un import) : son 0 signifie
      // « on ne sait pas », pas « compte vide ». On ne conclut rien et surtout on ne
      // désarme pas — l'effect rejoue dès que `loaded` passe.
      if (!this.tradesStore.loaded()) return;
      // `tradesStore` charge les derniers trades SANS borne de date : s'il en voit,
      // c'est que le compte a un historique, simplement hors de la fenêtre.
      // Compte réellement vide → rien à élargir, mais on reste armé : l'import qui
      // suit remplira le store et déclenchera l'élargissement.
      if (this.tradesStore.totalTrades() === 0) return;
      this.periodAutoAdjusted = true;
      untracked(() => this.dashboardPeriod.set('ALL'));
    });
  }

  /** Recharge toutes les resources analytics scopées à la période (après import / nouveau trade). */
  private reloadAnalytics(): void {
    this.summaryResource.reload();
    this.equityCurveResource.reload();
    this.activityResource.reload();
    this.topAssetsResource.reload();
    this.bySetupResource.reload();
    this.byEmotionResource.reload();
  }

  // ── Viz (calculs dans dashboard-charts.util.ts) ────────────────────────────

  /** Vue donut setups selon le plan : profondeur (win rate) en Premium, répartition % en FREE. */
  protected readonly setupsDonutView = computed(() =>
    this.userStore.isPremium()
      ? setupsDonutFromStats(this.bySetup())
      : setupsDonutFromTrades(this.tradesStore.trades()),
  );

  protected readonly emotionStats = computed(() => emotionSharesFromStats(this.byEmotion()));
  /** Donut états émotionnels (état dominant au centre). */
  protected readonly emotionsDonut = computed(() => buildEmotionsDonut(this.emotionStats()));

  /** Granularité des barres « P&L » : ≤ 31 barres (jour → semaine → mois). */
  protected readonly plGranularity = computed(() => plGranularityFor(this.periodRange()));
  protected readonly plTitle = computed(() => plTitleFor(this.plGranularity()));
  protected readonly plTooltip = computed(() => plTooltipFor(this.plGranularity()));
  /** Barres réelles de la carte « Trades pris » : trades par jour tradé de la période. */
  protected readonly tradeBars = computed(() => tradeCountBars(this.activityResource.value()?.data?.days ?? []));
  protected readonly plBuckets = computed(() => {
    const days = this.activityResource.value()?.data?.days ?? null;
    return days === null
      ? null
      : buildPlBuckets(days, this.plGranularity(), this.periodRange(), (v) =>
          this.money.format(v, { decimals: 0, compact: true, symbol: false }),
        );
  });

  /** Feedback « AI Coach » dérivé des vraies données (summary + émotions + setups). */
  protected readonly coachInsights = computed(() =>
    buildCoachInsights(this.summary(), this.byEmotion(), this.bySetup(), this.periodShort()),
  );

  /**
   * Lignes du tableau « historique des trades » (vrais trades récents).
   * P&L % = rendement sur le capital de base ; `null` si ce capital est
   * inconnu/0 (sinon la division /1 produit des pourcentages absurdes → « - »).
   */
  protected readonly tradeRows = computed<DashboardTradeRow[]>(() =>
    buildTradeRows(this.tradesStore.trades().slice(0, 8), this.baseCapital()),
  );

  goToJournal() { this.showTradeForm.set(true); }

  protected openCsvImport(): void { this.showCsvImport.set(true); }

  protected onCsvImported(): void {
    this.showCsvImport.set(false);
    this.reloadAfterImport();
  }

  private reloadAfterImport(): void {
    // Le premier import crée le compte de trading côté backend : sans ce rechargement,
    // le sélecteur et le capital restaient sur « aucun compte ».
    this.selectedAccount.load();
    this.tradesStore.reset();
    // Même filtre que le chargement nominal : un `limit` seul ramenait les trades de TOUS les
    // comptes alors qu'un compte précis pouvait être sélectionné.
    this.tradesStore.loadTrades(untracked(() => this.recentTradesFilters()));
    this.reloadAnalytics();
  }

  protected saveTrade(dto: CreateTradeDto) {
    this.isSavingTrade.set(true);
    this.tradesApi
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.tradesStore.addTrade(res.data);
          this.showTradeForm.set(false);
          this.isSavingTrade.set(false);
          this.reloadAnalytics();
          this.toast.success('Trade enregistré');
        },
        // AVANT : échec muet, le formulaire restait ouvert sans explication.
        error: (err) => {
          this.isSavingTrade.set(false);
          this.toast.error(apiErrorMessage(err, 'Ton trade n’a pas pu être enregistré.'));
        },
      });
  }
}
