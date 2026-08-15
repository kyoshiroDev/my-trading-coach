import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
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

@Component({
  selector: 'mtc-dashboard',
  standalone: true,
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
  template: `
    <mtc-topbar
      title="Dashboard"
      [period]="periodLabel()"
      addLabel="⚡ Ajouter trade"
      [showAccountSelector]="true"
      (addClick)="goToJournal()"
    >
      @if (sessionStore.hasActiveSession()) {
        <a routerLink="/session" class="sess-active-pill">
          <div class="sess-pulse-dot"></div>
          <span>Session en cours</span>
          <span class="sess-pnl-top" [style.color]="(sessionStore.todayStats()?.totalPnl ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'">
            {{ (sessionStore.todayStats()?.totalPnl ?? 0) >= 0 ? '+' : '' }}{{ (sessionStore.todayStats()?.totalPnl ?? 0).toFixed(0) }}$
          </span>
          <span style="color:var(--text-3);font-size:11px;">→</span>
        </a>
      }
    </mtc-topbar>

    <div class="content">
      @if (selectedAccount.loaded() && tradesStore.totalTrades() === 0) {
        <div class="firstrun-hero">
          <div class="firstrun-text">
            <h2 class="firstrun-title">Fais ton premier pas 🚀</h2>
            <p class="firstrun-sub">Logge ton premier trade ou démarre une session : c'est là que ton coach commence à t'aider.</p>
          </div>
          <div class="firstrun-actions">
            <button class="firstrun-btn primary" (click)="goToJournal()">Enregistrer mon premier trade</button>
            <button class="firstrun-btn ghost" data-testid="firstrun-import" (click)="openCsvImport()">Importer mes trades</button>
            <a class="firstrun-btn ghost" routerLink="/session">Démarrer une session</a>
          </div>
        </div>
      }

      @if (userStore.profileIncomplete()) {
        <div class="limit-banner near" data-testid="profile-nudge">
          <div class="limit-banner-left">
            <span class="limit-banner-ic">✨</span>
            <div>
              <div class="limit-banner-title">Complète ton profil de trader</div>
              <div class="limit-banner-sub">Stratégie + actifs principaux → analyses IA bien plus personnalisées.</div>
            </div>
          </div>
          <button class="limit-banner-btn" (click)="goToSettings()">Compléter</button>
        </div>
      }

      @if (!userStore.isPremium()) {
        <div class="premium-banner">
          <div class="premium-banner-left">
            <span class="premium-banner-icon">⚡</span>
            <div>
              <div class="premium-banner-title">Passe à Premium</div>
              <div class="premium-banner-sub">Weekly Debrief, IA Insights, Chat coach, analytics avancés &amp; comptes illimités</div>
            </div>
          </div>
          <div class="premium-banner-right">
            <div class="premium-banner-price">
              <span class="premium-banner-amount">{{ PRICING.premium.monthly }}€</span>
              <span class="premium-banner-period">/mois</span>
              <div class="premium-banner-trial">1 mois offert · carte requise</div>
            </div>
            <button class="premium-banner-btn" (click)="showPlanModal.set(true)">Essayer Premium</button>
          </div>
        </div>
      }

      @if (!isLoading()) {
        <div class="mtc-kpis">
          <!-- Capital -->
          <div class="mtc-kpi" style="--glow:var(--blue)">
            <div class="mtc-kpi-l">
              <div class="mtc-kpi-lab">Capital
                <mtc-info-tooltip class="align-start" label="Comment le capital est calculé"
                  text="Capital de départ du compte, ajusté du P&L net de tes trades." />
              </div>
              <div class="mtc-kpi-val" data-testid="dashboard-capital" [style.color]="capitalColor()">{{ capitalDisplay() }}</div>
              <div class="mtc-kpi-sub">
                @if (capitalPct() !== 0) {
                  <span [style.color]="capitalPct() > 0 ? 'var(--green)' : 'var(--red)'">{{ capitalPct() > 0 ? '+' : '' }}{{ capitalPct() | number:'1.1-1' }}% {{ periodShort() }}</span>
                } @else { base }
              </div>
            </div>
            @let cap = sparkPath(capitalSeries());
            @if (cap.line) {
              <svg class="mtc-spark" viewBox="0 0 72 42" preserveAspectRatio="none" width="72" height="42">
                <path [attr.d]="cap.area" fill="var(--blue)" fill-opacity="0.13" />
                <path [attr.d]="cap.line" fill="none" stroke="var(--blue-bright)" stroke-width="1.6" stroke-linejoin="round" />
                <circle [attr.cx]="cap.cx" [attr.cy]="cap.cy" r="1.9" fill="var(--blue-bright)" />
              </svg>
            }
          </div>
          <!-- P&L net mois -->
          <div class="mtc-kpi" style="--glow:var(--green)">
            <div class="mtc-kpi-l">
              <div class="mtc-kpi-lab">P&amp;L net</div>
              <div class="mtc-kpi-val" [style.color]="pnlColor()">{{ summary()?.totalPnl ?? 0 | pnlFormat }}</div>
              <div class="mtc-kpi-sub">
                @if ((summary()?.totalTrades ?? 0) > 0) { {{ periodShort() }} } @else { Aucune donnée }
              </div>
            </div>
            @let pnl = sparkPath(eqSeries());
            @if (pnl.line) {
              <svg class="mtc-spark" viewBox="0 0 72 42" preserveAspectRatio="none" width="72" height="42">
                <path [attr.d]="pnl.area" fill="var(--green)" fill-opacity="0.13" />
                <path [attr.d]="pnl.line" fill="none" stroke="var(--green)" stroke-width="1.6" stroke-linejoin="round" />
                <circle [attr.cx]="pnl.cx" [attr.cy]="pnl.cy" r="1.9" fill="var(--green)" />
              </svg>
            }
          </div>
          <!-- Win rate -->
          <div class="mtc-kpi" style="--glow:var(--blue)">
            <div class="mtc-kpi-l">
              <div class="mtc-kpi-lab">Win rate
                <mtc-info-tooltip label="Comment le win rate est calculé"
                  text="Trades gagnants ÷ (gagnants + perdants). Les break-even sont exclus du calcul." />
              </div>
              <div class="mtc-kpi-val" [style.color]="winRateColor()">{{ (summary()?.winRate ?? 0).toFixed(1) }}%</div>
              <div class="mtc-kpi-sub">
                @if ((summary()?.totalTrades ?? 0) > 0) { sur {{ summary()?.totalTrades }} trades } @else { Aucune donnée }
              </div>
            </div>
            <div class="mtc-mini-donut" [style.background]="winRateDonut()"><span></span></div>
          </div>
          <!-- Profit factor -->
          <div class="mtc-kpi" style="--glow:var(--purple)">
            <div class="mtc-kpi-l">
              <div class="mtc-kpi-lab">Profit factor
                <mtc-info-tooltip label="Comment le profit factor est calculé"
                  text="Somme des gains ÷ somme des pertes. Au-dessus de 1, tes gains dépassent tes pertes. Affiche « - » tant que tu n'as aucune perte." />
              </div>
              <div class="mtc-kpi-val">{{ profitFactorDisplay() }}</div>
              <div class="mtc-kpi-sub">
                @if ((summary()?.totalTrades ?? 0) > 0) { profits / pertes } @else { Aucune donnée }
              </div>
            </div>
            @let pf = sparkPath(eqSeries());
            @if (pf.line) {
              <svg class="mtc-spark" viewBox="0 0 72 42" preserveAspectRatio="none" width="72" height="42">
                <path [attr.d]="pf.area" fill="var(--purple)" fill-opacity="0.13" />
                <path [attr.d]="pf.line" fill="none" stroke="var(--purple-bright)" stroke-width="1.6" stroke-linejoin="round" />
                <circle [attr.cx]="pf.cx" [attr.cy]="pf.cy" r="1.9" fill="var(--purple-bright)" />
              </svg>
            }
          </div>
          <!-- Trades pris -->
          <div class="mtc-kpi" style="--glow:var(--green)">
            <div class="mtc-kpi-l">
              <div class="mtc-kpi-lab">Trades pris
                <mtc-info-tooltip label="Ce que compte « Trades pris »"
                  text="Nombre de trades clôturés sur la période." />
              </div>
              <div class="mtc-kpi-val">{{ summary()?.totalTrades ?? tradesStore.trades().length }}</div>
              <div class="mtc-kpi-sub">
                @if ((summary()?.streak ?? 0) > 0) { <span style="color:var(--green)">+{{ summary()?.streak }} streak</span> }
                @else if ((summary()?.streak ?? 0) < 0) { <span style="color:var(--red)">{{ summary()?.streak }} streak</span> }
                @else { ce mois }
              </div>
            </div>
            <div class="mtc-minibars">
              @for (b of [.45,.7,.4,.85,.55,.95,.6,.75,.5,.9,.65,.8]; track $index) {
                <span [style.height.%]="b * 100" [style.opacity]="0.4 + b * 0.5"></span>
              }
            </div>
          </div>
          <!-- Drawdown max -->
          <div class="mtc-kpi" style="--glow:var(--red)">
            <div class="mtc-kpi-l">
              <div class="mtc-kpi-lab">Drawdown max
                <mtc-info-tooltip class="align-end" label="Comment le drawdown max est calculé"
                  text="Plus forte baisse de ton P&L cumulé depuis un sommet, sur la période affichée." />
              </div>
              <div class="mtc-kpi-val" [style.color]="drawdownColor()">{{ drawdownDisplay() | pnlFormat }}</div>
              <div class="mtc-kpi-sub">
                @if ((summary()?.totalTrades ?? 0) > 0) { sur capital } @else { Aucune donnée }
              </div>
            </div>
            @let dd = sparkPath(ddSeries());
            @if (dd.line) {
              <svg class="mtc-spark" viewBox="0 0 72 42" preserveAspectRatio="none" width="72" height="42">
                <path [attr.d]="dd.area" fill="var(--red)" fill-opacity="0.13" />
                <path [attr.d]="dd.line" fill="none" stroke="var(--red)" stroke-width="1.6" stroke-linejoin="round" />
                <circle [attr.cx]="dd.cx" [attr.cy]="dd.cy" r="1.9" fill="var(--red)" />
              </svg>
            }
          </div>
        </div>
      } @else {
        <div class="mtc-kpis">
          @for (_ of [0, 1, 2, 3, 4]; track $index) {
            <div class="mtc-kpi stat-skeleton" style="height:96px"></div>
          }
        </div>
      }

      <!-- Grille flagship (fidèle au design : 6 panels en 2 colonnes, sans calendrier) -->
      <div class="mtc-grid">
        <!-- Courbe d'équité -->
        <div class="mtc-panel">
          <div class="mtc-panel-head">
            <div class="mtc-panel-head-l"><lucide-icon [img]="EquityIcon" [size]="15" class="mtc-phi" /><div><div class="mtc-panel-title">Courbe d'équité</div><div class="mtc-panel-sub">{{ equitySub() }}</div></div></div>
            <div class="mtc-eq-tabs">
              @for (p of periods; track p.key) {
                <button type="button" [class.on]="dashboardPeriod() === p.key" (click)="setPeriod(p.key)">{{ p.label }}</button>
              }
            </div>
          </div>
          <div class="mtc-panel-body">
            <!-- Courbe d'équité simple = vue de base FREE (profondeur = page /analytics). -->
            @let eg = equityGlow();
            @if (eg) {
              <svg class="mtc-equity" [attr.viewBox]="'0 0 ' + eg.W + ' ' + eg.H" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="mtcEqFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" [attr.stop-color]="eg.color" stop-opacity="0.35" />
                    <stop offset="100%" [attr.stop-color]="eg.color" stop-opacity="0" />
                  </linearGradient>
                  <filter id="mtcEqGlow" x="-20%" y="-50%" width="140%" height="200%">
                    <feGaussianBlur stdDeviation="3.4" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                <path [attr.d]="eg.area" fill="url(#mtcEqFill)" />
                <path [attr.d]="eg.trend" fill="none" stroke="rgba(143,163,191,.4)" stroke-width="1" stroke-dasharray="3 4" />
                <path [attr.d]="eg.line" fill="none" [attr.stroke]="eg.color" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" filter="url(#mtcEqGlow)" />
                <circle class="mtc-eq-pulse" [attr.cx]="eg.lastX" [attr.cy]="eg.lastY" r="7" [attr.fill]="eg.color" opacity="0.25" />
                <circle [attr.cx]="eg.lastX" [attr.cy]="eg.lastY" r="3.4" [attr.fill]="eg.color" />
              </svg>
            } @else {
              <div class="mtc-empty">{{ equityEmptyMsg() }}</div>
            }
          </div>
        </div>

        <!-- Top actifs -->
        <div class="mtc-panel">
          <div class="mtc-panel-head"><div class="mtc-panel-head-l"><lucide-icon [img]="AssetsIcon" [size]="15" class="mtc-phi" /><div><div class="mtc-panel-title">Top actifs</div><div class="mtc-panel-sub">P&amp;L par instrument</div></div></div></div>
          <div class="mtc-panel-body">
            <!-- Top actifs (P&L par instrument) = vue de base FREE ; win rate/actif = profondeur Premium. -->
            @if (topAssets().length) {
              <div class="mtc-hbars">
                @for (a of topAssets(); track a.asset) {
                  <div class="mtc-hbar">
                    <div class="mtc-hbar-l">
                      <div class="mtc-hbar-name">{{ a.asset | uppercase }}</div>
                      <div class="mtc-hbar-meta">{{ a.count }} trade{{ a.count > 1 ? 's' : '' }}@if (userStore.isPremium()) { · {{ a.winRate.toFixed(0) }}%}</div>
                    </div>
                    <div class="mtc-hbar-track"><div class="mtc-hbar-fill" [class.neg]="a.pnl < 0" [style.width.%]="a.barPct"></div></div>
                    <div class="mtc-hbar-v" [style.color]="a.pnl >= 0 ? 'var(--green)' : 'var(--red)'">{{ a.pnl | pnlFormat }}</div>
                  </div>
                }
              </div>
            } @else { <p class="empty-widget-msg">Tes actifs apparaîtront<br />après tes premiers trades</p> }
          </div>
        </div>

        <!-- P&L par jour -->
        <div class="mtc-panel">
          <div class="mtc-panel-head"><div class="mtc-panel-head-l"><lucide-icon [img]="PlDayIcon" [size]="15" class="mtc-phi" /><div><div class="mtc-panel-title">{{ plTitle() }} <mtc-info-tooltip [text]="plTooltip()" /></div><div class="mtc-panel-sub">{{ periodLabel() }}</div></div></div></div>
          <div class="mtc-panel-body">
            @let pl = plBuckets();
            @if (pl && pl.length) {
              <div class="mtc-plday">
                @for (d of pl; track d.key) {
                  <div class="mtc-plday-col" [title]="d.title + ' · ' + (d.pnl >= 0 ? '+' : '') + (d.pnl | number: '1.0-0') + '$'">
                    <div class="mtc-plday-cell">
                      <div class="mtc-plday-bar" [class.pos]="d.pos && d.traded" [class.neg]="!d.pos && d.traded" [style.height.%]="d.barPct"></div>
                      @if (d.traded && d.label) {
                        <span class="mtc-plday-val" [class.pos]="d.pos" [class.neg]="!d.pos"
                          [style.bottom]="d.pos ? 'calc(50% + ' + d.barPct + '%)' : null"
                          [style.top]="!d.pos ? 'calc(50% + ' + d.barPct + '%)' : null">{{ d.label }}</span>
                      }
                    </div>
                    <span class="mtc-plday-day" [class.traded]="d.traded">{{ d.axisLabel }}</span>
                  </div>
                }
              </div>
            } @else { <div class="mtc-empty">Aucune activité sur la période</div> }
          </div>
        </div>

        <!-- AI Coach -->
        <div class="mtc-panel" [class.mtc-ai]="userStore.isPremium()">
          <div class="mtc-panel-head">
            <div class="mtc-panel-head-l"><lucide-icon [img]="CoachIcon" [size]="15" class="mtc-phi" /><div><div class="mtc-panel-title">AI Coach · feedback</div></div></div>
            <!-- Pastille LIVE réservée à la carte réellement active (Premium) — jamais sur un teaser verrouillé. -->
            @if (userStore.isPremium()) {
              <span class="mtc-live"><span class="mtc-live-dot"></span>LIVE</span>
            }
          </div>
          <div class="mtc-panel-body">
            @if (userStore.isPremium()) {
              @if (coachInsights().length) {
                <div class="mtc-coach-list">
                  @for (i of coachInsights(); track i.text) {
                    <div class="mtc-coach-item">
                      <lucide-icon [img]="coachIcon(i.tone)" [size]="16" [style.color]="coachColor(i.tone)" class="mtc-coach-item-ic" />
                      <span class="mtc-coach-item-t">{{ i.text }}</span>
                    </div>
                  }
                  <a routerLink="/analytics" class="mtc-coach-btn">Voir mon coaching complet</a>
                </div>
              } @else {
                <div class="mtc-coach-cta">
                  <div class="mtc-coach-ic">✨</div>
                  <div class="mtc-coach-t">Ton coach analyse tes patterns</div>
                  <div class="mtc-coach-s">Enregistre quelques trades pour débloquer tes premiers insights personnalisés.</div>
                  <a routerLink="/analytics" class="mtc-coach-btn">Voir mon coaching complet</a>
                </div>
              }
            } @else {
              <div class="mtc-coach-lock">
                <div class="mtc-lock-ic"><lucide-icon [img]="LockIcon" [size]="20" /></div>
                <div class="mtc-lock-t">Coach IA réservé au Premium</div>
                <div class="mtc-lock-s">Analyse de tes patterns, chat coach IA et recommandations personnalisées.</div>
                <button class="mtc-lock-cta" (click)="showPlanModal.set(true)">Débloquer à {{ PRICING.premium.monthly }} €/mois</button>
              </div>
            }
          </div>
        </div>

        <!-- Répartition stratégies -->
        <div class="mtc-panel">
          <div class="mtc-panel-head"><div class="mtc-panel-head-l"><lucide-icon [img]="SetupsIcon" [size]="15" class="mtc-phi" /><div><div class="mtc-panel-title">Répartition stratégies</div><div class="mtc-panel-sub">% des trades par setup</div></div></div></div>
          <div class="mtc-panel-body">
            <!-- Répartition % des setups = vue de base FREE (client-side) ; centre win rate = Premium. -->
            @let sd = setupsDonutView();
            @if (sd) {
              <div class="mtc-donut-row">
                <div class="mtc-donut" [style.background]="sd.gradient"><div class="mtc-donut-hole"><span class="mtc-donut-v">{{ sd.centerValue }}</span><span class="mtc-donut-l">{{ sd.centerLabel }}</span></div></div>
                <div class="mtc-legend">
                  @for (l of sd.legend; track l.label) {
                    <div class="mtc-legend-item"><span class="mtc-legend-dot" [style.background]="l.color"></span><span class="mtc-legend-lab">{{ l.label }}</span><span class="mtc-legend-pct">{{ l.pct }}%</span></div>
                  }
                </div>
              </div>
            } @else { <p class="empty-widget-msg">Tes setups apparaîtront<br />après tes premiers trades</p> }
          </div>
        </div>

        <!-- États émotionnels -->
        <div class="mtc-panel">
          <div class="mtc-panel-head"><div class="mtc-panel-head-l"><lucide-icon [img]="EmotionIcon" [size]="15" class="mtc-phi" /><div><div class="mtc-panel-title">États émotionnels</div><div class="mtc-panel-sub">par fréquence</div></div></div></div>
          <div class="mtc-panel-body">
            @let ed = emotionsDonut();
            @if (ed) {
              <div class="mtc-donut-row">
                <div class="mtc-donut" [style.background]="ed.gradient"><div class="mtc-donut-hole"><span class="mtc-donut-v">{{ ed.centerValue }}</span><span class="mtc-donut-l">{{ ed.centerLabel | emotionLabel }}</span></div></div>
                <div class="mtc-legend">
                  @for (e of emotionStats(); track e.emotion) {
                    <div class="mtc-legend-item"><span class="mtc-legend-dot" [style.background]="e.emotion | emotionColor"></span><span class="mtc-legend-lab">{{ e.emotion | emotionLabel }}</span><span class="mtc-legend-pct">{{ e.pct }}%</span></div>
                  }
                </div>
              </div>
            } @else { <p class="empty-widget-msg">Enregistre tes premiers trades<br />pour voir tes états émotionnels</p> }
          </div>
        </div>
      </div>

      <!-- Historique des trades -->
      <div class="mtc-panel">
        <div class="mtc-panel-head"><div class="mtc-panel-head-l"><lucide-icon [img]="TableIcon" [size]="15" class="mtc-phi" /><div class="mtc-panel-title">Historique des trades</div></div><a routerLink="/journal" class="card-action">Tout le journal →</a></div>
        @if (tradeRows().length === 0) {
          <div class="empty-state" style="margin:0 18px 18px"><p>Aucun trade</p><small>Enregistre ton premier trade</small></div>
        } @else {
          <div class="mtc-table-wrap">
            <table class="mtc-table">
              <thead><tr>
                <th>Date</th><th>Actif</th><th>Direction</th><th>Stratégie</th>
                <th class="r">Entrée</th><th class="r">Sortie</th><th class="r">R:R</th><th class="r">P&amp;L</th><th class="r">P&amp;L %</th><th class="c">Résultat</th>
              </tr></thead>
              <tbody>
                @for (t of tradeRows(); track t.id) {
                  <tr>
                    <td class="mono dim">{{ t.tradedAt | date:'d MMM' }}</td>
                    <td class="mono strong">{{ t.asset | uppercase }}</td>
                    <td><span class="mtc-side" [class.long]="t.side === 'LONG'">{{ t.side }}</span></td>
                    <td><span class="mtc-setup-cell"><span class="setup-dot-sm" [style.background]="t.setup.color"></span>{{ t.setup.title }}</span></td>
                    <td class="mono dim r">{{ t.entry | number:'1.0-2' }}</td>
                    <td class="mono dim r">{{ t.exit !== null ? (t.exit | number:'1.0-2') : '-' }}</td>
                    <td class="mono dim r">{{ t.riskReward !== null ? ((t.riskReward >= 0 ? '+' : '') + (t.riskReward | number:'1.1-1')) : '-' }}</td>
                    <td class="mono strong r" [style.color]="t.win ? 'var(--green)' : 'var(--red)'">{{ t.pnl | pnlFormat }}</td>
                    <td class="mono r" [style.color]="t.pct === null ? 'var(--text-3)' : (t.win ? 'var(--green)' : 'var(--red)')">{{ t.pct === null ? '-' : ((t.pct >= 0 ? '+' : '') + (t.pct | number:'1.2-2') + '%') }}</td>
                    <td class="c"><span class="mtc-res" [class.win]="t.win">{{ t.win ? 'WIN' : 'LOSS' }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <mtc-trade-form
        [open]="showTradeForm()"
        [isSaving]="isSavingTrade()"
        (dismissed)="showTradeForm.set(false)"
        (formSave)="saveTrade($event)"
      />

      <mtc-csv-import
        [open]="showCsvImport()"
        (dismissed)="showCsvImport.set(false)"
        (imported)="onCsvImported()"
      />

      @if (showPlanModal()) {
        <mtc-plan-modal (closed)="showPlanModal.set(false)" />
      }
    </div>
  `,
})
export class DashboardComponent {
  protected readonly userStore    = inject(UserStore);
  protected readonly tradesStore  = inject(TradesStore);
  protected readonly sessionStore = inject(SessionStore);
  protected readonly selectedAccount = inject(SelectedAccountStore);
  private  readonly billingApi    = inject(BillingApi);
  private  readonly tradesApi     = inject(TradesApi);
  private  readonly destroyRef    = inject(DestroyRef);
  private  readonly router        = inject(Router);

  protected goToSettings(): void { this.router.navigate(['/profil']); }

  protected readonly showTradeForm = signal(false);
  protected readonly showCsvImport = signal(false);
  protected readonly showPlanModal = signal(false);
  protected readonly isSavingTrade = signal(false);
  protected readonly PRICING = PRICING;

  // Icônes d'en-tête de panel (Lucide) — fidélité design.
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
  protected setPeriod(p: '1M' | '3M' | '6M' | 'ALL'): void { this.dashboardPeriod.set(p); }

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
  // Activité journalière (P&L par jour) sur la même période — agrégée jour/semaine/mois côté front.
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

  /** Top actifs par P&L (HBars) — largeur de barre précalculée sur le max absolu. */
  protected readonly topAssets = computed(() => {
    const list = (this.topAssetsResource.value()?.data ?? []).slice(0, 5);
    const max = Math.max(...list.map((a) => Math.abs(a.pnl)), 1);
    return list.map((a) => ({ ...a, barPct: (Math.abs(a.pnl) / max) * 100 }));
  });

  /** Profit factor : valeur 2 décimales, ∞ si aucune perte, — si aucune donnée. */
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
   * Capital de base, source unique scopée au compte sélectionné — miroir EXACT
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
    return this.selectedAccount
      .accounts()
      .filter((a) => a.status !== 'ARCHIVED')
      .reduce((s, a) => s + (a.metrics.startingBalance ?? 0), 0);
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
   * comptes ou les données de base (summary, courbe d'équité) ne sont PAS chargés — pour
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

  private readonly knownTradesCount = signal(-1);
  private readonly knownAccountsCount = signal(-1);

  constructor() {
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
  /** Drawdown courant (val − pic) le long de la courbe — série rouge des KPI. */
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
   * Granularité des barres « P&L par jour » — pilotée par le NOMBRE de barres, pas par le nom
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

  // Helpers de dates (front) — semaine ISO alignée sur le journal (PROMPT-170), pas de getDay() brut.
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
  /** Lundi de la semaine ISO d'une date — même définition que le journal ((getDay()+6)%7). */
  private mondayOf(d: Date): Date {
    const dow = (d.getDay() + 6) % 7; // lundi = 0 … dimanche = 6
    const m = new Date(d);
    m.setDate(d.getDate() - dow);
    return this.atNoon(m);
  }

  /**
   * Barres P&L par période — agrégées jour / semaine / mois selon `plGranularity`. Les jours
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

  /** Stats par émotion (R moyen / win rate) — source du feedback coach. */
  protected readonly byEmotion = computed(() => this.byEmotionResource.value()?.data ?? []);

  /**
   * Feedback « AI Coach » dérivé des VRAIES données (summary + émotions + setups) —
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
    this.tradesStore.reset();
    this.tradesStore.loadTrades({ limit: '6' });
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
        },
        error: () => this.isSavingTrade.set(false),
      });
  }

  protected startTrial() {
    this.billingApi
      .checkout('premium_monthly')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => { window.location.href = res.data.url; } });
  }
}