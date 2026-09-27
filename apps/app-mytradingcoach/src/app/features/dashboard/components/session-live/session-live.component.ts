import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { EcoCalendarData } from '../../../../core/api/eco-calendar.api';
import { MoodState, TradingSession, LiveStats, SessionTrade } from '../../../../core/api/session.api';
import { CreateTradeDto, MarketContext, NewsItem } from '../../../../core/api/trades.api';
import { MarketContextBarComponent } from '../market-context-bar/market-context-bar.component';
import { EcoSocketService } from '../../../../core/services/eco-socket.service';
import { MoneyService } from '../../../../core/services/money.service';
import { LiveNewsComponent } from './components/live-news/live-news.component';
import { LiveFeedComponent } from './components/live-feed/live-feed.component';
import { LiveEcoCalendarComponent } from './components/live-eco-calendar/live-eco-calendar.component';
import { QuickTradeComponent } from './components/quick-trade/quick-trade.component';

/**
 * Onglet « Session live » : cadre de la vue (CTA sans session, carte marché, mini-stats,
 * grille). Chaque panneau est un composant : calendrier éco, live feed, trade rapide, news.
 */
@Component({
  selector: 'mtc-session-live',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-live.component.css',
  imports: [MarketContextBarComponent, LiveNewsComponent, LiveFeedComponent, LiveEcoCalendarComponent, QuickTradeComponent],
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

  private readonly ecoSocket = inject(EcoSocketService);

  // News live + contexte marché = IA mutualisée → FREE, accessible à tous.

  constructor() {
    // triggerCloseModal → naviguer vers l'onglet Débrief
    effect(() => {
      if (this.triggerCloseModal()) {
        this.goToDebrief.emit();
      }
    });

    // WebSocket éco : connecter quand session active (analyse IA éco = IA mutualisée → FREE).
    // Reste ici et non dans le calendrier : c'est l'état de la session qui décide, y compris
    // la déconnexion quand elle se termine (le calendrier n'existe alors plus).
    effect(() => {
      const s = this.session();
      if (s?.status === 'ACTIVE') {
        this.ecoSocket.connect();
      } else {
        this.ecoSocket.disconnect();
      }
    });
  }

  private readonly money = inject(MoneyService);

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
