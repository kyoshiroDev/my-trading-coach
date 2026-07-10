import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule, Newspaper, CalendarDays, ListOrdered, Zap, ChevronRight } from 'lucide-angular';
import { Subject, forkJoin, interval, of, timer } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { EcoCalendarApi, EcoCalendarData, EcoEvent, EcoResultAnalysis } from '../../../../core/api/eco-calendar.api';
import { translateEcoEvent } from '../../../../core/data/eco-event-translations';
import { normalizeEventKey, eventKey } from '../../../../core/data/eco-event-key';
import { MoodState, TradingSession, LiveStats, SessionTrade } from '../../../../core/api/session.api';
import { CreateTradeDto, InstrumentSearchResult, MarketContext, NewsItem, TradesApi, UserAssetItem } from '../../../../core/api/trades.api';
import { SessionRecapComponent } from '../session-recap/session-recap.component';
import { MarketContextBarComponent } from '../market-context-bar/market-context-bar.component';
import { EcoSocketService } from '../../../../core/services/eco-socket.service';
import { UserStore } from '../../../../core/stores/user.store';
import { PremiumLockComponent } from '../../../../shared/components/premium-lock/premium-lock.component';
import { SetupsStore } from '../../../../core/stores/setups.store';
import { formatDuration } from '../../../../core/utils/time.utils';
import { parseDecimal } from '../../../../core/utils/parse-decimal';
import { NumericInputDirective } from '../../../../core/directives/numeric-input.directive';
import { EmotionEmojiPipe } from '../../../../shared/pipes/emotion-emoji.pipe';
import { POLLING_MS } from '../../../../core/constants/polling.const';
import { LiveNewsComponent } from './components/live-news/live-news.component';
import { LiveFeedComponent } from './components/live-feed/live-feed.component';

const MOODS: { value: MoodState; label: string; emoji: string }[] = [
  { value: 'CONFIDENT', label: 'Confiant', emoji: '😎' },
  { value: 'FOCUSED',   label: 'Focalisé', emoji: '🎯' },
  { value: 'NEUTRAL',   label: 'Neutre',   emoji: '😐' },
  { value: 'TIRED',     label: 'Fatigué',  emoji: '😰' },
];

// Calendrier éco d'exemple pour la session live démo (affiché si rien de réel
// dans la fenêtre de session). Released → bloc d'analyse IA figé (DEMO_ECO_ANALYSIS).
const DEMO_LIVE_ECO_EVENTS: EcoEvent[] = [
  { time: '09:00', name: 'PMI manufacturier',  currency: 'EUR', country: 'EU', impact: 'medium', actual: 49.2, estimate: 49.0, previous: 48.8, isReleased: true,  unit: null },
  { time: '14:30', name: 'Inflation CPI (US)', currency: 'USD', country: 'US', impact: 'high',   actual: 3.1,  estimate: 3.2,  previous: 3.4,  isReleased: true,  unit: '%' },
  { time: '16:00', name: 'Discours BCE',        currency: 'EUR', country: 'EU', impact: 'high',   actual: null, estimate: null, previous: null, isReleased: false, unit: null },
];
// Analyse IA figée par événement (keyée sur le name brut). Zéro appel modèle.
const DEMO_ECO_ANALYSIS: Record<string, EcoResultAnalysis> = {
  'PMI manufacturier': {
    interpretation: "PMI au-dessus des attentes (49.2 vs 49.0) — léger soutien pour l'EUR, sentiment risk-on modéré.",
    assetSentiments: [{ asset: 'EUR/USD', sentiment: 'bull', shortReason: 'PMI meilleur que prévu' }],
  },
  'Inflation CPI (US)': {
    interpretation: "CPI US sous les attentes (3.1% vs 3.2%) — désinflation confirmée : pression baissière sur le dollar, soutien des indices US.",
    assetSentiments: [
      { asset: 'MNQ', sentiment: 'bull', shortReason: 'CPI plus bas → indices en hausse' },
      { asset: 'EUR/USD', sentiment: 'bull', shortReason: 'Dollar plus faible' },
    ],
  },
  'Balance courante': {
    interpretation: "Balance courante japonaise au-dessus des attentes — léger soutien du yen, impact indirect sur tes actifs (indices US, EUR/USD).",
    assetSentiments: [{ asset: 'EUR/USD', sentiment: 'neutral', shortReason: 'Impact indirect via le yen' }],
  },
};

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
  imports: [LucideAngularModule, SessionRecapComponent, MarketContextBarComponent, LiveNewsComponent, LiveFeedComponent, NumericInputDirective, PremiumLockComponent, EmotionEmojiPipe],
  template: `
    <div data-testid="session-live-view">

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

      <!-- Barre contextuelle marché FMP -->
      @if (marketCtx()) {
        <div class="ctx-bar-wrap">
          <mtc-market-context-bar
            [ctx]="marketCtx()"
            [breakingNews]="breakingNews()"
          />
        </div>
      }

      <!-- News live — ticker horizontal (Starter+) -->
      @if (isStarterOrAbove() && newsItems().length > 0) {
        <div class="news-ticker">
          <span class="news-ticker-lbl"><lucide-icon [img]="NewsIcon" [size]="13" class="ct-ic" /> News live</span>
          <div class="news-ticker-viewport">
            <div class="news-ticker-track">
              @for (item of newsItems(); track item.publishedDate) {
                <button type="button" class="news-tick" (click)="openNews(item)">
                  <span class="news-tick-tag">{{ item.symbol }}</span>
                  <span class="news-tick-title">{{ item.title }}</span>
                  <span class="news-tick-time">{{ formatNewsTime(item.publishedDate) }}</span>
                </button>
                <span class="news-tick-sep">·</span>
              }
              <!-- Copie pour un défilement continu (marquee) -->
              @for (item of newsItems(); track 'dup-' + item.publishedDate) {
                <button type="button" class="news-tick" tabindex="-1" aria-hidden="true" (click)="openNews(item)">
                  <span class="news-tick-tag">{{ item.symbol }}</span>
                  <span class="news-tick-title">{{ item.title }}</span>
                  <span class="news-tick-time">{{ formatNewsTime(item.publishedDate) }}</span>
                </button>
                <span class="news-tick-sep" aria-hidden="true">·</span>
              }
            </div>
          </div>
        </div>
      }

      <!-- Live layout : zone gauche (stats + calendrier + live feed) / Trade rapide pleine hauteur à droite -->
      <div class="live-layout">
        <div class="live-main">

          <!-- Mini stats row (largeur calendrier + live feed uniquement) -->
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

          <div class="live-cols">

            <!-- ═══ COL 1 : CALENDRIER + TREASURY ═══ -->
        <div class="cal-col">

          <!-- Calendrier éco -->
          <div class="cal-card">
            <div class="col-title-row">
              <div class="col-title">
                <lucide-icon [img]="CalIcon" [size]="14" class="ct-ic" /> Calendrier économique
                <div class="pulse-dot"></div>
              </div>
            </div>

            @if (showReleaseAlert() && newReleases().length > 0) {
              <div class="eco-release-alert" data-testid="eco-release-alert">
                <div class="era-header">
                  <span class="era-dot"></span>
                  <span class="era-title">
                    🔔 {{ newReleases().length === 1 ? 'Résultat publié' : newReleases().length + ' résultats publiés' }}
                  </span>
                  <button class="era-close" (click)="showReleaseAlert.set(false)">×</button>
                </div>
                @for (ev of newReleases(); track ev.name) {
                  <div class="era-event">
                    <div class="era-event-name">{{ translate(ev.name) }} <span class="era-currency">{{ ev.currency }}</span></div>
                    <div class="era-values">
                      <span class="era-actual"
                            [class.positive]="(ev.actual ?? 0) > (ev.estimate ?? 0)"
                            [class.negative]="(ev.actual ?? 0) < (ev.estimate ?? 0)">
                        Actuel : {{ ev.actual }}{{ ev.unit }}
                      </span>
                      @if (ev.estimate !== null) {
                        <span class="era-estimate">Prévu : {{ ev.estimate }}{{ ev.unit }}</span>
                      }
                    </div>
                  </div>
                }
                @switch (releaseAlertState()) {
                  @case ('analyzing') {
                    <div class="era-ai-loading" data-testid="era-ai-loading">
                      <span class="era-spin">⟳</span> Ton compagnon analyse l'impact...
                    </div>
                  }
                  @case ('ready') {
                    <div class="era-ai-ready" data-testid="era-ai-ready">
                      ✦ Analyse prête : détail dans le calendrier ci-dessous ↓
                    </div>
                  }
                  @case ('error') {
                    <div class="era-ai-error">
                      Analyse indisponible pour le moment.
                    </div>
                  }
                }
              </div>
            }

            @if (!ecoCalendar()) {
              <div style="font-size:12px;color:var(--text-3);text-align:center;padding:20px 0;">
                Calendrier disponible dès Starter
              </div>
            } @else {
              <div class="cal-events-list">
                @for (event of visibleEcoEvents(); track event.name) {
                  <div
                    class="eco-live-event"
                    [class.released]="event.isReleased"
                    [class.dim]="!event.isReleased && isOutsideSession(event.time)"
                    [class.expandable]="event.isReleased"
                    [class.expanded]="expandedEcoEvent() === event.name"
                  >
                    <div class="eco-live-header"
                         [attr.role]="event.isReleased ? 'button' : null"
                         [attr.tabindex]="event.isReleased ? 0 : null"
                         (click)="event.isReleased && toggleEcoEvent(event.name)"
                         (keyup.enter)="event.isReleased && toggleEcoEvent(event.name)">
                      <span class="eco-time">{{ formatTime(event.time) }}</span>
                      <div class="eco-impact-bar" [class.high]="event.impact === 'high'"></div>
                      <span class="eco-flag-sm">{{ getFlag(event) }}</span>
                      <div class="eco-name-wrap">
                        <span class="eco-name">{{ translate(event.name) }}</span>
                        <span class="eco-sub">
                          @if (event.isReleased && event.actual !== null) {
                            <span class="eco-sub-actual">Actuel : {{ event.actual }}{{ event.unit ?? '' }}</span>
                            @if (event.estimate !== null || event.previous !== null) { <span class="eco-sub-sep">·</span> }
                          }
                          @if (event.estimate !== null) {
                            <span>Prévu : {{ event.estimate }}{{ event.unit ?? '' }}</span>
                            @if (event.previous !== null) { <span class="eco-sub-sep">·</span> }
                          }
                          @if (event.previous !== null) {
                            <span>Préc. : {{ event.previous }}{{ event.unit ?? '' }}</span>
                          }
                        </span>
                      </div>
                      <span class="eco-currency-tag">{{ event.currency }}</span>
                      <span class="eco-impact-badge" [class.high]="event.impact === 'high'">
                        {{ event.impact === 'high' ? 'Fort' : 'Moyen' }}
                      </span>
                      @if (event.isReleased) {
                        <lucide-icon [img]="ChevronIcon" [size]="14" class="eco-chevron" />
                      } @else {
                        <span class="eco-countdown">dans {{ minutesUntil(event.time) }} min</span>
                      }
                    </div>

                    @if (event.isReleased && expandedEcoEvent() === event.name) {
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
                } @empty {
                  <div class="cal-empty">
                    <div class="cal-empty-icon">📅</div>
                    <div class="cal-empty-title">Aucun événement</div>
                    <div class="cal-empty-sub">Pas d'annonce économique pour cette session.</div>
                  </div>
                }
                @if (hiddenEcoCount() > 0) {
                  <div class="cal-more">+{{ hiddenEcoCount() }} autre{{ hiddenEcoCount() > 1 ? 's' : '' }} événement{{ hiddenEcoCount() > 1 ? 's' : '' }} hors fenêtre de session</div>
                }
              </div>
            }
          </div>

          <!-- Treasury Rates → déplacés dans la barre de contexte marché (haut) -->

        </div><!-- /cal-col -->

        <!-- ═══ COL 3 : LIVE FEED ═══ -->
        <div class="feed-col" data-testid="live-feed">
          <div class="col-title">
            <lucide-icon [img]="FeedIcon" [size]="14" class="ct-ic" /> Live feed
            <div class="pulse-dot"></div>
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
            <div class="feed-list">
              @for (trade of todayTrades(); track trade.id) {
                @if (trade.pnl !== null) {
                  <div class="feed-row">
                    <span class="feed-time">{{ tradeTime(trade.tradedAt) }}</span>
                    <span class="feed-asset">{{ trade.asset }}</span>
                    <span class="trade-side" [class]="trade.side.toLowerCase()">{{ trade.side === 'LONG' ? '▲' : '▼' }} {{ trade.side }}</span>
                    <span class="feed-emo" [title]="trade.emotion">{{ trade.emotion | emotionEmoji }}</span>
                    <span class="feed-pnl" [class.green]="trade.pnl >= 0" [class.red]="trade.pnl < 0" style="margin-left:auto;">
                      {{ trade.pnl >= 0 ? '+' : '' }}{{ trade.pnl.toFixed(0) }}$
                    </span>
                  </div>
                } @else {
                  <div
                    class="feed-row live-row"
                    role="button"
                    tabindex="0"
                    (click)="openClosePanel(trade.id)"
                    (keyup.enter)="openClosePanel(trade.id)"
                  >
                    <span class="feed-time">{{ tradeTime(trade.tradedAt) }}</span>
                    <span class="feed-asset">{{ trade.asset }}</span>
                    <span class="trade-side" [class]="trade.side.toLowerCase()">{{ trade.side === 'LONG' ? '▲' : '▼' }} {{ trade.side }}</span>
                    <span class="feed-emo" [title]="trade.emotion">{{ trade.emotion | emotionEmoji }}</span>
                    <span class="live-tag" style="margin-left:auto;">● LIVE</span>
                  </div>

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
                            type="text"
                            inputmode="decimal"
                            mtcNumericInput
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
                          → {{ detectCloseType(trade, exitPriceInput()) }}
                        </div>
                      }
                    </div>
                  }
                }
              }
            </div>
          }
        </div>

          </div><!-- /live-cols -->
        </div><!-- /live-main -->

        <!-- ═══ COL 4 : TRADE RAPIDE (colonne pleine hauteur à droite) ═══ -->
        <div class="qt-panel" data-testid="quick-trade-form">
          <div class="qt-title">
            <lucide-icon [img]="QuickIcon" [size]="14" class="ct-ic" /> Trade rapide

          </div>

          <!-- Asset select -->
          <div class="qt-asset-wrap">
            <div class="qt-lbl">ACTIF</div>
            @if (assetsLoading()) {
              <div class="qt-asset-skel"></div>
            } @else if (assetsError()) {
              <div class="qt-asset-error" role="alert">
                <span>Impossible de charger tes actifs.</span>
                <button type="button" class="qt-retry-btn" (click)="loadUserAssets()">Réessayer</button>
              </div>
            } @else {
              <div style="display:flex;gap:6px;align-items:center;">
                <select
                  class="qt-asset-select"
                  data-testid="quick-trade-asset"
                  (change)="onAssetSelect($event)"
                >
                  <option value="">-- Choisir --</option>
                  @for (a of userAssets(); track a.symbol) {
                    <option [value]="a.symbol" [selected]="qtSelectedAsset()?.symbol === a.symbol">
                      {{ a.isFavorite ? '★ ' : '' }}{{ a.symbol }}{{ a.tradeCount > 0 ? ' · ' + a.tradeCount + ' trade' + (a.tradeCount > 1 ? 's' : '') : '' }}
                    </option>
                  }
                  <option value="__custom__">➕ Autre actif…</option>
                </select>
                @if (qtSelectedAsset()) {
                  <button
                    class="qt-fav-btn"
                    [class.active]="qtSelectedAsset()!.isFavorite"
                    title="Marquer comme favori"
                    (click)="setFavorite()"
                  >★</button>
                }
              </div>

              @if (customAssetMode()) {
                <div class="qt-custom-asset">
                  <div class="qt-custom-row">
                    <input
                      class="qt-input"
                      type="text"
                      data-testid="quick-trade-custom-asset"
                      [value]="customAssetQuery()"
                      (input)="onCustomAssetSearch($event)"
                      (keydown.enter)="submitCustomAsset()"
                      placeholder="Cherche ou saisis (ex : NQ, BTC/USDT)…"
                      style="font-size:12px;"
                    />
                    <button class="qt-custom-add" type="button" [disabled]="!customAssetQuery().trim()" (click)="submitCustomAsset()">OK</button>
                    <button class="qt-custom-cancel" type="button" (click)="cancelCustomAsset()">✕</button>
                  </div>
                  @if (customAssetResults().length > 0) {
                    <div class="qt-custom-results">
                      @for (r of customAssetResults(); track r.symbol) {
                        <button class="qt-custom-result" type="button" (click)="addCustomAsset(r.symbol)">
                          <span class="qt-custom-sym">{{ r.symbol }}</span>
                          <span class="qt-custom-lbl">{{ r.label }}</span>
                        </button>
                      }
                    </div>
                  }
                </div>
              }

              <!-- Prix temps réel -->
              @if (qtSelectedAsset()) {
                <div class="qt-live-price">
                  @if (livePrice() !== null) {
                    <span class="qt-live-dot">●</span>
                    <span class="qt-live-value">{{ livePricePlaceholder() }}</span>
                    <span class="qt-live-label">prix actuel</span>
                  } @else {
                    <span class="qt-live-unavailable">—</span>
                  }
                </div>
              }
              @if (userAssets().length === 0 && !customAssetMode()) {
                <div class="qt-asset-hint">Choisis « ➕ Autre actif… » pour saisir ton premier instrument.</div>
              }
            }
          </div>

          <div>
            <div class="qt-lbl">DIRECTION</div>
            <div class="qt-sides">
              <button
                class="qt-side lng"
                [class.sel]="qtSide() === 'LONG'"
                [attr.aria-pressed]="qtSide() === 'LONG'"
                data-testid="quick-trade-long"
                (click)="qtSide.set('LONG')"
              >▲ LONG</button>
              <button
                class="qt-side sht"
                [class.sel]="qtSide() === 'SHORT'"
                [attr.aria-pressed]="qtSide() === 'SHORT'"
                data-testid="quick-trade-short"
                (click)="qtSide.set('SHORT')"
              >▼ SHORT</button>
            </div>
          </div>

          <div>
            <div class="qt-lbl">ÉMOTION</div>
            <div class="qt-emos">
              @for (emo of emotions; track emo.value) {
                <button
                  type="button"
                  class="qt-emo"
                  [class.sel]="qtEmotion() === emo.value"
                  [title]="emo.title"
                  [attr.aria-label]="emo.title"
                  [attr.aria-pressed]="qtEmotion() === emo.value"
                  (click)="qtEmotion.set(emo.value)"
                >{{ emo.emoji }}</button>
              }
            </div>
          </div>

          <div class="qt-secondary">
            <select class="qt-select"
                    [value]="qtSetup()"
                    (change)="qtSetup.set($any($event.target).value)">
              @for (s of setupsStore.active(); track s.id) {
                <option [value]="s.id">{{ s.title }}</option>
              }
            </select>
            <select class="qt-select"
                    [value]="qtTimeframe()"
                    (change)="qtTimeframe.set($any($event.target).value)">
              <option value="1m">1m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
            </select>
          </div>

          <div class="qt-divider"></div>
          <div class="qt-optional-lbl">OPTIONNEL</div>

          <div class="qt-pnl-row">
            <div>
              <div class="qt-lbl">ENTRÉE</div>
              <div class="qt-entry-readonly" data-testid="qt-entry-auto">
                {{ livePrice() !== null ? livePricePlaceholder() : '—' }}
              </div>
            </div>
            <div>
              <div class="qt-lbl">QUANTITÉ</div>
              <input
                class="qt-input"
                type="text"
                inputmode="decimal"
                mtcNumericInput
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
                type="text"
                inputmode="decimal"
                mtcNumericInput
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
                type="text"
                inputmode="decimal"
                mtcNumericInput
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
            [disabled]="!canSubmitQuickTrade() || qtSubmitting()"
            (click)="submitQuickTrade()"
          >{{ qtSubmitting() ? 'Capture…' : '⚡ Logger ce trade' }}</button>
          <div class="qt-hint">Asset + direction + émotion suffisent</div>

          <!-- Retour d'action (succès / erreur) — annoncé aux lecteurs d'écran -->
          <div class="qt-feedback" role="status" aria-live="polite">
            @if (feedbackToast(); as fb) {
              <div class="qt-feedback-toast" [class.ok]="fb.type === 'success'" [class.err]="fb.type === 'error'">
                {{ fb.type === 'success' ? '✓' : '⚠' }} {{ fb.text }}
              </div>
            }
          </div>
        </div>

      </div>

      } <!-- /if session ACTIVE -->

    <!-- Modale news -->
    @if (selectedNews(); as news) {
      <div class="news-modal-overlay"
           role="button"
           tabindex="0"
           (click)="closeNews()"
           (keyup.escape)="closeNews()">
        <div #newsDialog class="news-modal"
             role="dialog"
             aria-modal="true"
             aria-labelledby="news-modal-title"
             tabindex="-1"
             (click)="$event.stopPropagation()"
             (keydown.escape)="closeNews()"
             (keydown)="$event.stopPropagation()">
          <!-- Header -->
          <div class="nm-header">
            <div class="nm-meta">
              <span class="news-asset-tag">{{ news.symbol }}</span>
              @if (news.site) {
                <span class="nm-source">{{ news.site }}</span>
              }
              <span class="news-sentiment" [class]="news.sentiment ?? 'neutral'">
                {{ news.sentiment === 'bull' ? '▲ Bull' : news.sentiment === 'bear' ? '▼ Bear' : '— Neutre' }}
              </span>
              <span class="nm-date">{{ formatNewsTime(news.publishedDate) }}</span>
            </div>
            <button class="nm-close" (click)="closeNews()" aria-label="Fermer">✕</button>
          </div>

          <!-- Zone scrollable : image + titre + corps + lien -->
          <div class="nm-body-wrap">
            @if (news.image) {
              <img class="nm-image" [src]="news.image" [alt]="news.title" loading="lazy" />
            }
            <h2 id="news-modal-title" class="nm-title">{{ news.title }}</h2>
            @if (translatingNewsText()) {
              <p class="nm-translating" aria-live="polite">Traduction…</p>
            }
            @if (news.text) {
              <p class="nm-body">{{ news.text }}</p>
            }
            @if (news.url) {
              <a class="nm-cta" [href]="news.url" target="_blank" rel="noopener noreferrer">
                Lire l'article complet ↗
              </a>
            }
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
  readonly marketCtx = input<MarketContext | null>(null);
  readonly newsItems = input<NewsItem[]>([]);
  readonly breakingNews = input<string | null>(null);
  readonly triggerCloseModal = input<boolean>(false);
  readonly liveFeedback = input<{ type: 'success' | 'error'; text: string; ts: number } | null>(null);

  readonly startSession = output<void>();
  readonly tradeClosed = output<{ tradeId: string; exitPrice: number }>();
  readonly sessionClosed = output<{ mood: MoodState; note?: string; question?: string | null }>();
  readonly tradeLogged = output<CreateTradeDto>();
  readonly ecoCalendarRefreshed = output<EcoCalendarData>();
  readonly goToDebrief = output<void>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly ecoSocket = inject(EcoSocketService);
  private readonly ecoCalendarApi = inject(EcoCalendarApi);
  private readonly userStore = inject(UserStore);
  private readonly tradesApi = inject(TradesApi);
  protected readonly setupsStore = inject(SetupsStore);

  // News live + contexte marché = Starter+ (endpoints gardés côté API) → verrou d'upsell sinon.
  protected readonly isStarterOrAbove = computed(() => this.userStore.isStarterOrAbove());

  // Icônes Lucide (headers de colonnes — design « Session live »).
  protected readonly NewsIcon  = Newspaper;
  protected readonly CalIcon   = CalendarDays;
  protected readonly FeedIcon  = ListOrdered;
  protected readonly QuickIcon = Zap;
  protected readonly ChevronIcon = ChevronRight;

  // Calendrier éco : événement publié déplié au clic (null = tous repliés, style maquette compact)
  protected readonly expandedEcoEvent = signal<string | null>(null);
  protected toggleEcoEvent(name: string): void {
    this.expandedEcoEvent.update((v) => (v === name ? null : name));
  }

  // Timer
  private readonly now = signal(new Date());
  private readonly startTime = signal<Date | null>(null);

  protected readonly elapsed = computed(() => {
    const start = this.startTime();
    if (!start) return '00:00:00';
    return formatDuration(Math.floor((this.now().getTime() - start.getTime()) / 1000));
  });

  // Close trade panel
  protected readonly closingTradeId = signal<string | null>(null);
  protected readonly exitPriceInput = signal('');

  // (close session gérée via onglet Débrief dans session-day)

  // Modal news
  protected readonly selectedNews = signal<NewsItem | null>(null);
  // Traduction paresseuse du corps : true pendant l'appel à /news/:id/text.
  protected readonly translatingNewsText = signal(false);
  private readonly newsDialogRef = viewChild<ElementRef<HTMLElement>>('newsDialog');
  private newsTrigger: HTMLElement | null = null;

  protected openNews(item: NewsItem): void {
    this.newsTrigger = (document.activeElement as HTMLElement) ?? null;
    this.selectedNews.set(item);
    this.translatingNewsText.set(false);

    // Traduction du texte à la demande (1re ouverture) : le corps n'est traduit
    // que pour les news réellement consultées. Hors démo, et seulement s'il y a du texte.
    if (item.textTranslated === false && !!item.text && !this.userStore.isDemo()) {
      this.translatingNewsText.set(true);
      this.tradesApi.newsText(item.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.translatingNewsText.set(false);
            const fr = res.data?.text ?? null;
            if (fr) {
              this.selectedNews.update((n) =>
                n && n.id === item.id ? { ...n, text: fr, textTranslated: true } : n,
              );
            }
          },
          error: () => this.translatingNewsText.set(false),
        });
    }
  }
  protected closeNews(): void {
    this.selectedNews.set(null);
    this.translatingNewsText.set(false);
    this.newsTrigger?.focus();
    this.newsTrigger = null;
  }

  // Retour d'action live (toast succès/erreur, auto-effacé)
  protected readonly feedbackToast = signal<{ type: 'success' | 'error'; text: string } | null>(null);
  private feedbackTimer?: ReturnType<typeof setTimeout>;

  // Quick trade form — asset selection
  protected readonly userAssets = signal<UserAssetItem[]>([]);
  protected readonly assetsLoading = signal(false);
  protected readonly assetsError = signal(false);
  protected readonly qtSelectedAsset = signal<UserAssetItem | null>(null);
  // Saisie libre d'actif (anti-blocage premier trade)
  protected readonly customAssetMode    = signal(false);
  protected readonly customAssetQuery   = signal('');
  protected readonly customAssetResults = signal<InstrumentSearchResult[]>([]);
  private readonly customAssetSearch$   = new Subject<string>();
  protected readonly qtSide = signal<'LONG' | 'SHORT'>('LONG');
  protected readonly qtEmotion = signal<'CONFIDENT' | 'STRESSED' | 'REVENGE' | 'FEAR' | 'FOCUSED' | 'NEUTRAL'>('CONFIDENT');
  protected readonly qtSetup = signal<string>('');
  protected readonly qtTimeframe = signal<string>('5m');
  protected readonly qtQty = signal('1');
  protected readonly qtSl = signal('');
  protected readonly qtTp = signal('');
  protected readonly qtSubmitting = signal(false);

  // Eco results cache
  private readonly ecoResults = signal<Record<string, EcoResultAnalysis>>({});

  // Pins chargés directement depuis l'API — indépendant du cache getTodayEvents
  private readonly freshPins = signal<string[] | null>(null);

  // Prix temps réel FMP
  protected readonly livePrice = signal<number | null>(null);
  protected readonly livePriceLoading = signal(false);
  private livePriceInterval?: ReturnType<typeof setInterval>;

  protected readonly livePricePlaceholder = computed(() => {
    const price = this.livePrice();
    if (price === null) return '0.00';
    const symbol = this.qtSelectedAsset()?.symbol ?? '';
    if (symbol.includes('/') && !symbol.includes('USDT')) return price.toFixed(4);
    if (price < 10) return price.toFixed(4);
    return price.toFixed(2);
  });

  protected readonly pinnedKeys = computed(() => {
    const fresh = this.freshPins();
    const raw = fresh !== null ? fresh : (this.ecoCalendar()?.pinnedEvents ?? []);
    return new Set(raw.map(normalizeEventKey));
  });

  protected readonly sessionEcoEvents = computed(() => {
    const events = (this.ecoCalendar()?.events ?? []).filter((e) => !!e.name?.trim());
    const pinned = this.pinnedKeys();
    const hasMatchingPins = pinned.size > 0 &&
      events.some(e => pinned.has(eventKey(e)));
    if (!hasMatchingPins) return events;
    return events
      .filter(e => pinned.has(eventKey(e)))
      .sort((a, b) => a.time.localeCompare(b.time));
  });

  /** Cap d'affichage : au-delà, on résume par un compteur « +N autres ». */
  private readonly MAX_ECO_EVENTS = 12;

  /** Événements pertinents : contenu réel + fenêtre de session (pas toute la
   *  journée éco, sinon empilement illisible de barres fines).
   *  - publié → seulement si une valeur a été publiée (actual != null), dans les 6 dernières heures
   *  - à venir → heure valide, de −30 min à +6 h autour de maintenant
   *  Triés par heure croissante. */
  protected readonly relevantEcoEvents = computed(() =>
    this.sessionEcoEvents()
      .filter((e) => {
        if (!e.name?.trim()) return false;
        const delta = this.eventMinutesFromNow(e.time);
        if (e.isReleased) {
          if (e.actual == null) return false;
          return delta === null || (delta >= -360 && delta <= 60);
        }
        return delta !== null && delta >= -30 && delta <= 360;
      })
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')),
  );

  /** Liste effectivement rendue (plafonnée). En démo, exemples figés si rien de réel. */
  protected readonly visibleEcoEvents = computed(() => {
    const real = this.relevantEcoEvents().slice(0, this.MAX_ECO_EVENTS);
    if (real.length > 0) return real;
    return this.userStore.isDemo() ? DEMO_LIVE_ECO_EVENTS : real;
  });

  /** Nombre d'événements pertinents masqués par le cap. */
  protected readonly hiddenEcoCount = computed(() =>
    Math.max(0, this.relevantEcoEvents().length - this.MAX_ECO_EVENTS),
  );

  // Eco WebSocket — nouvelles releases temps réel
  protected readonly newReleases = signal<EcoEvent[]>([]);
  protected readonly showReleaseAlert = signal(false);
  protected readonly releaseAlertState = signal<'analyzing' | 'ready' | 'error'>('analyzing');
  private releaseAlertTimer?: ReturnType<typeof setTimeout>;
  /** Events déjà analysés (dédup du déclenchement au montage). */
  private readonly analyzedNames = new Set<string>();

  protected readonly moods = MOODS;
  protected readonly emotions = EMOTIONS;

  constructor() {
    // Setups du user pour le sélecteur de trade rapide (défaut = 1er actif).
    this.setupsStore.load();
    effect(() => {
      const first = this.setupsStore.active()[0];
      if (first && untracked(() => !this.qtSetup())) this.qtSetup.set(first.id);
    });

    // Démo : analyse IA figée pour les annonces du calendrier (zéro appel modèle).
    if (this.userStore.isDemo()) this.ecoResults.set(DEMO_ECO_ANALYSIS);

    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(new Date()));

    // triggerCloseModal → naviguer vers l'onglet Débrief
    effect(() => {
      if (this.triggerCloseModal()) {
        this.goToDebrief.emit();
      }
    });

    effect(() => {
      const s = this.session();
      if (s?.startedAt && s.status === 'ACTIVE') {
        this.startTime.set(new Date(s.startedAt));
      } else {
        this.startTime.set(null);
      }
    });

    // Retour d'action live → toast auto-effacé après 3,5 s (annoncé via aria-live)
    effect(() => {
      const fb = this.liveFeedback();
      if (!fb) return;
      this.feedbackToast.set({ type: fb.type, text: fb.text });
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = setTimeout(() => this.feedbackToast.set(null), 3500);
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.feedbackTimer));

    // Modale news → focus sur le dialogue à l'ouverture (accessibilité clavier)
    effect(() => {
      const dialog = this.newsDialogRef()?.nativeElement;
      if (this.selectedNews() && dialog) dialog.focus();
    });

    // Assets chargés immédiatement — indépendamment de la session
    this.loadUserAssets();

    // Recherche d'instrument (saisie libre d'actif)
    this.customAssetSearch$
      .pipe(
        debounceTime(300),
        map((q) => q.trim()),
        distinctUntilChanged(),
        switchMap((q) =>
          q.length < 2
            ? of({ data: [] as InstrumentSearchResult[] })
            : this.tradesApi.searchInstruments(q).pipe(catchError(() => of({ data: [] as InstrumentSearchResult[] }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => this.customAssetResults.set(res.data ?? []));

    // Pins chargés directement — pas de dépendance au cache getTodayEvents
    this.ecoCalendarApi.getPins()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => this.freshPins.set(res.data ?? []));

    // Arrêter le polling prix au destroy
    this.destroyRef.onDestroy(() => this.stopLivePricePolling());

    // WebSocket éco — connecter quand session active + Starter+ (analyse IA éco = Starter+)
    effect(() => {
      const s = this.session();
      if (s?.status === 'ACTIVE' && this.userStore.isStarterOrAbove()) {
        this.ecoSocket.connect();
      } else {
        this.ecoSocket.disconnect();
      }
    });

    // Analyse IA des events DÉJÀ publiés à l'ouverture (Starter+ + session active, hors démo).
    // Limité au FORT impact : ce sont eux qui bougent le marché. Sur une grosse journée
    // (~19 events US), ça évite une rafale d'appels modèle à la 1re ouverture ; le cache
    // mutualisé sert les suivantes. Les releases live restent couvertes par newReleases$.
    effect(() => {
      const s = this.session();
      if (s?.status !== 'ACTIVE' || !this.userStore.isStarterOrAbove() || this.userStore.isDemo()) return;
      const released = this.sessionEcoEvents().filter(
        (e) => e.impact === 'high' && e.isReleased && e.actual != null && !!e.name?.trim(),
      );
      const pending = released.filter((e) => !this.analyzedNames.has(e.name));
      // Échelonné (400 ms) pour ne pas lancer N requêtes simultanées.
      pending.forEach((e, i) => {
        this.analyzedNames.add(e.name);
        timer(i * 400)
          .pipe(
            switchMap(() => this.ecoCalendarApi.analyzeResult(e.name).pipe(catchError(() => of(null)))),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe((res) => {
            if (res?.data) this.ecoResults.update((prev) => ({ ...prev, [e.name]: res.data }));
          });
      });
    });

    // Écouter les nouvelles releases
    this.ecoSocket.newReleases$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((events) => {
        this.newReleases.set(events);
        this.releaseAlertState.set('analyzing');
        this.showReleaseAlert.set(true);
        clearTimeout(this.releaseAlertTimer);

        // Re-synchroniser le calendrier (actual values) pour le parent
        this.ecoCalendarApi.refreshAnalysis()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((res) => this.ecoCalendarRefreshed.emit(res.data));

        // Analyse IA ciblée par événement publié
        const calls = events.map((ev) =>
          this.ecoCalendarApi.analyzeResult(ev.name).pipe(
            map((res) => ({ name: ev.name, analysis: res.data })),
            catchError(() => of({ name: ev.name, analysis: null as EcoResultAnalysis | null })),
          ),
        );
        if (!calls.length) { this.showReleaseAlert.set(false); return; }

        forkJoin(calls)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((results) => {
            const next = { ...this.ecoResults() };
            let anyOk = false;
            for (const r of results) {
              if (r.analysis) { next[r.name] = r.analysis; anyOk = true; }
            }
            this.ecoResults.set(next);
            this.releaseAlertState.set(anyOk ? 'ready' : 'error');
            // auto-dismiss UNIQUEMENT une fois l'analyse arrivée
            this.releaseAlertTimer = setTimeout(() => this.showReleaseAlert.set(false), 12000);
          });
      });

    this.destroyRef.onDestroy(() => clearTimeout(this.releaseAlertTimer));
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
    () => this.qtSelectedAsset() !== null,
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

  /** Minutes signées entre l'événement et maintenant (négatif = passé).
   *  Gère le format « HH:MM » comme l'ISO. null si l'heure est invalide. */
  private eventMinutesFromNow(time: string | null | undefined): number | null {
    if (!time) return null;
    let h: number, m: number;
    if (time.includes('T')) {
      const d = new Date(time);
      h = d.getHours();
      m = d.getMinutes();
    } else {
      h = parseInt(time.split(':')[0] ?? '', 10);
      m = parseInt(time.split(':')[1] ?? '0', 10);
    }
    if (!Number.isFinite(h)) return null;
    const now = new Date();
    return h * 60 + (Number.isFinite(m) ? m : 0) - (now.getHours() * 60 + now.getMinutes());
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
    const exitPrice = parseDecimal(this.exitPriceInput());
    if (!tradeId || exitPrice == null || exitPrice <= 0) return;
    this.tradeClosed.emit({ tradeId, exitPrice });
    this.cancelClose();
  }

  protected detectCloseType(trade: SessionTrade, exitRaw: string): string {
    const exitPrice = parseDecimal(exitRaw);
    if (exitPrice == null) return 'Clôture manuelle';
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

  protected loadUserAssets(): void {
    this.assetsLoading.set(true);
    this.assetsError.set(false);
    this.tradesApi.getUserAssets()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const assets = res.data ?? [];
          this.userAssets.set(assets);
          const preselect = assets.find((a) => a.isFavorite) ?? assets[0] ?? null;
          if (preselect) this.applyAssetSelection(preselect);
          this.assetsLoading.set(false);
        },
        error: () => {
          this.assetsError.set(true);
          this.assetsLoading.set(false);
        },
      });
  }

  protected onAssetSelect(event: Event): void {
    const symbol = (event.target as HTMLSelectElement).value;
    if (symbol === '__custom__') {
      this.customAssetMode.set(true);
      this.customAssetQuery.set('');
      this.customAssetResults.set([]);
      return;
    }
    const asset = this.userAssets().find((a) => a.symbol === symbol) ?? null;
    this.qtSelectedAsset.set(asset);
    if (asset) this.applyAssetSelection(asset);
  }

  protected onCustomAssetSearch(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.customAssetQuery.set(v);
    this.customAssetSearch$.next(v);
  }

  protected submitCustomAsset(): void {
    const q = this.customAssetQuery().trim();
    if (q) this.addCustomAsset(q);
  }

  protected cancelCustomAsset(): void {
    this.customAssetMode.set(false);
    this.customAssetQuery.set('');
    this.customAssetResults.set([]);
  }

  /** Ajoute un actif saisi librement : local immédiat + persistance, sélectionné pour le trade. */
  protected addCustomAsset(symbol: string): void {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;

    let asset = this.userAssets().find((a) => a.symbol === sym) ?? null;
    if (!asset) {
      asset = {
        symbol: sym, label: sym, category: '',
        tradeCount: 0, lastEntry: null, lastQty: null, isFavorite: false,
      };
      this.userAssets.update((list) => [asset as UserAssetItem, ...list]);
    }

    this.applyAssetSelection(asset);
    this.cancelCustomAsset();

    // Persister la liste d'actifs (ne pas bloquer en cas d'erreur réseau)
    const symbols = this.userAssets().map((a) => a.symbol);
    const fav = this.userAssets().find((a) => a.isFavorite)?.symbol ?? null;
    this.tradesApi.saveUserAssets(symbols, fav)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => undefined, error: () => undefined });
  }

  private applyAssetSelection(asset: UserAssetItem): void {
    this.qtSelectedAsset.set(asset);
    // L'entry est capturée automatiquement au clic (prix marché de l'instant) — pas de saisie.
    if (asset.lastQty != null) this.qtQty.set(String(asset.lastQty));
    this.startLivePricePolling(asset.symbol);
  }

  private fetchLivePrice(symbol: string): void {
    if (!symbol) { this.livePrice.set(null); return; }
    this.livePriceLoading.set(true);
    this.tradesApi.getLivePrice(symbol).subscribe({
      next: (res) => {
        this.livePrice.set(res.data?.price ?? null);
        this.livePriceLoading.set(false);
      },
      error: () => {
        this.livePrice.set(null);
        this.livePriceLoading.set(false);
      },
    });
  }

  private startLivePricePolling(symbol: string): void {
    this.stopLivePricePolling();
    this.livePrice.set(null);
    this.fetchLivePrice(symbol);
    this.livePriceInterval = setInterval(() => {
      // Garde-fou : pas d'appels quand l'onglet est masqué
      if (!document.hidden) this.fetchLivePrice(symbol);
    }, POLLING_MS.LIVE_PRICE);
  }

  private stopLivePricePolling(): void {
    if (this.livePriceInterval) {
      clearInterval(this.livePriceInterval);
      this.livePriceInterval = undefined;
    }
  }

  protected setFavorite(): void {
    const asset = this.qtSelectedAsset();
    if (!asset) return;
    const newFav = asset.isFavorite ? null : asset.symbol;
    this.tradesApi.setFavoriteAsset(newFav).subscribe(() => {
      this.userAssets.update((list) =>
        list.map((a) => ({ ...a, isFavorite: a.symbol === newFav })),
      );
      this.qtSelectedAsset.update((a) =>
        a ? { ...a, isFavorite: !a.isFavorite } : null,
      );
    });
  }

  protected submitQuickTrade(): void {
    const selected = this.qtSelectedAsset();
    if (!selected || this.qtSubmitting()) return;

    this.qtSubmitting.set(true);
    // Capture FRAÎCHE du prix au moment exact du clic (cache backend 3s).
    this.tradesApi
      .getLivePrice(selected.symbol)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.emitTrade(selected, res.data?.price ?? this.livePrice() ?? 0);
          this.qtSubmitting.set(false);
        },
        error: () => {
          // Fallback : dernier prix affiché (ne pas bloquer le log)
          this.emitTrade(selected, this.livePrice() ?? 0);
          this.qtSubmitting.set(false);
        },
      });
  }

  private emitTrade(selected: UserAssetItem, entry: number): void {
    const h = new Date().getHours();
    let session: CreateTradeDto['session'];
    if (h >= 7 && h < 16) session = 'LONDON';
    else if (h >= 14 && h < 22) session = 'NEW_YORK';
    else session = 'ASIAN';

    // Normalisation virgule → point avant envoi (champs filtrés par mtcNumericInput).
    const qty = parseDecimal(this.qtQty());
    const sl = parseDecimal(this.qtSl());
    const tp = parseDecimal(this.qtTp());

    const dto: CreateTradeDto = {
      asset: selected.symbol,
      side: this.qtSide(),
      emotion: this.qtEmotion(),
      setupId: this.qtSetup(),
      session,
      timeframe: this.qtTimeframe(),
      entry,
      ...(qty != null ? { quantity: qty } : {}),
      ...(sl != null ? { stopLoss: sl } : {}),
      ...(tp != null ? { takeProfit: tp } : {}),
    };

    this.tradeLogged.emit(dto);
    this.qtSl.set('');
    this.qtTp.set('');
    this.qtQty.set('1');
  }

  private readonly FLAGS: Record<string, string> = {
    US: '🇺🇸', EU: '🇪🇺', GB: '🇬🇧', JP: '🇯🇵',
    CA: '🇨🇦', AU: '🇦🇺', NZ: '🇳🇿', CH: '🇨🇭',
    CN: '🇨🇳', DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹',
    USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
    CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', CHF: '🇨🇭',
    CNY: '🇨🇳', CNH: '🇨🇳', SEK: '🇸🇪', NOK: '🇳🇴',
    DKK: '🇩🇰', HKD: '🇭🇰', SGD: '🇸🇬', MXN: '🇲🇽',
  };

  protected translate(name: string): string {
    return translateEcoEvent(name);
  }

  protected formatNewsTime(iso: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  protected getFlag(event: { country?: string | null; currency?: string | null }): string {
    if (event.country) {
      const flag = this.FLAGS[event.country.toUpperCase()];
      if (flag) return flag;
    }
    return this.FLAGS[event.currency?.toUpperCase() ?? ''] ?? '🌐';
  }

  private readonly ai_badge = 'ai-badge';
  protected get aiBadge() { return this.ai_badge; }
}