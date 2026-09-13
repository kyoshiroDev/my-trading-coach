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
import { DatePipe, DecimalPipe, UpperCasePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, TrendingUp, Coins, BarChart3, Sparkles, Layers, HeartPulse, List, CheckCircle2, AlertTriangle, XCircle, Lock } from 'lucide-angular';
import { BillingApi } from '../../core/api/billing.api';
import { httpResource } from '@angular/common/http';
import { UserStore } from '../../core/stores/user.store';
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
import {
  EmotionColorPipe,
  EmotionLabelPipe,
  PnlFormatPipe,
} from '../../shared/pipes';
import { EMOTION_COLORS } from '../../shared/pipes/emotion-color.pipe';
import { environment } from '../../../environments/environment';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { ToastService } from '../../core/services/toast.service';
import { TradovateLiveSocketService } from '../../core/services/tradovate-live-socket.service';
import { apiErrorMessage } from '../../core/utils/api-error';

@Component({
  selector: 'mtc-dashboard',
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    UpperCasePipe,
    TopbarComponent,
    TradeFormComponent,
    CsvImportComponent,
    PlanModalComponent,
    PnlFormatPipe,
    EmotionLabelPipe,
    EmotionColorPipe,
    LucideAngularModule,
    InfoTooltipComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dashboard.component.css',
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  protected readonly userStore    = inject(UserStore);
  protected readonly tradesStore  = inject(TradesStore);
  protected readonly sessionStore = inject(SessionStore);
  protected readonly selectedAccount = inject(SelectedAccountStore);
  private  readonly billingApi    = inject(BillingApi);
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
  protected readonly CoachGood    = CheckCircle2;
  protected readonly CoachWarn    = AlertTriangle;
  protected readonly CoachBad     = XCircle;
  protected readonly LockIcon     = Lock;
  protected coachIcon(tone: string) { return tone === 'good' ? this.CoachGood : tone === 'warn' ? this.CoachWarn : this.CoachBad; }
  protected coachColor(tone: string) { return tone === 'good' ? 'var(--green)' : tone === 'warn' ? 'var(--yellow)' : 'var(--red)'; }

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
  protected readonly topAssets = computed(() => {
    const list = (this.topAssetsResource.value()?.data ?? []).slice(0, 5);
    const max = Math.max(...list.map((a) => Math.abs(a.pnl)), 1);
    return list.map((a) => ({ ...a, barPct: (Math.abs(a.pnl) / max) * 100 }));
  });

  /** Profit factor : valeur 2 décimales, ∞ si aucune perte, - si aucune donnée. */
  protected readonly profitFactorDisplay = computed(() => {
    const pf = this.summary()?.profitFactor;
    if (pf == null) return (this.summary()?.totalTrades ?? 0) > 0 ? '∞' : '-';
    return pf.toFixed(2);
  });

  protected readonly drawdownDisplay = computed(() => {
    const dd = this.summary()?.maxDrawdown ?? 0;
    return dd > 0 ? -dd : dd;
  });
  protected readonly pnlColor = computed(() => {
    const pnl = this.summary()?.totalPnl ?? 0;
    return pnl === 0 ? 'var(--text-2)' : pnl > 0 ? 'var(--green)' : 'var(--red)';
  });
  protected readonly winRateColor = computed(() =>
    (this.summary()?.winRate ?? 0) === 0 ? 'var(--text-2)' : 'var(--blue-bright)',
  );
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
  protected readonly capitalDisplay = computed(() => {
    const capital  = this.currentCapital();
    const rate     = this.userStore.user()?.currencyRate ?? 1;
    const currency = this.userStore.user()?.currency ?? 'USD';
    const symbol   = currency === 'EUR' ? '€' : '$';
    return `${symbol}${Math.abs(capital * rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  });
  protected readonly capitalPct = computed(() => {
    const start = this.baseCapital();
    return start <= 0 ? 0 : ((this.summary()?.totalPnl ?? 0) / start) * 100;
  });
  /** Sous-titre courbe d'équité : « +$X sur 3 mois · base $Y » (période courante). */
  protected readonly equitySub = computed(() => {
    const base   = this.baseCapital();
    const period = this.summary()?.totalPnl ?? 0;
    const sym    = (this.userStore.user()?.currency ?? 'USD') === 'EUR' ? '€' : '$';
    const fmt    = (n: number) => `${sym}${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
    return `${period >= 0 ? '+' : '−'}${fmt(period)} ${this.periodShort()} · base ${fmt(base)}`;
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
  protected readonly capitalColor = computed(() => {
    const start = this.baseCapital();
    if (start <= 0) return 'var(--text-2)';
    const pnl = this.summary()?.totalPnl ?? 0;
    return pnl === 0 ? 'var(--text-2)' : pnl > 0 ? 'var(--green)' : 'var(--red)';
  });
  protected readonly drawdownColor = computed(() =>
    (this.summary()?.maxDrawdown ?? 0) === 0 ? 'var(--text-2)' : 'var(--red)',
  );
  protected readonly equityCurve = computed(
    () => this.equityCurveResource.value()?.data?.points ?? [],
  );
  protected readonly bySetup = computed(() => this.bySetupResource.value()?.data ?? []);
  // Top 4 setups réellement utilisés (win rate défini) pour le widget « Win Rate / stratégie ».
  protected readonly topSetups = computed(() =>
    this.bySetup().filter((s) => s.winRate !== null).slice(0, 4),
  );
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

  protected readonly emotionPie = computed(() => {
    const stats = this.emotionStats();
    if (!stats.length) return { gradient: '', slices: [] as { emotion: string; pct: number; x: number; y: number; show: boolean }[] };
    const total = stats.reduce((s, e) => s + e.pct, 0) || 1;
    const R = 32;            // rayon (% du conteneur) où poser les labels
    let cum = 0;
    const stops: string[] = [];
    const slices = stats.map((e) => {
      const frac = e.pct / total;
      const start = cum;
      const end = cum + frac;
      cum = end;
      const color = EMOTION_COLORS[e.emotion] ?? '#6b7280';
      stops.push(`${color} ${(start * 100).toFixed(2)}% ${(end * 100).toFixed(2)}%`);
      const midRad = ((start + end) / 2) * 2 * Math.PI; // angle médian, 0 = haut, horaire
      return {
        emotion: e.emotion,
        pct: e.pct,
        x: 50 + R * Math.sin(midRad),
        y: 50 - R * Math.cos(midRad),
        show: e.pct >= 8,
      };
    });
    return { gradient: `conic-gradient(${stops.join(', ')})`, slices };
  });

  protected readonly emotionStats = computed(() => {
    const trades = this.tradesStore.trades();
    // Émotion effective (override sinon humeur de session) ; non renseignées exclues du total.
    const withEmotion = trades
      .map(t => t.effectiveEmotion ?? t.emotion)
      .filter((e): e is string => !!e);
    const total = withEmotion.length;
    if (!total) return [];
    return (['REVENGE', 'STRESSED', 'CONFIDENT', 'FOCUSED', 'FEAR', 'NEUTRAL', 'TIRED'] as const)
      .map(emotion => ({
        emotion,
        pct: Math.round((withEmotion.filter(e => e === emotion).length / total) * 100),
      }))
      .filter(e => e.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 4);
  });

  // ── Viz flagship (SVG/donuts dérivés des vraies données) ───────────────────
  protected readonly eqSeries = computed(() => this.equityCurve().map((p) => p.cumulativePnl));
  protected readonly capitalSeries = computed(() => {
    const b = this.baseCapital();
    return this.eqSeries().map((v) => b + v);
  });
  /** Drawdown courant (val − pic) le long de la courbe : série rouge des KPI. */
  protected readonly ddSeries = computed(() => {
    let peak = -Infinity;
    return this.eqSeries().map((v) => { peak = Math.max(peak, v); return v - peak; });
  });

  /** Sparkline (line + area) sur un viewBox w×h. */
  protected sparkPath(series: number[], w = 72, h = 42): { line: string; area: string; cx: number; cy: number } {
    if (series.length < 2) return { line: '', area: '', cx: 0, cy: 0 };
    const min = Math.min(...series), max = Math.max(...series), rng = max - min || 1;
    const step = w / (series.length - 1);
    const pts = series.map((v, i) => [i * step, h - 2 - ((v - min) / rng) * (h - 4)] as const);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return { line, area: `${line} L${w},${h} L0,${h} Z`, cx: last[0], cy: last[1] };
  }

  /** Courbe d'équité « glow » : line + area + point final, viewBox 660×230. */
  protected readonly equityGlow = computed(() => {
    const series = this.eqSeries();
    const W = 660, H = 230;
    if (series.length < 2) return null;
    const min = Math.min(...series), max = Math.max(...series), rng = max - min || 1;
    const step = W / (series.length - 1);
    const xy = series.map((v, i) => [i * step, H - 16 - ((v - min) / rng) * (H - 34)] as const);
    const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const last = xy[xy.length - 1];
    const positive = (this.summary()?.totalPnl ?? 0) >= 0;
    // Ligne de tendance pointillée (bas-gauche → point final), comme la maquette.
    const trend = `M0,${(H - 16).toFixed(1)} L${W},${last[1].toFixed(1)}`;
    return { line, area: `${line} L${W},${H} L0,${H} Z`, trend, lastX: last[0], lastY: last[1], W, H, color: positive ? 'var(--green)' : 'var(--red)' };
  });

  /** Donut « répartition stratégies » (conic-gradient + légende + centre best setup). */
  protected readonly setupsDonut = computed(() => {
    const setups = this.bySetup().filter((s) => s.count > 0).slice(0, 6);
    if (!setups.length) return null;
    const total = setups.reduce((s, x) => s + x.count, 0) || 1;
    let cum = 0;
    const stops: string[] = [];
    const legend = setups.map((s) => {
      const a = (cum / total) * 100; cum += s.count; const b = (cum / total) * 100;
      stops.push(`${s.color} ${a.toFixed(2)}% ${b.toFixed(2)}%`);
      return { label: s.title, color: s.color, pct: Math.round((s.count / total) * 100) };
    });
    const best = setups.reduce((a, b) => ((b.winRate ?? 0) > (a.winRate ?? 0) ? b : a), setups[0]);
    return { gradient: `conic-gradient(${stops.join(', ')})`, legend, centerValue: `${Math.round(best.winRate ?? 0)}%`, centerLabel: best.title };
  });

  /**
   * Donut « répartition stratégies » vue de base FREE : % des trades par setup,
   * calculé client-side depuis les trades chargés (by-setup = profondeur Premium).
   * Centre = setup dominant. La profondeur (win rate/rentabilité) reste Premium.
   */
  protected readonly setupsDonutFree = computed(() => {
    const trades = this.tradesStore.trades();
    if (!trades.length) return null;
    const map = new Map<string, { title: string; color: string; count: number }>();
    for (const t of trades) {
      const cur = map.get(t.setupId) ?? { title: t.setup?.title ?? '-', color: t.setup?.color ?? 'var(--text-3)', count: 0 };
      cur.count++;
      map.set(t.setupId, cur);
    }
    const setups = [...map.values()].sort((a, b) => b.count - a.count).slice(0, 6);
    const total = setups.reduce((s, x) => s + x.count, 0) || 1;
    let cum = 0;
    const stops: string[] = [];
    const legend = setups.map((s) => {
      const a = (cum / total) * 100; cum += s.count; const b = (cum / total) * 100;
      stops.push(`${s.color} ${a.toFixed(2)}% ${b.toFixed(2)}%`);
      return { label: s.title, color: s.color, pct: Math.round((s.count / total) * 100) };
    });
    const top = setups[0];
    return { gradient: `conic-gradient(${stops.join(', ')})`, legend, centerValue: `${Math.round((top.count / total) * 100)}%`, centerLabel: top.title };
  });

  /** Vue donut setups selon le plan : profondeur (win rate) en Premium, répartition % en FREE. */
  protected readonly setupsDonutView = computed(() =>
    this.userStore.isPremium() ? this.setupsDonut() : this.setupsDonutFree(),
  );

  /** Donut mini win rate (KPI). */
  protected readonly winRateDonut = computed(() => {
    const wr = Math.max(0, Math.min(100, this.summary()?.winRate ?? 0));
    return `conic-gradient(var(--blue) 0% ${wr}%, rgba(143,163,191,.18) ${wr}% 100%)`;
  });

  /**
   * Granularité des barres « P&L par jour » : pilotée par le NOMBRE de barres, pas par le nom
   * de la période : on vise ≤ 31 barres. jour (≤ 31 j) → semaine (≤ ~31 sem.) → mois (au-delà).
   * 1M = jour · 3M / 6M = semaine · Tout = mois.
   */
  protected readonly plGranularity = computed<'day' | 'week' | 'month'>(() => {
    const { from, to } = this.periodRange();
    if (!from) return 'month'; // ALL → mensuel
    const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    if (spanDays <= 31) return 'day';
    if (spanDays <= 31 * 7) return 'week';
    return 'month';
  });
  /** Titre dynamique du panneau selon la granularité (jamais trompeur). */
  protected readonly plTitle = computed(() =>
    this.plGranularity() === 'day' ? 'P&L par jour'
      : this.plGranularity() === 'week' ? 'P&L par semaine'
        : 'P&L par mois',
  );
  /** Info-bulle précisant l'agrégation (mtc-info-tooltip). */
  protected readonly plTooltip = computed(() => {
    switch (this.plGranularity()) {
      case 'day':
        return 'Chaque barre = le P&L net réalisé sur une journée (frais inclus). Les jours sans trade sont à plat.';
      case 'week':
        return 'La période est trop longue pour un affichage jour par jour : les barres sont agrégées par semaine ISO (lundi → dimanche, comme le journal). Chaque barre = le P&L net de la semaine.';
      default:
        return 'La période est trop longue pour un affichage plus fin : les barres sont agrégées par mois. Chaque barre = le P&L net du mois.';
    }
  });

  // Helpers de dates (front) : semaine ISO alignée sur le journal (PROMPT-170), pas de getDay() brut.
  private parseDay(dateStr: string): Date { return new Date(dateStr + 'T12:00:00'); }
  private atNoon(d: Date): Date { const c = new Date(d); c.setHours(12, 0, 0, 0); return c; }
  private isoDate(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  private frDate(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  /** Lundi de la semaine ISO d'une date : même définition que le journal ((getDay()+6)%7). */
  private mondayOf(d: Date): Date {
    const dow = (d.getDay() + 6) % 7; // lundi = 0 … dimanche = 6
    const m = new Date(d);
    m.setDate(d.getDate() - dow);
    return this.atNoon(m);
  }

  /**
   * Barres P&L par période : agrégées jour / semaine / mois selon `plGranularity`. Les jours
   * tradés viennent du back (P&L net déjà agrégé, BE gérés comme le journal) ; on pré-remplit
   * les buckets vides de la plage pour un axe continu (barres vides à plat). Vert gain / rouge perte.
   */
  protected readonly plBuckets = computed(() => {
    const days = this.activityResource.value()?.data?.days ?? null;
    if (days === null) return null;
    const gran = this.plGranularity();
    const { from, to } = this.periodRange();

    const pnlByDate = new Map<string, number>();
    for (const d of days) pnlByDate.set(d.date, d.pnl);

    const first = from ?? (days.length ? this.parseDay(days[0].date) : new Date(to));
    type Raw = { key: string; axisLabel: string; title: string; pnl: number; traded: boolean };
    const raw: Raw[] = [];

    if (gran === 'day') {
      const cur = this.atNoon(first);
      const end = this.atNoon(to);
      while (cur <= end) {
        const key = this.isoDate(cur);
        raw.push({ key, axisLabel: String(cur.getDate()), title: this.frDate(cur),
          pnl: pnlByDate.get(key) ?? 0, traded: pnlByDate.has(key) });
        cur.setDate(cur.getDate() + 1);
      }
    } else if (gran === 'week') {
      const map = new Map<string, { monday: Date; pnl: number; traded: boolean }>();
      const cur = this.mondayOf(this.atNoon(first));
      const end = this.atNoon(to);
      while (cur <= end) { // pré-remplit chaque semaine de la plage
        const key = this.isoDate(cur);
        if (!map.has(key)) map.set(key, { monday: new Date(cur), pnl: 0, traded: false });
        cur.setDate(cur.getDate() + 7);
      }
      for (const [date, pnl] of pnlByDate) {
        const monday = this.mondayOf(this.parseDay(date));
        const key = this.isoDate(monday);
        const b = map.get(key) ?? { monday, pnl: 0, traded: false };
        b.pnl += pnl; b.traded = true;
        map.set(key, b);
      }
      for (const [key, b] of [...map.entries()].sort(([a], [c]) => a.localeCompare(c))) {
        const sunday = new Date(b.monday); sunday.setDate(sunday.getDate() + 6);
        raw.push({ key, axisLabel: `${b.monday.getDate()}/${b.monday.getMonth() + 1}`,
          title: `Semaine du ${this.frDate(b.monday)} au ${this.frDate(sunday)}`, pnl: b.pnl, traded: b.traded });
      }
    } else {
      const map = new Map<string, { d: Date; pnl: number; traded: boolean }>();
      const cur = new Date(first.getFullYear(), first.getMonth(), 1);
      const end = new Date(to.getFullYear(), to.getMonth(), 1);
      while (cur <= end) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
        if (!map.has(key)) map.set(key, { d: new Date(cur), pnl: 0, traded: false });
        cur.setMonth(cur.getMonth() + 1);
      }
      for (const [date, pnl] of pnlByDate) {
        const d = this.parseDay(date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const b = map.get(key) ?? { d: new Date(d.getFullYear(), d.getMonth(), 1), pnl: 0, traded: false };
        b.pnl += pnl; b.traded = true;
        map.set(key, b);
      }
      for (const [key, b] of [...map.entries()].sort(([a], [c]) => a.localeCompare(c))) {
        raw.push({ key, axisLabel: b.d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
          title: b.d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), pnl: b.pnl, traded: b.traded });
      }
    }

    const maxAbs = Math.max(...raw.filter((b) => b.traded).map((b) => Math.abs(b.pnl)), 1);
    const fmt = (v: number) => {
      const a = Math.abs(v);
      return (v > 0 ? '+' : '−') + (a >= 1000 ? (a / 1000).toFixed(1).replace('.0', '') + 'k' : Math.round(a));
    };
    return raw.map((b) => {
      const mag = Math.min(1, Math.abs(b.pnl) / maxAbs);
      return {
        ...b, pos: b.pnl >= 0, mag,
        barPct: b.traded && b.pnl !== 0 ? 5 + mag * 42 : 0,
        label: b.traded && b.pnl !== 0 ? fmt(b.pnl) : '',
      };
    });
  });

  /** Donut états émotionnels (réutilise emotionPie + top état au centre). */
  protected readonly emotionsDonut = computed(() => {
    const stats = this.emotionStats();
    if (!stats.length) return null;
    return { gradient: this.emotionPie().gradient, centerValue: `${stats[0].pct}%`, centerLabel: stats[0].emotion };
  });

  /** Stats par émotion (R moyen / win rate) : source du feedback coach. */
  protected readonly byEmotion = computed(() => this.byEmotionResource.value()?.data ?? []);

  /**
   * Feedback « AI Coach » dérivé des VRAIES données (summary + émotions + setups) :
   * jamais de texte codé en dur. Chaque insight a un ton (good/warn/bad).
   */
  protected readonly coachInsights = computed(() => {
    const s = this.summary();
    if (!s || s.totalTrades === 0) return [];
    const lbl: Record<string, string> = {
      CONFIDENT: 'confiant', FOCUSED: 'concentré', NEUTRAL: 'neutre',
      STRESSED: 'stressé', FEAR: 'peur', REVENGE: 'revenge',
    };
    const out: { tone: 'good' | 'warn' | 'bad'; text: string }[] = [];

    if (s.winRate >= 50) out.push({ tone: 'good', text: `Ton win rate est de ${s.winRate.toFixed(0)}% ce mois, au-dessus de la barre des 50%.` });
    else out.push({ tone: 'warn', text: `Ton win rate est de ${s.winRate.toFixed(0)}% ce mois. Vise 50%+ en filtrant mieux tes setups.` });

    if (s.profitFactor != null) {
      if (s.profitFactor >= 1.5) out.push({ tone: 'good', text: `Profit factor de ${s.profitFactor.toFixed(2)} : tes gains couvrent largement tes pertes.` });
      else if (s.profitFactor < 1) out.push({ tone: 'bad', text: `Profit factor de ${s.profitFactor.toFixed(2)} : tu perds plus que tu ne gagnes. Resserre ton risque.` });
    }

    if (s.streak >= 3) out.push({ tone: 'good', text: `Série de ${s.streak} trades gagnants : garde ta taille, ne force pas le suivant.` });
    else if (s.streak <= -3) out.push({ tone: 'bad', text: `Série de ${Math.abs(s.streak)} pertes d'affilée. Coupe et fais une pause.` });

    const emos = this.byEmotion().filter((e) => e.count > 0);
    if (emos.length) {
      const best = emos.reduce((a, b) => ((b.avgRR ?? 0) > (a.avgRR ?? 0) ? b : a));
      const worst = emos.reduce((a, b) => ((b.avgRR ?? 0) < (a.avgRR ?? 0) ? b : a));
      if ((best.avgRR ?? 0) > 0) out.push({ tone: 'good', text: `Tu performes le mieux en état « ${lbl[best.emotion] ?? best.emotion} » (+${best.avgRR.toFixed(2)}R en moyenne).` });
      if ((worst.avgRR ?? 0) < 0) out.push({ tone: 'bad', text: `L'état « ${lbl[worst.emotion] ?? worst.emotion} » te coûte ${worst.avgRR.toFixed(2)}R en moyenne. Évite de trader ainsi.` });
    }

    const setups = this.bySetup().filter((x) => (x.count ?? 0) > 0 && x.winRate != null);
    if (setups.length) {
      const b = setups.reduce((a, c) => (c.winRate! > a.winRate! ? c : a));
      if (b.winRate! >= 55) out.push({ tone: 'good', text: `Ton setup « ${b.title} » affiche ${b.winRate!.toFixed(0)}% de réussite : c'est ton edge.` });
    }

    return out.slice(0, 5);
  });

  /**
   * Lignes du tableau « historique des trades » (vrais trades récents).
   * P&L % = rendement sur le capital de base ; `null` si ce capital est
   * inconnu/0 (sinon la division /1 produit des pourcentages absurdes → « - »).
   */
  protected readonly tradeRows = computed(() => {
    const base = this.baseCapital();
    return this.tradesStore.trades().slice(0, 8).map((t) => ({
      ...t,
      win: (t.pnl ?? 0) >= 0,
      pct: base > 0 ? ((t.pnl ?? 0) / base) * 100 : null,
    }));
  });

  protected readonly discordBannerDismissed = signal(
    localStorage.getItem('discord_banner_dismissed') === '1',
  );
  protected dismissDiscordBanner(): void {
    localStorage.setItem('discord_banner_dismissed', '1');
    this.discordBannerDismissed.set(true);
  }

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

  protected startTrial() {
    this.billingApi
      .checkout('premium_monthly')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { window.location.href = res.data.url; },
        error: (err) => this.toast.error(apiErrorMessage(err, 'Le paiement n’a pas pu démarrer. Réessaie dans un instant.')),
      });
  }
}