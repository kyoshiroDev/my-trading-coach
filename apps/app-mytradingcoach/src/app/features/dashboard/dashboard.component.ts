import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe, TitleCasePipe, UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import { BillingApi } from '../../core/api/billing.api';
import { httpResource } from '@angular/common/http';
import { UserStore } from '../../core/stores/user.store';
import { TradesStore } from '../../core/stores/trades.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { TradeFormComponent } from '../journal/trade-form.component';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { CreateTradeDto, TradesApi } from '../../core/api/trades.api';
import {
  AnalyticsApi,
  AnalyticsSummary,
  EquityPoint,
  MonthlyActivitySummary,
  SetupStat,
  EmotionStat,
} from '../../core/api/analytics.api';
import { ActivityCalendarComponent } from '../../shared/components/activity-calendar/activity-calendar.component';
import {
  EmotionColorPipe,
  EmotionEmojiPipe,
  EmotionLabelPipe,
  PnlColorPipe,
  PnlFormatPipe,
  SetupColorPipe,
  SetupColorsMapPipe,
} from '../../shared/pipes';
import { environment } from '../../../environments/environment';
import { SessionApi, TradingSession, LiveStats, SessionTrade, MoodState } from '../../core/api/session.api';
import { EcoCalendarApi, EcoCalendarData } from '../../core/api/eco-calendar.api';
import { DailyRecapApi, DailyRecap } from '../../core/api/daily-recap.api';
import { DebriefApi, DebriefObjective } from '../../core/api/debrief.api';
import { SessionMorningComponent } from './components/session-morning/session-morning.component';
import { SessionLiveComponent } from './components/session-live/session-live.component';

@Component({
  selector: 'mtc-dashboard',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    TitleCasePipe,
    UpperCasePipe,
    TopbarComponent,
    TradeFormComponent,
    PlanModalComponent,
    PnlColorPipe,
    PnlFormatPipe,
    EmotionEmojiPipe,
    EmotionLabelPipe,
    EmotionColorPipe,
    SetupColorPipe,
    SetupColorsMapPipe,
    SessionMorningComponent,
    SessionLiveComponent,
    ActivityCalendarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dashboard.component.css',
  template: `
    <mtc-topbar
      title="Dashboard"
      [showAddButton]="true"
      addLabel="⚡ Ajouter trade"
      (addClick)="goToJournal()"
    />

    <div class="content">
      <!-- ── DASHBOARD V2 — BETA_TESTER + ADMIN uniquement ────────────── -->
      @if (userStore.isBeta()) {
        <div class="greeting">
          <h1 class="greeting-title">Bonjour, {{ userStore.displayName() }} 👋</h1>
          <div class="greeting-sub">{{ today | date:'EEEE d MMMM' }}</div>
          <div class="session-tabs">
            <button class="session-tab" [class.active]="activeTab() === 'dashboard'" data-testid="tab-dashboard" (click)="selectTab('dashboard')">① Dashboard actuel</button>
            <button class="session-tab" [class.active]="activeTab() === 'morning'" data-testid="tab-morning" (click)="selectTab('morning')">
              ② Matin — pré-session <span class="badge-beta">BÊTA</span>
            </button>
            <button class="session-tab" [class.active]="activeTab() === 'live'" data-testid="tab-live" (click)="selectTab('live')">
              ③ Session live <span class="badge-beta">BÊTA</span>
            </button>
          </div>
        </div>

        @if (showGlobalStats()) {
          <!-- Stat cards communes (masquées en session live) -->
          @if (!isLoading()) {
            <div class="stats-row has-capital">
              <div class="stat-card">
                <div class="stat-label">Capital</div>
                <div class="stat-value mono" [style.color]="capitalColor()">{{ capitalDisplay() }}</div>
                <div class="stat-sub">
                  @if (capitalPct() !== 0) {
                    <span class="change" [class]="capitalPct() > 0 ? 'up' : 'down'">
                      {{ capitalPct() > 0 ? '▲' : '▼' }} {{ capitalPct() | number: '1.1-1' }}%
                    </span>
                  } @else {
                    <span style="color:var(--text-3)">base</span>
                  }
                </div>
                <div class="stat-bg-icon">💼</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">P&amp;L Total</div>
                <div class="stat-value" [style.color]="pnlColor()">{{ summary()?.totalPnl ?? 0 | pnlFormat }}</div>
                <div class="stat-sub">
                  @if ((summary()?.totalTrades ?? 0) > 0) {
                    <span class="change" [class]="(summary()?.totalPnl ?? 0) >= 0 ? 'up' : 'down'">
                      {{ (summary()?.totalPnl ?? 0) >= 0 ? '▲' : '▼' }} ce mois
                    </span>
                  } @else {
                    <span style="color:var(--text-3)">Aucune donnée</span>
                  }
                </div>
                <div class="stat-bg-icon">💰</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Win Rate</div>
                <div class="stat-value" [style.color]="winRateColor()">{{ (summary()?.winRate ?? 0).toFixed(1) }}%</div>
                <div class="stat-sub">
                  @if ((summary()?.totalTrades ?? 0) > 0) {
                    <span>vs mois précédent</span>
                  } @else {
                    <span style="color:var(--text-3)">Aucune donnée</span>
                  }
                </div>
                <div class="stat-bg-icon">🎯</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Drawdown Max</div>
                <div class="stat-value" [style.color]="drawdownColor()">{{ drawdownDisplay() | pnlFormat }}</div>
                <div class="stat-sub">
                  @if ((summary()?.totalTrades ?? 0) > 0) {
                    <span>sur capital</span>
                  } @else {
                    <span style="color:var(--text-3)">Aucune donnée</span>
                  }
                </div>
                <div class="stat-bg-icon">📉</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Trades</div>
                <div class="stat-value">{{ summary()?.totalTrades ?? tradesStore.trades().length }}</div>
                <div class="stat-sub">
                  @if ((summary()?.totalTrades ?? 0) === 0) {
                    <span style="color:var(--text-3)">Aucune donnée</span>
                  } @else if ((summary()?.streak ?? 0) > 0) {
                    <span class="change up">▲ +{{ summary()?.streak }} streak</span>
                  } @else if ((summary()?.streak ?? 0) < 0) {
                    <span class="change down">▼ {{ summary()?.streak }} streak</span>
                  } @else {
                    <span class="change">— pas de streak</span>
                  }
                </div>
                <div class="stat-bg-icon">🔢</div>
              </div>
            </div>
          } @else {
            <div class="stats-row">
              @for (_ of [0, 1, 2, 3]; track $index) {
                <div class="stat-card stat-skeleton"></div>
              }
            </div>
          }
        }

        @if (activeTab() === 'morning') {
          <mtc-session-morning
            [yesterdayRecap]="yesterdayRecap()"
            [objectives]="currentObjectives()"
            [debriefId]="currentDebriefId()"
            [ecoCalendar]="ecoCalendar()"
            [selectedMood]="selectedMood()"
            [isNextDay]="ecoCalendarIsNextDay()"
            [nextTradingDate]="nextTradingDateStr()"
            (moodSelected)="selectMood($event)"
            (sessionStarted)="startSession()"
            (objectiveNoteAdded)="updateObjectiveNote($event)"
          />
        }
        @if (activeTab() === 'live') {
          <mtc-session-live
            [session]="activeSession()"
            [todayTrades]="todayTrades()"
            [liveStats]="todayStats()"
            [ecoCalendar]="ecoCalendar()"
            (startSession)="startSession()"
            (tradeClosed)="confirmCloseTrade($event)"
            (sessionClosed)="closeSession($event)"
            (tradeLogged)="logQuickTrade($event)"
          />
        }

        @if (activeTab() === 'dashboard') {
          @if (!userStore.isPremium() && tradesStore.limitReached()) {
            <div class="limit-banner reached">
              <div class="limit-banner-left">
                <span class="limit-banner-ic">🚫</span>
                <div>
                  <div class="limit-banner-title">Limite mensuelle atteinte</div>
                  <div class="limit-banner-sub">Tu as utilisé tes {{ tradesStore.monthlyLimit() }} trades ce mois. Passe à Premium pour trader sans limites.</div>
                </div>
              </div>
              <button class="limit-banner-btn" (click)="showPlanModal.set(true)">Passer Premium</button>
            </div>
          } @else if (!userStore.isPremium() && tradesStore.nearLimit()) {
            <div class="limit-banner near">
              <div class="limit-banner-left">
                <span class="limit-banner-ic">⚠️</span>
                <div>
                  <div class="limit-banner-title">{{ tradesStore.monthlyCount() }}/{{ tradesStore.monthlyLimit() }} trades ce mois</div>
                  <div class="limit-banner-sub">Tu approches de ta limite gratuite. Upgrade pour continuer sans restrictions.</div>
                </div>
              </div>
              <button class="limit-banner-btn ghost" (click)="showPlanModal.set(true)">Upgrade</button>
            </div>
          }
          @if (!userStore.isPremium()) {
            <div class="premium-banner">
              <div class="premium-banner-left">
                <span class="premium-banner-icon">⚡</span>
                <div>
                  <div class="premium-banner-title">Passe à Premium</div>
                  <div class="premium-banner-sub">Analytics avancés, IA Insights, Weekly Debrief automatique</div>
                </div>
              </div>
              <div class="premium-banner-right">
                <div class="premium-banner-price">
                  <span class="premium-banner-amount">39€</span>
                  <span class="premium-banner-period">/mois</span>
                  <div class="premium-banner-trial">7 jours gratuits · sans CB</div>
                </div>
                <button class="premium-banner-btn" (click)="showPlanModal.set(true)">Essayer gratuitement</button>
              </div>
            </div>
          }
          <!-- LIGNE 1 : Equity Curve + Calendrier côte à côte -->
          <div class="top-charts-row">
            <div class="card equity-card">
              <div class="card-header">
                <div class="card-title">Equity Curve</div>
                <a routerLink="/analytics" class="card-action">Détails →</a>
              </div>
              <div class="chart-container">
                <canvas #equityCanvas style="width:100%;height:100%;display:block;position:absolute;inset:0;"></canvas>
                @if (!userStore.isPremium() || equityCurve().length === 0) {
                  <div class="empty-chart">
                    @if (!userStore.isPremium()) { Courbe disponible en Premium } @else { Aucun trade enregistré }
                  </div>
                }
              </div>
            </div>
            <div class="card calendar-dashboard-card">
              <mtc-activity-calendar
                [data]="monthlyActivity()"
                [loading]="monthlyActivityLoading()"
                [showNavigation]="false"
                [year]="calYear()"
                [month]="calMonth()"
              />
            </div>
          </div>

          <!-- LIGNE 2 : Trades + Win Rate + Émotions -->
          <div class="bottom-widgets-row">
            <div class="card recent-trades-card">
              <div class="card-header">
                <div class="card-title">Derniers trades</div>
                <a routerLink="/journal" class="card-action">Voir →</a>
              </div>
              @if (tradesStore.trades().length === 0) {
                <div class="empty-state"><p>Aucun trade</p><small>Enregistre ton premier trade</small></div>
              } @else {
                <div class="trade-list-compact">
                  @for (trade of tradesStore.trades().slice(0, 4); track trade.id) {
                    <div class="trade-row-compact">
                      <div class="trade-row-top">
                        <span class="trade-side" [class]="trade.side === 'LONG' ? 'long' : 'short'">{{ trade.side }}</span>
                        <span class="trade-asset-compact">{{ trade.asset | uppercase }}</span>
                        <span class="trade-emotion">{{ trade.emotion | emotionEmoji }}</span>
                      </div>
                      <div class="trade-row-bottom">
                        <span class="trade-setup-compact">{{ trade.setup }}</span>
                        <span class="trade-pnl" [style.color]="trade.pnl | pnlColor">{{ trade.pnl | pnlFormat: trade.entry }}</span>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
            <div class="card">
              <div class="card-header">
                <div class="card-title">Win Rate / stratégie</div>
                <a routerLink="/analytics" class="card-action">Voir →</a>
              </div>
              @if (bySetup().length === 0) {
                <p class="empty-widget-msg">Tes setups apparaîtront<br />après tes premiers trades</p>
              } @else {
                <div class="donut-wrap">
                  <svg class="donut-svg" width="80" height="80" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="38" fill="none" stroke="var(--bg-3)" stroke-width="12" />
                    @for (seg of segments(); track seg.label) {
                      <circle cx="50" cy="50" r="38" fill="none" [attr.stroke]="seg.label | setupColorMap" stroke-width="12" [attr.stroke-dasharray]="seg.dash" [attr.stroke-dashoffset]="seg.offset" stroke-linecap="round" transform="rotate(-90 50 50)" />
                    }
                    <text x="50" y="53" text-anchor="middle" font-family="Syne" font-weight="700" font-size="14" fill="#e2eaf5">
                      {{ (summary()?.winRate ?? 0).toFixed(0) }}%
                    </text>
                  </svg>
                  <div class="donut-legend">
                    @for (s of bySetup().slice(0, 4); track s.setup) {
                      <div class="legend-item">
                        <div class="legend-dot" [style.background]="s.setup | setupColor"></div>
                        {{ s.setup | titlecase }}
                        <span class="legend-val">{{ s.winRate.toFixed(0) }}%</span>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
            <div class="card">
              <div class="card-header">
                <div class="card-title">États émotionnels</div>
                <a routerLink="/analytics" class="card-action">Détails →</a>
              </div>
              @if (emotionStats().length === 0) {
                <p class="empty-widget-msg">Enregistre tes premiers trades<br />pour voir tes états émotionnels</p>
              } @else {
                <div class="emotion-grid">
                  @for (e of emotionStats(); track e.emotion) {
                    <div class="emotion-row">
                      <div class="emotion-label">
                        <span>{{ e.emotion | emotionLabel }}</span>
                        <span>{{ e.pct }}%</span>
                      </div>
                      <div class="bar-track">
                        <div class="bar-fill" [style.width.%]="e.pct" [style.background]="e.emotion | emotionColor"></div>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        }
      }

      <!-- ── DASHBOARD V1 — users non-bêta uniquement ─────────────── -->
      @if (!userStore.isBeta()) {

      <!-- Bannière limite FREE -->
      @if (!userStore.isPremium() && tradesStore.limitReached()) {
        <div class="limit-banner reached">
          <div class="limit-banner-left">
            <span class="limit-banner-ic">🚫</span>
            <div>
              <div class="limit-banner-title">Limite mensuelle atteinte</div>
              <div class="limit-banner-sub">Tu as utilisé tes {{ tradesStore.monthlyLimit() }} trades ce mois. Passe à Premium pour trader sans limites.</div>
            </div>
          </div>
          <button class="limit-banner-btn" (click)="showPlanModal.set(true)">Passer Premium</button>
        </div>
      } @else if (!userStore.isPremium() && tradesStore.nearLimit()) {
        <div class="limit-banner near">
          <div class="limit-banner-left">
            <span class="limit-banner-ic">⚠️</span>
            <div>
              <div class="limit-banner-title">{{ tradesStore.monthlyCount() }}/{{ tradesStore.monthlyLimit() }} trades ce mois</div>
              <div class="limit-banner-sub">Tu approches de ta limite gratuite. Upgrade pour continuer sans restrictions.</div>
            </div>
          </div>
          <button class="limit-banner-btn ghost" (click)="showPlanModal.set(true)">Upgrade</button>
        </div>
      }

      <!-- Greeting + Discord inline -->
      <div class="dashboard-header-row">
        <h1 class="greeting-title">
          Bonjour, {{ userStore.displayName() }} 👋
        </h1>
        @if (!userStore.user()?.discordId) {
          <div class="discord-badge">
            <span class="discord-badge-ic">💬</span>
            <a href="https://discord.gg/TDK2npvkSN" target="_blank" rel="noopener"
              class="discord-badge-link">Rejoindre Discord</a>
          </div>
        }
      </div>

      <!-- Premium upsell banner -->
      @if (!userStore.isPremium()) {
        <div class="premium-banner">
          <div class="premium-banner-left">
            <span class="premium-banner-icon">⚡</span>
            <div>
              <div class="premium-banner-title">Passe à Premium</div>
              <div class="premium-banner-sub">
                Analytics avancés, IA Insights, Weekly Debrief automatique
              </div>
            </div>
          </div>
          <div class="premium-banner-right">
            <div class="premium-banner-price">
              <span class="premium-banner-amount">39€</span>
              <span class="premium-banner-period">/mois</span>
              <div class="premium-banner-trial">7 jours gratuits · sans CB</div>
            </div>
            <button
              class="premium-banner-btn"
              (click)="showPlanModal.set(true)"
            >
              Essayer gratuitement
            </button>
          </div>
        </div>
      }

      <!-- Stats row -->
      @if (!isLoading()) {
        <div class="stats-row has-capital">
          <div class="stat-card">
            <div class="stat-label">Capital</div>
            <div class="stat-value mono" [style.color]="capitalColor()">
              {{ capitalDisplay() }}
            </div>
            <div class="stat-sub">
              @if (capitalPct() !== 0) {
                <span class="change" [class]="capitalPct() > 0 ? 'up' : 'down'">
                  {{ capitalPct() > 0 ? '▲' : '▼' }}
                  {{ capitalPct() | number: '1.1-1' }}%
                </span>
              } @else {
                <span style="color:var(--text-3)">base</span>
              }
            </div>
            <div class="stat-bg-icon">💼</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">P&amp;L Total</div>
            <div class="stat-value" [style.color]="pnlColor()">
              {{ summary()?.totalPnl ?? 0 | pnlFormat }}
            </div>
            <div class="stat-sub">
              @if ((summary()?.totalTrades ?? 0) > 0) {
                <span
                  class="change"
                  [class]="(summary()?.totalPnl ?? 0) >= 0 ? 'up' : 'down'"
                >
                  {{ (summary()?.totalPnl ?? 0) >= 0 ? '▲' : '▼' }} ce mois
                </span>
              } @else {
                <span style="color:var(--text-3)">Aucune donnée</span>
              }
            </div>
            <div class="stat-bg-icon">💰</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Win Rate</div>
            <div class="stat-value" [style.color]="winRateColor()">
              {{ (summary()?.winRate ?? 0).toFixed(1) }}%
            </div>
            <div class="stat-sub">
              @if ((summary()?.totalTrades ?? 0) > 0) {
                <span>vs mois précédent</span>
              } @else {
                <span style="color:var(--text-3)">Aucune donnée</span>
              }
            </div>
            <div class="stat-bg-icon">🎯</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Drawdown Max</div>
            <div class="stat-value" [style.color]="drawdownColor()">
              {{ drawdownDisplay() | pnlFormat }}
            </div>
            <div class="stat-sub">
              @if ((summary()?.totalTrades ?? 0) > 0) {
                <span>sur capital</span>
              } @else {
                <span style="color:var(--text-3)">Aucune donnée</span>
              }
            </div>
            <div class="stat-bg-icon">📉</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Trades</div>
            <div class="stat-value">
              {{ summary()?.totalTrades ?? tradesStore.trades().length }}
            </div>
            <div class="stat-sub">
              @if ((summary()?.totalTrades ?? 0) === 0) {
                <span style="color:var(--text-3)">Aucune donnée</span>
              } @else if ((summary()?.streak ?? 0) > 0) {
                <span class="change up">▲ +{{ summary()?.streak }} streak</span>
              } @else if ((summary()?.streak ?? 0) < 0) {
                <span class="change down"
                  >▼ {{ summary()?.streak }} streak</span
                >
              } @else {
                <span class="change">— pas de streak</span>
              }
            </div>
            <div class="stat-bg-icon">🔢</div>
          </div>
        </div>
      } @else {
        <div class="stats-row">
          @for (_ of [0, 1, 2, 3]; track $index) {
            <div class="stat-card stat-skeleton"></div>
          }
        </div>
      }

      <!-- LIGNE 1 : Equity Curve pleine largeur -->
      <div class="top-charts-row">
        <div class="card equity-card equity-card-full">
          <div class="card-header">
            <div class="card-title">Equity Curve</div>
            <a routerLink="/analytics" class="card-action">Détails →</a>
          </div>
          <div class="chart-container">
            <canvas
              #equityCanvas
              style="width:100%;height:100%;display:block;position:absolute;inset:0;"
            ></canvas>
            @if (!userStore.isPremium() || equityCurve().length === 0) {
              <div class="empty-chart">
                @if (!userStore.isPremium()) {
                  Courbe disponible en Premium
                } @else {
                  Aucun trade enregistré
                }
              </div>
            }
          </div>
        </div>
      </div>

      <!-- LIGNE 2 : Trades + Win Rate + Émotions -->
      <div class="bottom-widgets-row">
        <!-- Derniers trades -->
        <div class="card recent-trades-card">
          <div class="card-header">
            <div class="card-title">Derniers trades</div>
            <a routerLink="/journal" class="card-action">Voir →</a>
          </div>
          @if (tradesStore.trades().length === 0) {
            <div class="empty-state">
              <p>Aucun trade</p>
              <small>Enregistre ton premier trade</small>
            </div>
          } @else {
            <div class="trade-list-compact">
              @for (trade of tradesStore.trades().slice(0, 4); track trade.id) {
                <div class="trade-row-compact">
                  <div class="trade-row-top">
                    <span
                      class="trade-side"
                      [class]="trade.side === 'LONG' ? 'long' : 'short'"
                      >{{ trade.side }}</span
                    >
                    <span class="trade-asset-compact">{{
                      trade.asset | uppercase
                    }}</span>
                    <span class="trade-emotion">{{
                      trade.emotion | emotionEmoji
                    }}</span>
                  </div>
                  <div class="trade-row-bottom">
                    <span class="trade-setup-compact">{{ trade.setup }}</span>
                    <span
                      class="trade-pnl"
                      [style.color]="trade.pnl | pnlColor"
                      >{{ trade.pnl | pnlFormat: trade.entry }}</span
                    >
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- Win Rate par stratégie -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Win Rate / stratégie</div>
            <a routerLink="/analytics" class="card-action">Voir →</a>
          </div>
          @if (bySetup().length === 0) {
            <p class="empty-widget-msg">
              Tes setups apparaîtront<br />après tes premiers trades
            </p>
          } @else {
            <div class="donut-wrap">
              <svg
                class="donut-svg"
                width="80"
                height="80"
                viewBox="0 0 100 100"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  fill="none"
                  stroke="var(--bg-3)"
                  stroke-width="12"
                />
                @for (seg of segments(); track seg.label) {
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    [attr.stroke]="seg.label | setupColorMap"
                    stroke-width="12"
                    [attr.stroke-dasharray]="seg.dash"
                    [attr.stroke-dashoffset]="seg.offset"
                    stroke-linecap="round"
                    transform="rotate(-90 50 50)"
                  />
                }
                <text
                  x="50"
                  y="53"
                  text-anchor="middle"
                  font-family="Syne"
                  font-weight="700"
                  font-size="14"
                  fill="#e2eaf5"
                >
                  {{ (summary()?.winRate ?? 0).toFixed(0) }}%
                </text>
              </svg>
              <div class="donut-legend">
                @for (s of bySetup().slice(0, 4); track s.setup) {
                  <div class="legend-item">
                    <div
                      class="legend-dot"
                      [style.background]="s.setup | setupColor"
                    ></div>
                    {{ s.setup | titlecase }}
                    <span class="legend-val">{{ s.winRate.toFixed(0) }}%</span>
                  </div>
                }
              </div>
            </div>
          }
        </div>

        <!-- États émotionnels -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">États émotionnels</div>
            <a routerLink="/analytics" class="card-action">Détails →</a>
          </div>
          @if (emotionStats().length === 0) {
            <p class="empty-widget-msg">
              Enregistre tes premiers trades<br />pour voir tes états
              émotionnels
            </p>
          } @else {
            <div class="emotion-grid">
              @for (e of emotionStats(); track e.emotion) {
                <div class="emotion-row">
                  <div class="emotion-label">
                    <span>{{ e.emotion | emotionLabel }}</span>
                    <span>{{ e.pct }}%</span>
                  </div>
                  <div class="bar-track">
                    <div
                      class="bar-fill"
                      [style.width.%]="e.pct"
                      [style.background]="e.emotion | emotionColor"
                    ></div>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </div>

      } <!-- fin @if V1 -->

      <!-- Modals — accessibles depuis tous les onglets -->
      <mtc-trade-form
        [open]="showTradeForm()"
        [isSaving]="isSavingTrade()"
        (dismissed)="showTradeForm.set(false)"
        (formSave)="saveTrade($event)"
      />

      @if (showPlanModal()) {
        <mtc-plan-modal (closed)="showPlanModal.set(false)" />
      }
    </div>
  `,
})
export class DashboardComponent implements AfterViewInit {
  @ViewChild('equityCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  protected readonly userStore = inject(UserStore);
  protected readonly tradesStore = inject(TradesStore);
  private readonly billingApi = inject(BillingApi);
  private readonly tradesApi = inject(TradesApi);
  private readonly analyticsApi = inject(AnalyticsApi);
  private readonly sessionApi = inject(SessionApi);
  private readonly ecoCalendarApi = inject(EcoCalendarApi);
  private readonly dailyRecapApi = inject(DailyRecapApi);
  private readonly debriefApi = inject(DebriefApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly showTradeForm = signal(false);
  protected readonly showPlanModal = signal(false);
  protected readonly isSavingTrade = signal(false);
  protected readonly today = new Date();

  // ── V2 Session Mode ─────────────────────────────────────────────────────
  protected readonly activeTab = signal<'dashboard' | 'morning' | 'live'>('dashboard');
  protected readonly selectedMood = signal<MoodState>('CONFIDENT');
  protected readonly activeSession = signal<TradingSession | null>(null);
  protected readonly todayStats = signal<LiveStats | null>(null);
  protected readonly todayTrades = signal<SessionTrade[]>([]);
  protected readonly yesterdayRecap = signal<DailyRecap | null>(null);
  protected readonly ecoCalendar = signal<EcoCalendarData | null>(null);
  protected readonly currentObjectives = signal<DebriefObjective[]>([]);
  protected readonly currentDebriefId = signal<string | null>(null);
  protected readonly monthlyActivity = signal<MonthlyActivitySummary | null>(null);
  protected readonly monthlyActivityLoading = signal(false);
  protected readonly calYear = signal(new Date().getFullYear());
  protected readonly calMonth = signal(new Date().getMonth() + 1);

  private readonly summaryResource = httpResource<{ data: AnalyticsSummary }>(
    () => `${environment.apiUrl}/analytics/summary`,
  );
  private readonly equityCurveResource = httpResource<{
    data: { points: EquityPoint[]; startingCapital: number | null };
  }>(() =>
    this.userStore.isPremium()
      ? `${environment.apiUrl}/analytics/equity-curve`
      : undefined,
  );
  private readonly bySetupResource = httpResource<{ data: SetupStat[] }>(() =>
    this.userStore.isPremium()
      ? `${environment.apiUrl}/analytics/by-setup`
      : undefined,
  );
  private readonly byEmotionResource = httpResource<{ data: EmotionStat[] }>(
    () =>
      this.userStore.isPremium()
        ? `${environment.apiUrl}/analytics/by-emotion`
        : undefined,
  );

  protected readonly summary = computed(
    () => this.summaryResource.value()?.data ?? null,
  );

  protected readonly drawdownDisplay = computed(() => {
    const dd = this.summary()?.maxDrawdown ?? 0;
    return dd > 0 ? -dd : dd;
  });

  protected readonly pnlColor = computed(() => {
    const pnl = this.summary()?.totalPnl ?? 0;
    if (pnl === 0) return 'var(--text-2)';
    return pnl > 0 ? 'var(--green)' : 'var(--red)';
  });

  protected readonly winRateColor = computed(() => {
    const wr = this.summary()?.winRate ?? 0;
    if (wr === 0) return 'var(--text-2)';
    return 'var(--blue-bright)';
  });

  protected readonly currentCapital = computed(() => {
    const start = this.userStore.startingCapital();
    const pnl = this.summary()?.totalPnl ?? 0;
    return start + pnl;
  });

  protected readonly capitalDisplay = computed(() => {
    const capital = this.currentCapital();
    const rate = this.userStore.user()?.currencyRate ?? 1;
    const currency = this.userStore.user()?.currency ?? 'USD';
    const converted = capital * rate;
    const symbol = currency === 'EUR' ? '€' : '$';
    return `${symbol}${Math.abs(converted).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  });

  protected readonly capitalPct = computed(() => {
    const start = this.userStore.startingCapital();
    if (start <= 0) return 0;
    return ((this.summary()?.totalPnl ?? 0) / start) * 100;
  });

  protected readonly capitalColor = computed(() => {
    const start = this.userStore.startingCapital();
    if (start <= 0) return 'var(--text-2)';
    const pnl = this.summary()?.totalPnl ?? 0;
    if (pnl === 0) return 'var(--text-2)';
    return pnl > 0 ? 'var(--green)' : 'var(--red)';
  });

  protected readonly drawdownColor = computed(() => {
    const dd = this.summary()?.maxDrawdown ?? 0;
    if (dd === 0) return 'var(--text-2)';
    return 'var(--red)';
  });

  protected readonly showGlobalStats = computed(
    () => !this.userStore.isBeta() || this.activeTab() !== 'live',
  );

  protected readonly equityCurve = computed(
    () => this.equityCurveResource.value()?.data?.points ?? [],
  );
  private readonly initialCapitalFromCurve = computed(
    () => this.equityCurveResource.value()?.data?.startingCapital ?? null,
  );
  protected readonly bySetup = computed(
    () => this.bySetupResource.value()?.data ?? [],
  );
  protected readonly byEmotion = computed(
    () => this.byEmotionResource.value()?.data ?? [],
  );

  protected readonly isLoading = computed(
    () =>
      this.userStore.isPremium() &&
      (this.summaryResource.isLoading() ||
        this.equityCurveResource.isLoading() ||
        this.bySetupResource.isLoading() ||
        this.byEmotionResource.isLoading()),
  );

  private readonly canDraw = signal(false);
  private resizeObserver?: ResizeObserver;
  private readonly knownTradesCount = signal(-1);

  constructor() {
    this.tradesStore.loadTrades({ limit: '6' });

    // Recharge la summary quand un nouveau trade apparaît dans le store
    // (cas du wizard : le trade est ajouté via addTrade sans passer par le dashboard)
    effect(() => {
      const count = this.tradesStore.totalTrades();
      const known = this.knownTradesCount();
      if (known !== -1 && count > known) {
        this.summaryResource.reload();
      }
      this.knownTradesCount.set(count);
    });

    effect(() => {
      if (
        !this.isLoading() &&
        this.canDraw() &&
        this.equityCurve().length > 0
      ) {
        this.drawEquityCurve();
      }
    });

    // ── V2 : charge les données bêta au démarrage ─────────────────────────
    if (this.userStore.isBeta()) {
      this.loadV2Data();
      this.loadMonthlyActivity();
    }

    // Auto-switch vers l'onglet live si une session est active
    effect(() => {
      if (this.activeSession()?.status === 'ACTIVE') {
        this.activeTab.set('live');
      }
    });

    // Polling 30s pour les stats live pendant une session active
    interval(30_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.activeSession()?.status === 'ACTIVE') {
          this.refreshLiveStats();
        }
      });
  }

  ngAfterViewInit() {
    this.canDraw.set(true);

    const container = this.canvasRef?.nativeElement?.parentElement;
    if (container) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.equityCurve().length > 1) this.drawEquityCurve();
      });
      this.resizeObserver.observe(container);
      this.destroyRef.onDestroy(() => this.resizeObserver?.disconnect());
    }
  }

  /** Segments du donut SVG — recalculés uniquement quand bySetup() change grâce à computed() */
  protected readonly segments = computed(() => {
    const setups = this.bySetup().slice(0, 4);
    if (!setups.length) return [];
    const circumference = 2 * Math.PI * 38; // r=38
    const total = setups.reduce((a, b) => a + b.count, 0);
    let offset = 0;
    return setups.map((s) => {
      const dash = (s.count / total) * circumference;
      const seg = {
        label: s.setup,
        dash: `${dash} ${circumference - dash}`,
        offset: -offset,
      };
      offset += dash;
      return seg;
    });
  });

  /** Pourcentage de trades par émotion, calculé depuis les trades locaux (pas d'appel API). */
  protected readonly emotionStats = computed(() => {
    const trades = this.tradesStore.trades();
    if (!trades.length) return [];
    const total = trades.length;
    return (
      [
        'REVENGE',
        'STRESSED',
        'CONFIDENT',
        'FOCUSED',
        'FEAR',
        'NEUTRAL',
      ] as const
    )
      .map((emotion) => ({
        emotion,
        pct: Math.round(
          (trades.filter((t) => t.emotion === emotion).length / total) * 100,
        ),
      }))
      .filter((e) => e.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 4);
  });

  protected readonly discordBannerDismissed = signal(
    localStorage.getItem('discord_banner_dismissed') === '1',
  );

  protected dismissDiscordBanner(): void {
    localStorage.setItem('discord_banner_dismissed', '1');
    this.discordBannerDismissed.set(true);
  }

  goToJournal() {
    this.showTradeForm.set(true);
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
          this.summaryResource.reload();
        },
        error: () => this.isSavingTrade.set(false),
      });
  }

  // ── V2 Session Mode ─────────────────────────────────────────────────────

  protected selectTab(tab: 'dashboard' | 'morning' | 'live'): void {
    this.activeTab.set(tab);
  }

  protected selectMood(mood: MoodState): void {
    this.selectedMood.set(mood);
  }

  protected startSession(): void {
    this.sessionApi
      .startSession(this.selectedMood())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.activeSession.set(res.data);
          this.activeTab.set('live');
          this.refreshLiveStats();
        },
      });
  }

  protected closeSession({ mood, note }: { mood: MoodState; note?: string }): void {
    const session = this.activeSession();
    if (!session) return;
    this.sessionApi
      .closeSession(session.id, mood, note)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.activeSession.set(res.data);
          this.activeTab.set('morning');
          this.summaryResource.reload();
        },
      });
  }

  protected confirmCloseTrade(event: { tradeId: string; exitPrice: number }): void {
    this.sessionApi
      .closeTrade(event.tradeId, event.exitPrice)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.refreshLiveStats() });
  }

  protected logQuickTrade(dto: CreateTradeDto): void {
    this.tradesApi
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.refreshLiveStats() });
  }

  protected loadMonthlyActivity(): void {
    this.monthlyActivityLoading.set(true);
    this.analyticsApi.getCurrentMonthActivity()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.monthlyActivity.set(res.data);
          this.monthlyActivityLoading.set(false);
        },
        error: () => this.monthlyActivityLoading.set(false),
      });
  }

  protected updateObjectiveNote(e: { index: number; note: string }): void {
    const updated = [...this.currentObjectives()];
    if (updated[e.index]) {
      updated[e.index] = { ...updated[e.index], note: e.note };
      this.currentObjectives.set(updated);
    }
  }

  private loadV2Data(): void {
    this.sessionApi
      .getActiveSession()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.activeSession.set(res.data ?? null);
          if (res.data?.status === 'ACTIVE') {
            this.refreshLiveStats();
          }
        },
      });

    this.dailyRecapApi
      .getYesterdayRecap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.yesterdayRecap.set(res.data ?? null),
      });

    this.loadEcoCalendar();

    this.debriefApi
      .getCurrent()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.currentObjectives.set(res.data?.objectives ?? []);
          this.currentDebriefId.set(res.data?.id ?? null);
        },
      });
  }

  readonly ecoCalendarIsNextDay = computed(() => {
    const now = new Date();
    const parisHour = parseInt(
      now.toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        hour: '2-digit',
        hour12: false,
      }),
      10,
    );
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    return this.activeTab() !== 'live' && (parisHour >= 18 || isWeekend);
  });

  readonly nextTradingDateStr = computed<string | null>(() => {
    if (!this.ecoCalendarIsNextDay()) return null;
    const d = new Date();
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });

  private loadEcoCalendar(): void {
    const now = new Date();
    const parisHour = parseInt(
      now.toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        hour: '2-digit',
        hour12: false,
      }),
      10,
    );
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    const isSessionLive = this.activeTab() === 'live';
    const useNextDay = !isSessionLive && (parisHour >= 18 || isWeekend);

    const obs = useNextDay
      ? this.ecoCalendarApi.getNextTradingDayEvents()
      : this.ecoCalendarApi.getTodayEvents();

    obs.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.ecoCalendar.set(res.data ?? null) });
  }

  private refreshLiveStats(): void {
    this.sessionApi
      .getLiveStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.todayStats.set(res.data);
          this.todayTrades.set(res.data.trades);
        },
      });
  }

  protected startTrial() {
    this.billingApi
      .checkout('monthly')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          window.location.href = res.data.url;
        },
        error: () => {
          /* billing error — user stays on page */
        },
      });
  }

  private drawEquityCurve() {
    const points = this.equityCurve();
    if (!this.canvasRef?.nativeElement || points.length < 2) return;

    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssW =
      canvas.getBoundingClientRect().width || canvas.offsetWidth || 800;
    const cssH =
      canvas.getBoundingClientRect().height || canvas.offsetHeight || 200;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.scale(dpr, dpr);

    const W = cssW;
    const H = cssH;
    const PAD = { top: 16, right: 24, bottom: 32, left: 62 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    const base = this.initialCapitalFromCurve() ?? 0;
    const values = [base, ...points.map((p) => base + p.cumulativePnl)];

    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const padding = (rawMax - rawMin) * 0.1 || rawMax * 0.05 || 1;
    const minV = rawMin - padding;
    const maxV = rawMax + padding;
    const range = maxV - minV;

    const toX = (i: number) => PAD.left + (i / (values.length - 1)) * cW;
    const toY = (v: number) => PAD.top + cH - ((v - minV) / range) * cH;

    const lastVal = values[values.length - 1] ?? 0;
    const firstVal = values[0] ?? 0;
    const isPositive = lastVal >= firstVal;
    const rgb = isPositive ? '59,130,246' : '239,68,68';
    const color = isPositive ? '#3b82f6' : '#ef4444';

    // Grille horizontale (5 niveaux) — lignes sans labels
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const v = minV + (range / gridCount) * i;
      const y = toY(v);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(99,155,255,0.08)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + cW, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const fmtVal = (v: number) =>
      Math.abs(v) >= 1000
        ? '$' + (v / 1000).toFixed(1) + 'k'
        : '$' + v.toFixed(0);

    ctx.font = '500 10px "DM Mono", "Courier New", monospace';
    ctx.textBaseline = 'middle';

    // Label bas-gauche : capital de départ (là où la courbe commence)
    ctx.fillStyle = 'rgba(112,144,176,0.75)';
    ctx.textAlign = 'right';
    ctx.fillText(fmtVal(firstVal), PAD.left - 8, toY(firstVal));

    // Label haut-droite : capital + P&L (valeur finale, près du dot)
    const lastX = toX(values.length - 1);
    const lastY = toY(lastVal);
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    const labelY = lastY > PAD.top + 14 ? lastY - 14 : lastY + 14;
    ctx.fillText(fmtVal(lastVal), lastX + 6, labelY);

    // Labels X : premier, milieu, dernier
    const xIndices = [
      1,
      Math.floor((values.length - 1) / 2),
      values.length - 1,
    ];
    for (const idx of xIndices) {
      const pt = points[idx - 1];
      if (!pt) continue;
      const d = new Date(pt.date);
      const label = d.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
      });
      ctx.fillStyle = 'rgba(112,144,176,0.6)';
      ctx.font = '400 9px "DM Mono", "Courier New", monospace';
      ctx.textAlign =
        idx === values.length - 1 ? 'right' : idx === 1 ? 'left' : 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, toX(idx), PAD.top + cH + 8);
    }

    // Bezier smooth helper
    const smoothPath = (vs: number[], close: boolean) => {
      ctx.moveTo(toX(0), toY(vs[0]));
      for (let i = 1; i < vs.length; i++) {
        const cpx = (toX(i - 1) + toX(i)) / 2;
        ctx.bezierCurveTo(
          cpx,
          toY(vs[i - 1]),
          cpx,
          toY(vs[i]),
          toX(i),
          toY(vs[i]),
        );
      }
      if (close) {
        ctx.lineTo(toX(vs.length - 1), PAD.top + cH);
        ctx.lineTo(PAD.left, PAD.top + cH);
        ctx.closePath();
      }
    };

    // Gradient fill
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, `rgba(${rgb}, 0.4)`);
    grad.addColorStop(0.5, `rgba(${rgb}, 0.12)`);
    grad.addColorStop(1, `rgba(${rgb}, 0.0)`);
    ctx.beginPath();
    smoothPath(values, true);
    ctx.fillStyle = grad;
    ctx.fill();

    // Ligne principale avec glow
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    smoothPath(values, false);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Dot final
    const lx = toX(values.length - 1);
    const ly = toY(lastVal);
    ctx.beginPath();
    ctx.arc(lx, ly, 7, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${rgb}, 0.3)`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}
