import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { EcoCalendarData } from '@app/core/api/eco-calendar.api';
import { MoodState, TradingSession, LiveStats, SessionTrade } from '@app/core/api/session.api';
import { CreateTradeDto, MarketContext, NewsItem } from '@app/core/api/trades.api';
import { MarketContextBarComponent } from '../market-context-bar/market-context-bar.component';
import { MoneyService } from '@app/core/services/money.service';
import { LiveNewsComponent } from './components/live-news/live-news.component';
import { LiveFeedComponent } from './components/live-feed/live-feed.component';
import { LiveEcoCalendarComponent } from './components/live-eco-calendar/live-eco-calendar.component';
import { QuickTradeComponent } from './components/quick-trade/quick-trade.component';
import { LivePropFirmComponent } from './components/live-prop-firm/live-prop-firm.component';
import { isLivePropAccount } from './components/live-prop-firm/live-prop-firm.util';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradovateStore } from '@app/core/stores/tradovate.store';

/**
 * Onglet « Session live » : cadre de la vue (CTA sans session, carte marché, mini-stats,
 * grille). Chaque panneau est un composant : calendrier éco, live feed, trade rapide, news.
 * Compte de la session synchronisé (Tradovate, éval ou funded) : le suivi prop firm prend la
 * place de Trade rapide, ses trades arrivant seuls ; « Saisir un trade à la main » le réaffiche.
 */
@Component({
  selector: 'mtc-session-live',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-live.component.css',
  imports: [
    MarketContextBarComponent, LiveNewsComponent, LiveFeedComponent, LiveEcoCalendarComponent,
    QuickTradeComponent, LivePropFirmComponent,
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
  }

  private readonly money = inject(MoneyService);
  private readonly accounts = inject(SelectedAccountStore);
  private readonly tradovate = inject(TradovateStore);

  /** Compte de la session si son suivi prop firm peut remplacer Trade rapide, sinon null. */
  protected readonly propFirmAccountId = computed(() => {
    const id = this.session()?.accountId;
    if (!id) return null;
    const account = this.accounts.accounts().find((a) => a.id === id);
    return isLivePropAccount(account, this.tradovate.byAccount().get(id)) ? id : null;
  });
  /** L'utilisateur a choisi « Saisir un trade à la main » : Trade rapide réaffiché. */
  protected readonly manualEntry = signal(false);

  protected readonly pnlDisplay = computed(() =>
    this.money.format(this.liveStats()?.totalPnl ?? 0, { decimals: 0 }),
  );

  protected moodEmoji(mood?: MoodState | null): string {
    const map: Record<string, string> = {
      CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', TIRED: '😰', STRESSED: '😰',
    };
    return map[mood ?? ''] ?? '😐';
  }
}
