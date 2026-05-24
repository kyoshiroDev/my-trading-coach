import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { EcoCalendarData, EcoResultAnalysis } from '../../../../core/api/eco-calendar.api';
import { MoodState, TradingSession, LiveStats, SessionTrade } from '../../../../core/api/session.api';
import { CreateTradeDto } from '../../../../core/api/trades.api';
import { SessionRecapComponent } from '../session-recap/session-recap.component';

const MOODS: { value: MoodState; label: string; emoji: string }[] = [
  { value: 'CONFIDENT', label: 'Confiant', emoji: '😎' },
  { value: 'FOCUSED',   label: 'Focalisé', emoji: '🎯' },
  { value: 'NEUTRAL',   label: 'Neutre',   emoji: '😐' },
  { value: 'TIRED',     label: 'Fatigué',  emoji: '😰' },
];

const EMOTIONS = [
  { value: 'CONFIDENT', emoji: '😎', title: 'Confiant' },
  { value: 'FOCUSED',   emoji: '🎯', title: 'Focalisé' },
  { value: 'NEUTRAL',   emoji: '😐', title: 'Neutre' },
  { value: 'STRESSED',  emoji: '😰', title: 'Stressé' },
  { value: 'FEAR',      emoji: '😨', title: 'Peur' },
  { value: 'REVENGE',   emoji: '🤬', title: 'Revenge' },
] as const;

@Component({
  selector: 'mtc-session-live',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-live.component.css',
  imports: [SessionRecapComponent],
  template: `
    <div data-testid="session-live-view">

      <!-- Recap post-clôture -->
      @if (showRecap()) {
        <mtc-session-recap
          [session]="session()"
          [liveStats]="liveStats()"
          (dismissed)="onRecapClose($event)"
        />
      }

      @if (!showRecap()) {

      @if (!session() || session()?.status !== 'ACTIVE') {
        <!-- Pas de session active : CTA démarrer -->
        <div class="no-session-cta">
          <div class="no-session-icon">🎯</div>
          <div class="no-session-title">Pas de session en cours</div>
          <div class="no-session-sub">Démarre une session pour tracker tes trades en live et accéder au calendrier économique.</div>
          <button class="session-start-btn" data-testid="start-session-live" (click)="startSession.emit()">
            Démarrer la session →
          </button>
        </div>
      } @else {

      <!-- Barre session active -->
      <div class="session-active-bar">
        <div class="pulse-dot"></div>
        <span class="session-timer">{{ elapsed() }}</span>
        <span style="font-size:12px;color:var(--text-3);">
          Session en cours · {{ moodEmoji(session()?.moodStart) }}
        </span>
        <span style="font-size:12px;color:var(--text-2);">
          Trades : <strong style="color:var(--text)">{{ liveStats()?.tradesCount ?? 0 }}</strong>
        </span>
        <span class="session-pnl" [style.color]="pnlColor()">
          {{ pnlDisplay() }}
        </span>
        <button
          class="session-stop-btn"
          data-testid="close-session"
          (click)="closeMoodOpen.set(true)"
        >Clôturer session</button>
      </div>

      <!-- Mini stats row -->
      <div class="mini-stats-row">
        <div class="mini-stat">
          <div class="mini-stat-val" [class.green]="(liveStats()?.totalPnl ?? 0) >= 0" [class.red]="(liveStats()?.totalPnl ?? 0) < 0">
            {{ pnlDisplay() }}
          </div>
          <div class="mini-stat-lbl">P&amp;L jour</div>
        </div>
        <div class="mini-stat">
          <div class="mini-stat-val">{{ (liveStats()?.winRate ?? 0).toFixed(0) }}%</div>
          <div class="mini-stat-lbl">Win Rate</div>
        </div>
        <div class="mini-stat">
          <div class="mini-stat-val" style="font-size:22px;">{{ moodEmoji(session()?.moodStart) }}</div>
          <div class="mini-stat-lbl">État actuel</div>
        </div>
        <div class="mini-stat">
          <div class="mini-stat-val blue">{{ liveStats()?.tradesCount ?? 0 }}</div>
          <div class="mini-stat-lbl">Trades logués</div>
        </div>
      </div>

      <!-- Live layout 3 colonnes -->
      <div class="live-layout">

        <!-- COL 1 : LIVE FEED -->
        <div class="card" style="padding:14px;" data-testid="live-feed">
          <div class="card-header" style="margin-bottom:10px;">
            <div class="card-title" style="font-size:12px;display:flex;align-items:center;gap:6px;">
              Live feed
              <div class="pulse-dot"></div>
              <span class="badge-beta">BÊTA</span>
            </div>
          </div>

          @if (todayTrades().length === 0) {
            <div class="empty-feed">
              <div class="empty-feed-icon">📋</div>
              <div class="empty-feed-title">Aucun trade loggué</div>
              <div class="empty-feed-sub">
                Utilise le formulaire →<br>
                Asset + direction + émotion suffisent
              </div>
            </div>
          } @else {
            <div class="feed-header">
              <span class="feed-col-lbl">H.</span>
              <span></span>
              <span class="feed-col-lbl">Actif</span>
              <span class="feed-col-lbl">Entry</span>
              <span class="feed-col-lbl">Exit</span>
              <span class="feed-col-lbl">P&amp;L</span>
              <span></span>
            </div>

            @for (trade of todayTrades(); track trade.id) {
              <!-- Trade clôturé -->
              @if (trade.pnl !== null) {
                <div class="feed-row">
                  <span class="feed-time">{{ tradeTime(trade.tradedAt) }}</span>
                  <span class="trade-side" [class]="trade.side.toLowerCase()">{{ trade.side }}</span>
                  <span class="feed-asset">{{ trade.asset }}</span>
                  <span class="feed-price">{{ trade.entry }}</span>
                  <span class="feed-price">{{ trade.exit ?? '—' }}</span>
                  <span class="feed-pnl" [class.green]="trade.pnl >= 0" [class.red]="trade.pnl < 0">
                    {{ trade.pnl >= 0 ? '+' : '' }}{{ trade.pnl.toFixed(0) }}$
                  </span>
                  <span class="feed-badge" [class]="closeBadgeClass(trade.tags)">
                    {{ closeBadgeLabel(trade.tags) }}
                  </span>
                </div>
              } @else {
                <!-- Trade LIVE (ouvert) -->
                <div
                  class="feed-row live-row"
                  role="button"
                  tabindex="0"
                  (click)="openClosePanel(trade.id)"
                  (keyup.enter)="openClosePanel(trade.id)"
                >
                  <span class="feed-time">—</span>
                  <span class="trade-side" [class]="trade.side.toLowerCase()">{{ trade.side }}</span>
                  <span class="feed-asset">{{ trade.asset }}</span>
                  <span class="feed-price">{{ trade.entry }}</span>
                  <span class="feed-price" style="color:var(--text-3);">—</span>
                  <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-3);">En cours</span>
                  <span class="live-tag">● LIVE</span>
                </div>

                <!-- Panel clôture -->
                @if (closingTradeId() === trade.id) {
                  <div class="close-panel" data-testid="trade-close-panel">
                    <div class="close-panel-title">
                      {{ trade.side }} {{ trade.asset }} · Clôture
                    </div>
                    <div class="close-panel-row">
                      <div class="close-input-wrap">
                        <div class="close-input-lbl">PRIX DE SORTIE</div>
                        <input
                          class="close-input"
                          type="number"
                          placeholder="0.00"
                          data-testid="trade-exit-price"
                          [value]="exitPriceInput()"
                          (input)="exitPriceInput.set($any($event.target).value)"
                        />
                      </div>
                      <button class="close-btn-ok" (click)="submitClose()">OK →</button>
                      <button class="close-btn-cancel" (click)="cancelClose()">✕</button>
                    </div>
                    @if (exitPriceInput()) {
                      <div data-testid="trade-close-type" style="margin-top:6px;font-size:10px;color:var(--text-3);font-family:var(--font-mono);">
                        → {{ detectCloseType(trade, +exitPriceInput()) }}
                      </div>
                    }
                  </div>
                }
              }
            }
          }
        </div>

        <!-- COL 2 : CALENDRIER LIVE -->
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div class="card-title" style="font-size:12px;display:flex;align-items:center;gap:6px;">
              📅 Calendrier — Session en cours
              <div class="pulse-dot"></div>
              <span class="badge-beta">BÊTA</span>
            </div>
            <span class="ai-badge">AI</span>
          </div>

          @if (!ecoCalendar()) {
            <div style="font-size:12px;color:var(--text-3);text-align:center;padding:20px 0;">
              Calendrier disponible en Premium
            </div>
          } @else {
            <div style="display:flex;flex-direction:column;gap:6px;">
              @for (event of ecoCalendar()!.events; track event.name) {
                <div
                  class="eco-live-event"
                  [class.released]="event.isReleased"
                  [class.dim]="!event.isReleased && isOutsideSession(event.time)"
                >
                  <div class="eco-live-header">
                    <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-3);width:36px;flex-shrink:0;">
                      {{ formatTime(event.time) }}
                    </span>
                    <div style="width:4px;height:22px;border-radius:2px;flex-shrink:0;" [style.background]="event.impact === 'high' ? 'var(--red)' : 'var(--yellow)'"></div>
                    <span style="font-size:11px;font-weight:600;color:var(--text);flex:1;">{{ event.name }}</span>
                    <span style="font-size:9px;background:var(--blue-glow);color:var(--blue-bright);border:1px solid rgba(59,130,246,.2);padding:2px 5px;border-radius:4px;font-family:var(--font-mono);">
                      {{ event.currency }}
                    </span>
                    @if (event.isReleased) {
                      <span style="font-size:9px;background:var(--green-dim);color:var(--green);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);">✓ Publié</span>
                    } @else {
                      <span style="font-size:9px;color:var(--text-3);font-family:var(--font-mono);">dans {{ minutesUntil(event.time) }} min</span>
                    }
                  </div>

                  @if (event.isReleased) {
                    <div class="eco-live-released">
                      <div class="eco-result-row">
                        <div class="eco-result-item">
                          <span>Résultat</span>
                          <span class="eco-result-val green">{{ event.actual }}</span>
                        </div>
                        @if (event.estimate !== null) {
                          <div class="eco-result-item">
                            <span>Prévu</span>
                            <span class="eco-result-val" style="color:var(--text-2);">{{ event.estimate }}</span>
                          </div>
                        }
                        @if (event.previous !== null) {
                          <div class="eco-result-item">
                            <span>Précédent</span>
                            <span class="eco-result-val" style="color:var(--text-2);">{{ event.previous }}</span>
                          </div>
                        }
                        @if (event.actual !== null && event.estimate !== null) {
                          <div class="eco-result-item">
                            <span>Surprise</span>
                            <span class="eco-result-val" [class.green]="(event.actual - event.estimate) > 0">
                              {{ event.actual - event.estimate > 0 ? '+' : '' }}{{ (event.actual - event.estimate).toFixed(2) }} {{ event.actual > event.estimate ? '▲' : '▼' }}
                            </span>
                          </div>
                        }
                      </div>

                      @if (getEventAnalysis(event.name)) {
                        <div class="eco-ai-block-sm">
                          <span style="font-size:13px;flex-shrink:0;">✦</span>
                          <span>{{ getEventAnalysis(event.name)!.interpretation }}</span>
                        </div>
                        <div class="sentiment-chips">
                          @for (s of getEventAnalysis(event.name)!.assetSentiments; track s.asset) {
                            <div class="chip" [class]="s.sentiment">
                              {{ s.sentiment === 'bull' ? '▲' : s.sentiment === 'bear' ? '▼' : '—' }}
                              {{ s.asset }} {{ s.sentiment.toUpperCase() }}
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>

        <!-- COL 3 : TRADE RAPIDE -->
        <div class="qt-panel" data-testid="quick-trade-form">
          <div class="qt-title">
            ⚡ Trade rapide
            <span class="badge-beta">BÊTA</span>
          </div>

          <div>
            <div class="qt-lbl">ACTIF</div>
            <input
              class="qt-input"
              placeholder="NQ, BTC/USDT..."
              data-testid="quick-trade-asset"
              [value]="qtAsset()"
              (input)="qtAsset.set($any($event.target).value)"
            />
          </div>

          <div>
            <div class="qt-lbl">DIRECTION</div>
            <div class="qt-sides">
              <button
                class="qt-side lng"
                [class.sel]="qtSide() === 'LONG'"
                data-testid="quick-trade-long"
                (click)="qtSide.set('LONG')"
              >▲ LONG</button>
              <button
                class="qt-side sht"
                [class.sel]="qtSide() === 'SHORT'"
                data-testid="quick-trade-short"
                (click)="qtSide.set('SHORT')"
              >▼ SHORT</button>
            </div>
          </div>

          <div>
            <div class="qt-lbl">ÉMOTION</div>
            <div class="qt-emos">
              @for (emo of emotions; track emo.value) {
                <div
                  class="qt-emo"
                  [class.sel]="qtEmotion() === emo.value"
                  [title]="emo.title"
                  role="button"
                  tabindex="0"
                  (click)="qtEmotion.set(emo.value)"
                  (keyup.enter)="qtEmotion.set(emo.value)"
                >{{ emo.emoji }}</div>
              }
            </div>
          </div>

          <div class="qt-divider"></div>
          <div class="qt-optional-lbl">OPTIONNEL</div>

          <div class="qt-pnl-row">
            <div>
              <div class="qt-lbl">ENTRY</div>
              <input
                class="qt-input"
                type="number"
                placeholder="0.00"
                style="font-size:12px;"
                [value]="qtEntry()"
                (input)="qtEntry.set($any($event.target).value)"
              />
            </div>
            <div>
              <div class="qt-lbl">QUANTITÉ</div>
              <input
                class="qt-input"
                type="number"
                placeholder="1"
                style="font-size:12px;"
                [value]="qtQty()"
                (input)="qtQty.set($any($event.target).value)"
              />
            </div>
          </div>

          <div class="qt-pnl-row">
            <div>
              <div class="qt-lbl" style="color:rgba(239,68,68,.7);">STOP LOSS</div>
              <input
                class="qt-input qt-sl-input"
                type="number"
                placeholder="0.00"
                style="font-size:12px;"
                [value]="qtSl()"
                (input)="qtSl.set($any($event.target).value)"
              />
            </div>
            <div>
              <div class="qt-lbl" style="color:rgba(16,185,129,.7);">TAKE PROFIT</div>
              <input
                class="qt-input qt-tp-input"
                type="number"
                placeholder="0.00"
                style="font-size:12px;"
                [value]="qtTp()"
                (input)="qtTp.set($any($event.target).value)"
              />
            </div>
          </div>

          <button
            class="qt-log"
            data-testid="quick-trade-submit"
            [disabled]="!canSubmitQuickTrade()"
            (click)="submitQuickTrade()"
          >⚡ Logger ce trade</button>
          <div class="qt-hint">Asset + direction + émotion suffisent</div>
        </div>

      </div>

      } <!-- /if session ACTIVE -->
      } <!-- /if (!showRecap) -->

      <!-- Modal clôture session -->
      @if (closeMoodOpen()) {
        <div class="close-session-panel" role="button" tabindex="0"
          (click)="closeMoodOpen.set(false)"
          (keyup.escape)="closeMoodOpen.set(false)">
          <div class="close-session-modal" tabindex="-1"
            (click)="$event.stopPropagation()"
            (keydown)="$event.stopPropagation()">
            <div class="csm-title">Clôturer la session</div>
            <div class="csm-sub">Comment tu te sens en fin de session ?</div>
            <div class="mood-row">
              @for (mood of moods; track mood.value) {
                <button
                  class="mood-btn"
                  [class.sel]="closeMood() === mood.value"
                  (click)="closeMood.set(mood.value)"
                >{{ mood.emoji }} {{ mood.label }}</button>
              }
            </div>
            <div class="csm-actions">
              <button class="csm-cancel" (click)="closeMoodOpen.set(false)">Annuler</button>
              <button class="csm-confirm" (click)="confirmCloseSession()">Clôturer →</button>
            </div>
          </div>
        </div>
      }

    </div>
  `,
})
export class SessionLiveComponent {
  readonly session = input<TradingSession | null>(null);
  readonly todayTrades = input<SessionTrade[]>([]);
  readonly liveStats = input<LiveStats | null>(null);
  readonly ecoCalendar = input<EcoCalendarData | null>(null);

  readonly startSession = output<void>();
  readonly tradeClosed = output<{ tradeId: string; exitPrice: number }>();
  readonly sessionClosed = output<{ mood: MoodState; note?: string }>();
  readonly tradeLogged = output<CreateTradeDto>();

  private readonly destroyRef = inject(DestroyRef);

  // Timer
  private readonly now = signal(new Date());
  private readonly startTime = signal<Date | null>(null);

  protected readonly elapsed = computed(() => {
    const start = this.startTime();
    const now = this.now();
    if (!start) return '00:00:00';
    const diff = Math.floor((now.getTime() - start.getTime()) / 1000);
    const h = Math.floor(diff / 3600).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
    const s = (diff % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  });

  // Close trade panel
  protected readonly closingTradeId = signal<string | null>(null);
  protected readonly exitPriceInput = signal('');

  // Close session
  protected readonly closeMoodOpen = signal(false);
  protected readonly closeMood = signal<MoodState>('NEUTRAL');
  protected readonly showRecap = signal(false);

  // Quick trade form
  protected readonly qtAsset = signal('');
  protected readonly qtSide = signal<'LONG' | 'SHORT'>('LONG');
  protected readonly qtEmotion = signal<'CONFIDENT' | 'STRESSED' | 'REVENGE' | 'FEAR' | 'FOCUSED' | 'NEUTRAL'>('CONFIDENT');
  protected readonly qtEntry = signal('');
  protected readonly qtQty = signal('1');
  protected readonly qtSl = signal('');
  protected readonly qtTp = signal('');

  // Eco results cache
  private readonly ecoResults = signal<Record<string, EcoResultAnalysis>>({});

  protected readonly moods = MOODS;
  protected readonly emotions = EMOTIONS;

  constructor() {
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(new Date()));

    effect(() => {
      const s = this.session();
      if (s?.startedAt && s.status === 'ACTIVE') {
        this.startTime.set(new Date(s.startedAt));
      } else {
        this.startTime.set(null);
      }
    });
  }

  protected readonly pnlDisplay = computed(() => {
    const pnl = this.liveStats()?.totalPnl ?? 0;
    return `${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}$`;
  });

  protected readonly pnlColor = computed(() => {
    const pnl = this.liveStats()?.totalPnl ?? 0;
    if (pnl === 0) return 'var(--text-2)';
    return pnl > 0 ? 'var(--green)' : 'var(--red)';
  });

  protected readonly canSubmitQuickTrade = computed(
    () => this.qtAsset().trim().length > 0,
  );

  protected moodEmoji(mood?: MoodState | null): string {
    const map: Record<string, string> = {
      CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', TIRED: '😰', STRESSED: '😰',
    };
    return map[mood ?? ''] ?? '😐';
  }

  protected tradeTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  protected closeBadgeClass(tags: string[]): string {
    if (tags.includes('TP')) return 'tp';
    if (tags.includes('SL')) return 'sl';
    return 'manual';
  }

  protected closeBadgeLabel(tags: string[]): string {
    if (tags.includes('TP')) return 'TP';
    if (tags.includes('SL')) return 'SL';
    return '—';
  }

  protected isOutsideSession(time: string): boolean {
    const h = parseInt(time.split(':')[0] ?? '0', 10);
    return h >= 16;
  }

  protected formatTime(iso: string): string {
    if (!iso) return '—';
    if (iso.includes('T')) {
      const d = new Date(iso);
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    return iso.slice(0, 5);
  }

  protected minutesUntil(time: string): number {
    const now = new Date();
    const h = parseInt(time.split(':')[0] ?? '0', 10);
    const min = parseInt(time.split(':')[1] ?? '0', 10);
    const eventMin = h * 60 + min;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return Math.max(0, eventMin - nowMin);
  }

  protected getEventAnalysis(eventName: string): EcoResultAnalysis | null {
    return this.ecoResults()[eventName] ?? null;
  }

  protected openClosePanel(tradeId: string): void {
    if (this.closingTradeId() === tradeId) {
      this.cancelClose();
    } else {
      this.closingTradeId.set(tradeId);
      this.exitPriceInput.set('');
    }
  }

  protected cancelClose(): void {
    this.closingTradeId.set(null);
    this.exitPriceInput.set('');
  }

  protected submitClose(): void {
    const tradeId = this.closingTradeId();
    const exitPrice = parseFloat(this.exitPriceInput());
    if (!tradeId || isNaN(exitPrice) || exitPrice <= 0) return;
    this.tradeClosed.emit({ tradeId, exitPrice });
    this.cancelClose();
  }

  protected detectCloseType(trade: SessionTrade, exitPrice: number): string {
    if (trade.stopLoss !== null) {
      const isSl = trade.side === 'LONG' ? exitPrice <= trade.stopLoss : exitPrice >= trade.stopLoss;
      if (isSl) return 'SL détecté';
    }
    if (trade.takeProfit !== null) {
      const isTp = trade.side === 'LONG' ? exitPrice >= trade.takeProfit : exitPrice <= trade.takeProfit;
      if (isTp) return 'TP détecté';
    }
    return 'Clôture manuelle';
  }

  protected confirmCloseSession(): void {
    this.closeMoodOpen.set(false);
    this.showRecap.set(true);
  }

  protected onRecapClose(note: string | undefined): void {
    this.sessionClosed.emit({ mood: this.closeMood(), note });
    this.showRecap.set(false);
  }

  protected submitQuickTrade(): void {
    if (!this.canSubmitQuickTrade()) return;
    const h = new Date().getHours();
    let session: CreateTradeDto['session'];
    if (h >= 7 && h < 16) session = 'LONDON';
    else if (h >= 14 && h < 22) session = 'NEW_YORK';
    else session = 'ASIAN';

    const dto: CreateTradeDto = {
      asset: this.qtAsset().trim().toUpperCase(),
      side: this.qtSide(),
      emotion: this.qtEmotion(),
      setup: 'BREAKOUT',
      session,
      timeframe: '5m',
      entry: parseFloat(this.qtEntry()) || 0,
      ...(this.qtQty() ? { quantity: parseFloat(this.qtQty()) } : {}),
      ...(this.qtSl() ? { stopLoss: parseFloat(this.qtSl()) } : {}),
      ...(this.qtTp() ? { takeProfit: parseFloat(this.qtTp()) } : {}),
    };

    this.tradeLogged.emit(dto);
    this.qtAsset.set('');
    this.qtEntry.set('');
    this.qtSl.set('');
    this.qtTp.set('');
    this.qtQty.set('1');
  }

  private readonly ai_badge = 'ai-badge';
  protected get aiBadge() { return this.ai_badge; }
}