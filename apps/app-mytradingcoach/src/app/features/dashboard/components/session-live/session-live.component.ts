import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { DialogDirective } from '@mtc/front-ui';
import { catchError, map, of } from 'rxjs';
import { EcoCalendarData } from '@app/core/api/eco-calendar.api';
import { MoodState, TradingSession, LiveStats, SessionTrade } from '@app/core/api/session.api';
import { CreateTradeDto, MarketContext, NewsItem, TradesApi } from '@app/core/api/trades.api';
import { MarketContextBarComponent } from '../market-context-bar/market-context-bar.component';
import { MoneyService } from '@app/core/services/money.service';
import { LiveNewsComponent } from './components/live-news/live-news.component';
import { QuickTradeComponent } from './components/quick-trade/quick-trade.component';
import { LivePropFirmComponent } from './components/live-prop-firm/live-prop-firm.component';
import { isLivePropAccount } from './components/live-prop-firm/live-prop-firm.util';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradovateStore } from '@app/core/stores/tradovate.store';
import { UserStore } from '@app/core/stores/user.store';
import { LivePositionComponent } from './components/live-position/live-position.component';
import { LIVE_POSITION_ROLES, laggingBrokerPanel, liveTotals } from './components/live-position/live-position.util';
import { LiveBarComponent } from './components/live-bar/live-bar.component';
import { LiveNextEventComponent } from './components/live-next-event/live-next-event.component';
import { LiveClosedTradesComponent } from './components/live-closed-trades/live-closed-trades.component';
import { SessionStore } from '@app/core/stores/session.store';
import { bannerTickers, moodLabel, planKindShort } from './session-live.util';

/**
 * Onglet « Session live » v3 (#593, retours de Val : « trop chargée, on se perd ») : l'essentiel
 * d'abord, mobile d'abord. Bandeau collant (chrono, P&L total du jour, trades N / max), prochaine
 * annonce, trade en cours, suivi du compte, trades clôturés ; le contexte marché et les news
 * passent dans une feuille « Contexte ». Compte de la session synchronisé (Tradovate, éval ou
 * funded) : ses trades arrivent seuls, « Saisir un trade à la main » ouvre Trade rapide ; sinon
 * Trade rapide reste affiché (seul moyen de logger un trade).
 */
@Component({
  selector: 'mtc-session-live',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-live.component.css',
  imports: [
    MarketContextBarComponent, LiveNewsComponent, QuickTradeComponent, LivePropFirmComponent,
    LivePositionComponent, LiveBarComponent, LiveNextEventComponent, LiveClosedTradesComponent,
    RouterLink, DialogDirective,
  ],
  templateUrl: './session-live.component.html',
})
export class SessionLiveComponent {
  readonly session = input<TradingSession | null>(null);
  readonly todayTrades = input<SessionTrade[]>([]);
  readonly liveStats = input<LiveStats | null>(null);
  readonly ecoCalendar = input<EcoCalendarData | null>(null);
  readonly marketCtx = input<MarketContext | null>(null);
  readonly newsItems = input<NewsItem[]>([]);
  readonly breakingNews = input<string | null>(null);
  readonly triggerCloseModal = input<boolean>(false);
  /** Désactive le CTA « Démarrer » tant qu'aucun compte précis n'est choisi (règle 1 session = 1 compte). */
  readonly startDisabled = input<boolean>(false);

  readonly startSession = output<void>();
  readonly tradeClosed = output<{ tradeId: string; exitPrice: number }>();
  readonly sessionClosed = output<{ mood: MoodState; note?: string; question?: string | null }>();
  readonly tradeLogged = output<CreateTradeDto>();
  readonly ecoCalendarRefreshed = output<EcoCalendarData>();
  readonly goToDebrief = output<void>();
  /** « Clôturer la session » : le parent ouvre sa confirmation. */
  readonly closeSession = output<void>();

  // News live + contexte marché = IA mutualisée → FREE, accessible à tous.

  constructor() {
    // triggerCloseModal → naviguer vers l'onglet Débrief
    effect(() => {
      if (this.triggerCloseModal()) {
        this.goToDebrief.emit();
      }
    });

    // WebSocket éco : connecté/déconnecté par SessionStore selon l'état de la session (SCA-B4-03),
    // quelle que soit la page : il porte aussi le contexte marché poussé.

    // Le suivi prop firm dépend des connexions Tradovate, chargées jusqu'ici par « Mes comptes »
    // seulement : en ouverture directe ou après F5, le bloc restait masqué (#437).
    if (!this.tradovate.loaded()) this.tradovate.load();

    // « Trade en cours » et « Suivi du compte » affichés ensemble : le plus en retard des deux est
    // relu dès que l'autre a un relevé broker plus récent, pour qu'ils montrent le même latent.
    effect(() => {
      const id = this.propFirmAccountId();
      if (!id || !this.showLivePosition()) return;
      const liveAt = this.liveStats()?.broker?.openPnlAt;
      const accountAt = this.accounts.accounts().find((a) => a.id === id)?.metrics?.broker?.equityAt;
      const lagging = laggingBrokerPanel(liveAt, accountAt);
      // Une seule relecture par écart : si elle ne le comble pas (relevé pas encore écrit), pas de boucle.
      const gap = `${liveAt}|${accountAt}`;
      if (!lagging || gap === this.lastBrokerGap) return;
      this.lastBrokerGap = gap;
      untracked(() => {
        if (lagging === 'account') this.accounts.reloadSoon();
        else if (lagging === 'live') this.sessionStore.refreshLiveSoon();
      });
    });
  }

  private readonly money = inject(MoneyService);
  private readonly accounts = inject(SelectedAccountStore);
  private readonly tradovate = inject(TradovateStore);
  private readonly userStore = inject(UserStore);
  protected readonly sessionStore = inject(SessionStore);
  private lastBrokerGap: string | null = null;

  /** Table des valeurs du point (barre SL/TP, prix au relevé) : une lecture, repli vide. */
  protected readonly instruments = toSignal(
    inject(TradesApi).getInstruments().pipe(map((r) => r.data ?? []), catchError(() => of([]))),
    { initialValue: [] },
  );

  /** Position broker (bêta) : compte de la session synchronisé par API, rôle de test. */
  protected readonly showLivePosition = computed(() => {
    const role = this.userStore.user()?.role;
    return !!role && LIVE_POSITION_ROLES.includes(role) && !!this.liveStats()?.broker;
  });
  protected readonly broker = computed(() => (this.showLivePosition() ? this.liveStats()?.broker ?? null : null));

  /** Compte de la session si son suivi prop firm peut remplacer Trade rapide, sinon null. */
  protected readonly propFirmAccountId = computed(() => {
    const id = this.session()?.accountId;
    if (!id) return null;
    const account = this.accounts.accounts().find((a) => a.id === id);
    return isLivePropAccount(account, this.tradovate.byAccount().get(id)) ? id : null;
  });
  /** L'utilisateur a choisi « Saisir un trade à la main » : Trade rapide affiché sous les trades. */
  protected readonly manualEntry = signal(false);
  /** Feuille « Contexte marché » (tickers + news) ouverte. */
  protected readonly contextOpen = signal(false);

  protected readonly openTrades = computed(() => this.todayTrades().filter((t) => t.pnl === null));

  /** P&L du jour : réalisé (MTC) + latent (broker), total null si le latent est inconnu. */
  protected readonly totals = computed(() => liveTotals(this.liveStats()?.totalPnl ?? 0, this.broker()));
  protected readonly dayPnl = computed(() => this.totals().total ?? this.totals().realized);
  protected readonly tradesMax = computed(() => this.userStore.user()?.tradesPerDayMax ?? null);

  /** Bandeau PC : « Apex 50k · EOD », humeur déclarée, contexte marché réduit. */
  protected readonly accountLabel = computed(() => {
    const a = this.accounts.accounts().find((x) => x.id === this.session()?.accountId);
    if (!a) return null;
    const kind = planKindShort(a.metrics?.drawdown?.rule?.kind);
    return kind ? `${a.label} · ${kind}` : a.label;
  });
  protected readonly mood = computed(() => moodLabel(this.session()?.moodStart));
  protected readonly tickers = computed(() => bannerTickers(this.marketCtx()));

  protected readonly pnlDisplay = computed(() =>
    this.money.formatFor(this.session()?.accountId, this.dayPnl(), { decimals: 0, sign: true }),
  );
}
