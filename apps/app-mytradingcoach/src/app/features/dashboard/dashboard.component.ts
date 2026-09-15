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
  LucideTrendingUp as TrendingUp,
  LucideCoins as Coins,
  LucideBarChart3 as BarChart3,
  LucideSparkles as Sparkles,
  LucideLayers as Layers,
  LucideHeartPulse as HeartPulse,
  LucideList as List,
} from '@lucide/angular';
import { httpResource } from '@angular/common/http';
import { UserStore } from '../../core/stores/user.store';
import { MoneyService } from '../../core/services/money.service';
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
  EquityPoint,
  SetupStat,
  EmotionStat,
  TopAsset,
} from '../../core/api/analytics.api';
import { environment } from '../../../environments/environment';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { ToastService } from '../../core/services/toast.service';
import { TradovateLiveSocketService } from '../../core/services/tradovate-live-socket.service';
import { apiErrorMessage } from '../../core/utils/api-error';
import {
  DashboardTradeRow,
  buildCoachInsights,
  buildEmotionsDonut,
  buildEquityGlow,
  buildPlBuckets,
  emotionShares,
  plGranularityFor,
  plTitleFor,
  plTooltipFor,
  setupsDonutFromStats,
  setupsDonutFromTrades,
  topAssetBars,
} from './dashboard-charts.util';
import { DashboardKpisComponent } from './panels/dashboard-kpis/dashboard-kpis.component';
import { EquityChartComponent } from './panels/equity-chart/equity-chart.component';
import { TopAssetsComponent } from './panels/top-assets/top-assets.component';
import { PlBarsComponent } from './panels/pl-bars/pl-bars.component';
import { CoachFeedbackComponent } from './panels/coach-feedback/coach-feedback.component';
import { DonutChartComponent } from './panels/donut-chart/donut-chart.component';
import { RecentTradesTableComponent } from './panels/recent-trades-table/recent-trades-table.component';
import { MoneyPipe } from '../../shared/pipes';
import { netPnl } from '@mtc/shared';

/**
 * Dashboard : état (période, compte, resources analytics), cadre des panneaux et états
 * vides. Les visualisations sont des composants (`panels/`) et leurs calculs des fonctions
 * pures (`dashboard-charts.util.ts`).
 */
@Component({
  selector: 'mtc-dashboard',
  imports: [
    RouterLink,
    TopbarComponent,
    TradeFormComponent,
    CsvImportComponent,
    PlanModalComponent,
    LucideDynamicIcon,
    InfoTooltipComponent,
    DashboardKpisComponent,
    EquityChartComponent,
    TopAssetsComponent,
    PlBarsComponent,
    CoachFeedbackComponent,
    DonutChartComponent,
    RecentTradesTableComponent,
    MoneyPipe,
    MixedCurrencyNoticeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dashboard.component.css',
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
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
  protected readonly EquityIcon   = TrendingUp;
  protected readonly AssetsIcon   = Coins;
  protected readonly PlDayIcon     = BarChart3;
  protected readonly CoachIcon    = Sparkles;
  protected readonly SetupsIcon   = Layers;
  protected readonly EmotionIcon  = HeartPulse;
  protected readonly TableIcon    = List;

  // ── Période unique du dashboard ────────────────────────────────────────────
  // KPIs, courbe d'équité et P&L par jour lisent TOUS cette même période (PROMPT-175).
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
  protected setPeriod(p: '1M' | '3M' | '6M' | 'ALL'): void {
    this.periodAutoAdjusted = true;
    this.dashboardPeriod.set(p);
  }

  /** Bornes glissantes de la période courante. `from = null` → tout l'historique. */
  protected readonly periodRange = computed<{ from: Date | null; to: Date }>(() => {
    const to = new Date();
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

  // Suffixe query du compte sélectionné (multi-comptes). « Tous » → '' (agrégé). Lu dans les
  // URL des resources → tout se refetch automatiquement au changement de compte.
  private accQuery(): string {
    const id = this.selectedAccount.accountParam();
    return id ? `?accountId=${encodeURIComponent(id)}` : '';
  }

  // Query compte + bornes de période (KPIs / équité / P&L par jour). Lu dans les URL des
  // resources → refetch auto au changement de compte OU de période.
  private rangeQuery(): string {
    const { from, to } = this.periodRange();
    const parts: string[] = [];
    const id = this.selectedAccount.accountParam();
    if (id) parts.push(`accountId=${encodeURIComponent(id)}`);
    if (from) parts.push(`from=${from.toISOString()}`);
    parts.push(`to=${to.toISOString()}`);
    return `?${parts.join('&')}`;
  }

  // KPIs scopés à la période sélectionnée (from/to glissants).
  private readonly summaryResource = httpResource<{ data: AnalyticsSummary }>(
    () => `${environment.apiUrl}/analytics/summary${this.rangeQuery()}`,
  );
  // Courbe d'équité simple = vue de base FREE (on ne verrouille pas la vue de ses données).
  // Scopée à la même période que les KPIs.
  private readonly equityCurveResource = httpResource<{
    data: { points: EquityPoint[]; startingCapital: number | null };
  }>(() => `${environment.apiUrl}/analytics/equity-curve/daily${this.rangeQuery()}`);
  // Activité journalière (P&L par jour) sur la même période : agrégée jour/semaine/mois côté front.
  private readonly activityResource = httpResource<{
    data: { days: { date: string; pnl: number; tradesCount: number }[] };
  }>(() => `${environment.apiUrl}/analytics/activity/range${this.rangeQuery()}`);
  private readonly bySetupResource = httpResource<{ data: SetupStat[] }>(() =>
    this.userStore.isPremium() ? `${environment.apiUrl}/analytics/by-setup${this.accQuery()}` : undefined,
  );
  private readonly byEmotionResource = httpResource<{ data: EmotionStat[] }>(() =>
    this.userStore.isPremium() ? `${environment.apiUrl}/analytics/by-emotion${this.accQuery()}` : undefined,
  );
  // Top actifs (P&L par instrument) vue simple = vue de base FREE.
  private readonly topAssetsResource = httpResource<{ data: TopAsset[] }>(() =>
    `${environment.apiUrl}/analytics/top-assets${this.accQuery()}`,
  );

  protected readonly summary = computed(() => this.summaryResource.value()?.data ?? null);

  /** Top actifs par P&L (HBars) : largeur de barre précalculée sur le max absolu. */
  protected readonly topAssets = computed(() => topAssetBars(this.topAssetsResource.value()?.data ?? []));

  /**
   * Capital de base, source unique scopée au compte sélectionné : miroir EXACT
   * de la page Mes comptes :
   * - compte sélectionné → son `metrics.startingBalance` ;
   * - « Tous les comptes » → somme des `startingBalance` des comptes non archivés
   *   (cf. `trackedCapital` dans accounts.component) ;
   * - comptes non chargés → fallback sur le capital du profil user.
   */
  protected readonly baseCapital = computed(() => {
    if (!this.selectedAccount.loaded()) {
      return this.userStore.startingCapital();
    }
    const account = this.selectedAccount.selected();
    if (account) return account.metrics.startingBalance ?? 0;
    const active = this.selectedAccount.accounts().filter((a) => a.status !== 'ARCHIVED');
    // AUCUN compte (l'utilisateur a passé l'ajout de trade : le compte n'est créé
    // qu'au premier trade) → le capital déclaré à l'onboarding faisait place à
    // « $0.00 », comme si sa saisie avait été perdue. On retombe donc sur le profil,
    // exactement comme le backend le fait à la création implicite du compte
    // (accounts.service ensureDefaultAccountId). PROMPT-186 #5.
    if (active.length === 0) return this.userStore.startingCapital();
    return active.reduce((s, a) => s + (a.metrics.startingBalance ?? 0), 0);
  });
  protected readonly currentCapital = computed(() =>
    this.baseCapital() + (this.summary()?.totalPnl ?? 0),
  );
  /** Sous-titre courbe d'équité : « +$X sur 3 mois · base $Y » (période courante). */
  protected readonly equitySub = computed(() => {
    const base   = this.baseCapital();
    const period = this.summary()?.totalPnl ?? 0;
    const fmt    = (n: number, sign: boolean) => this.money.format(n, { decimals: 0, sign });
    return `${fmt(period, true)} ${this.periodShort()} · base ${fmt(base, false)}`;
  });
  /**
   * Message quand la courbe ne se trace pas : ne JAMAIS dire « aucun trade » si les KPIs en
   * comptent (critère d'acceptation PROMPT-175). Une courbe a besoin d'au moins 2 jours tradés ;
   * avec des trades sur un seul jour on l'explique au lieu de contredire les KPIs.
   */
  protected readonly equityEmptyMsg = computed(() =>
    (this.summary()?.totalTrades ?? 0) > 0
      ? 'Pas assez de jours tradés pour tracer la courbe'
      : 'Aucun trade sur la période',
  );
  protected readonly equityCurve = computed(
    () => this.equityCurveResource.value()?.data?.points ?? [],
  );
  /** P&L cumulé le long de la courbe : source de la courbe d'équité et des sparklines. */
  protected readonly eqSeries = computed(() => this.equityCurve().map((p) => p.cumulativePnl));
  protected readonly bySetup = computed(() => this.bySetupResource.value()?.data ?? []);
  /** Stats par émotion (R moyen / win rate) : source du feedback coach. */
  protected readonly byEmotion = computed(() => this.byEmotionResource.value()?.data ?? []);
  /**
   * Chargement du dashboard : on affiche un squelette (jamais des zéros) tant que les
   * comptes ou les données de base (summary, courbe d'équité) ne sont PAS chargés, pour
   * FREE comme Premium. Le gating `isPremium()` d'avant rendait `isLoading` toujours faux
   * en FREE, d'où « Capital $0 / 0 compte » affiché au premier rendu post-onboarding (PROMPT-175).
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
   * d'importer son historique et lisait « tu n'as rien fait » (PROMPT-196).
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

  constructor() {
    // Trades Tradovate poussés en direct (PROMPT-210 live) : mêmes rechargements qu'après un import.
    inject(TradovateLiveSocketService)
      .imported$.pipe(takeUntilDestroyed())
      .subscribe(() => this.reloadAfterImport());

    // Trades récents + activité du compte sélectionné. L'effect relit `accountParam()` →
    // refetch automatique au changement de compte ('all' = agrégé, sans param).
    effect(() => {
      const accountId = this.selectedAccount.accountParam();
      this.tradesStore.loadTrades(accountId ? { limit: '6', accountId } : { limit: '6' });
      // L'activité (P&L par jour) est un httpResource keyé sur rangeQuery() → refetch auto.
    });

    // Recharge les analytics si un trade est ajouté depuis l'extérieur (wizard)
    effect(() => {
      const count = this.tradesStore.totalTrades();
      const known = this.knownTradesCount();
      if (known !== -1 && count > known) this.reloadAnalytics();
      this.knownTradesCount.set(count);
    });

    // Recharge les analytics quand la LISTE de comptes change (import onboarding qui crée le
    // compte par défaut, sans forcément passer par le compteur de trades ci-dessus).
    effect(() => {
      const n = this.selectedAccount.accounts().length;
      const known = this.knownAccountsCount();
      if (known !== -1 && n !== known) this.reloadAnalytics();
      this.knownAccountsCount.set(n);
    });

    // Fenêtre par défaut CONSCIENTE DES DONNÉES (PROMPT-186 #2).
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
      // désarme pas — l'effect rejoue dès que `loaded` passe (PROMPT-196).
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
  }

  // ── Viz (calculs dans dashboard-charts.util.ts) ────────────────────────────

  /** Courbe d'équité « glow », verte ou rouge selon le P&L de la période. */
  protected readonly equityGlow = computed(() =>
    buildEquityGlow(this.eqSeries(), (this.summary()?.totalPnl ?? 0) >= 0),
  );

  /** Vue donut setups selon le plan : profondeur (win rate) en Premium, répartition % en FREE. */
  protected readonly setupsDonutView = computed(() =>
    this.userStore.isPremium()
      ? setupsDonutFromStats(this.bySetup())
      : setupsDonutFromTrades(this.tradesStore.trades()),
  );

  protected readonly emotionStats = computed(() => emotionShares(this.tradesStore.trades()));
  /** Donut états émotionnels (état dominant au centre). */
  protected readonly emotionsDonut = computed(() => buildEmotionsDonut(this.emotionStats()));

  /** Granularité des barres « P&L » : ≤ 31 barres (jour → semaine → mois). */
  protected readonly plGranularity = computed(() => plGranularityFor(this.periodRange()));
  protected readonly plTitle = computed(() => plTitleFor(this.plGranularity()));
  protected readonly plTooltip = computed(() => plTooltipFor(this.plGranularity()));
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
    buildCoachInsights(this.summary(), this.byEmotion(), this.bySetup()),
  );

  /**
   * Lignes du tableau « historique des trades » (vrais trades récents).
   * P&L % = rendement sur le capital de base ; `null` si ce capital est
   * inconnu/0 (sinon la division /1 produit des pourcentages absurdes → « - »).
   */
  protected readonly tradeRows = computed<DashboardTradeRow[]>(() => {
    const base = this.baseCapital();
    return this.tradesStore.trades().slice(0, 8).map((t) => {
      // P&L NET (frais déduits), comme les KPIs et le calendrier (PROMPT-213).
      const net = netPnl(t);
      return {
        ...t,
        pnl: net,
        win: (net ?? 0) >= 0,
        pct: base > 0 ? ((net ?? 0) / base) * 100 : null,
      };
    });
  });

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
    // Même filtre de compte que le chargement nominal : un `limit` seul ramenait les
    // trades de TOUS les comptes alors qu'un compte précis pouvait être sélectionné.
    const accountId = this.selectedAccount.accountParam();
    this.tradesStore.loadTrades(accountId ? { limit: '6', accountId } : { limit: '6' });
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
