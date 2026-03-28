import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { environment } from '../../../environments/environment';

interface Trade {
  pnl: number | null;
  riskReward: number | null;
  emotion: string;
  setup: string;
  tradedAt: string;
}

interface ScoreAxis {
  name: string;
  key: string;
  emoji: string;
  score: number;
  description: string;
  detail: string;
}

function computeScore(trades: Trade[]): ScoreAxis[] {
  if (!trades.length) return defaultAxes(0);
  const closed = trades.filter((t) => t.pnl !== null);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const winRateScore = Math.min(100, winRate * 1.4);
  const revengeCount = trades.filter((t) => t.emotion === 'REVENGE').length;
  const disciplineScore = Math.max(0, 100 - (revengeCount / trades.length) * 200);
  const rrValues = closed.filter((t) => t.riskReward !== null).map((t) => t.riskReward!);
  const avgRR = rrValues.length ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length : 0;
  const riskScore = Math.min(100, avgRR * 33);
  const setups = [...new Set(trades.map((t) => t.setup))];
  const setupScores = setups.map((s) => {
    const st = closed.filter((t) => t.setup === s);
    return st.length ? st.filter((t) => (t.pnl ?? 0) > 0).length / st.length : 0;
  });
  const avgSetupWR = setupScores.length ? setupScores.reduce((a, b) => a + b, 0) / setupScores.length : 0;
  const variance = setupScores.reduce((acc, s) => acc + Math.pow(s - avgSetupWR, 2), 0) / (setupScores.length || 1);
  const consistencyScore = Math.max(0, 100 - variance * 400);
  const badEmotions = ['REVENGE', 'FEAR', 'STRESSED'];
  const badEmotionTrades = trades.filter((t) => badEmotions.includes(t.emotion));
  const badEmotionLosses = badEmotionTrades.filter((t) => (t.pnl ?? 0) < 0);
  const emotionScore = trades.length ? Math.max(0, 100 - (badEmotionLosses.length / trades.length) * 300) : 50;
  return [
    { name: 'Win Rate', key: 'winRate', emoji: '🎯', score: Math.round(winRateScore), description: 'Pourcentage de trades gagnants', detail: `${winRate.toFixed(1)}% sur ${closed.length} trades` },
    { name: 'Discipline', key: 'discipline', emoji: '🧘', score: Math.round(disciplineScore), description: 'Respect du plan de trading', detail: `${revengeCount} trade(s) en revenge` },
    { name: 'Risk Management', key: 'riskManagement', emoji: '🛡️', score: Math.round(riskScore), description: 'Gestion du risque et R/R', detail: `R/R moyen : ${avgRR.toFixed(2)}` },
    { name: 'Consistency', key: 'consistency', emoji: '📊', score: Math.round(consistencyScore), description: 'Régularité par setup', detail: `${setups.length} setup(s) utilisés` },
    { name: 'Émotion Control', key: 'emotionControl', emoji: '🧠', score: Math.round(emotionScore), description: 'Gestion des émotions néfastes', detail: `${badEmotionLosses.length} perte(s) avec mauvaise émotion` },
  ];
}

function defaultAxes(score: number): ScoreAxis[] {
  return [
    { name: 'Win Rate', key: 'winRate', emoji: '🎯', score, description: 'Pourcentage de trades gagnants', detail: 'Aucune donnée' },
    { name: 'Discipline', key: 'discipline', emoji: '🧘', score, description: 'Respect du plan de trading', detail: 'Aucune donnée' },
    { name: 'Risk Management', key: 'riskManagement', emoji: '🛡️', score, description: 'Gestion du risque et R/R', detail: 'Aucune donnée' },
    { name: 'Consistency', key: 'consistency', emoji: '📊', score, description: 'Régularité par setup', detail: 'Aucune donnée' },
    { name: 'Émotion Control', key: 'emotionControl', emoji: '🧠', score, description: 'Gestion des émotions néfastes', detail: 'Aucune donnée' },
  ];
}

function scoreColor(score: number): string {
  if (score >= 75) return '#10b981';
  if (score >= 50) return '#3b82f6';
  if (score >= 30) return '#f59e0b';
  return '#ef4444';
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Bon';
  if (score >= 50) return 'Correct';
  if (score >= 35) return 'À améliorer';
  return 'Critique';
}

@Component({
  selector: 'mtc-scoring',
  standalone: true,
  imports: [TopbarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mtc-topbar title="Score Trader" />

    <div class="content">
      @if (isLoading()) {
        <div class="loading">Calcul du score...</div>
      } @else {

        <!-- Global score -->
        <div class="global-card">
          <div class="ring-wrapper">
            <svg viewBox="0 0 120 120" class="ring-svg">
              <!-- Background ring -->
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--bg-3)" stroke-width="12"/>
              <!-- Score ring -->
              <circle
                cx="60" cy="60" r="50" fill="none"
                [attr.stroke]="scoreColor(globalScore())"
                stroke-width="12"
                stroke-linecap="round"
                stroke-dasharray="314"
                [attr.stroke-dashoffset]="314 - (314 * globalScore() / 100)"
                transform="rotate(-90 60 60)"
              />
              <!-- Center text -->
              <text x="60" y="56" text-anchor="middle" font-family="Syne" font-weight="800" font-size="22" [attr.fill]="scoreColor(globalScore())">{{ globalScore() }}</text>
              <text x="60" y="70" text-anchor="middle" font-family="DM Mono" font-size="11" fill="#4a6080">/100</text>
            </svg>
          </div>

          <div class="global-info">
            <div class="global-grade" [style.color]="scoreColor(globalScore())">{{ scoreLabel(globalScore()) }}</div>
            <p class="global-desc">Score basé sur {{ tradeCount() }} trade{{ tradeCount() > 1 ? 's' : '' }} analysés</p>
            <div class="breakdown">
              @for (axis of axes(); track axis.key) {
                <div class="breakdown-row">
                  <span>{{ axis.emoji }} {{ axis.name }}</span>
                  <span class="breakdown-score" [style.color]="scoreColor(axis.score)">{{ axis.score }}/100</span>
                </div>
              }
            </div>
          </div>
        </div>

        <!-- 5 axes -->
        <div class="axes-grid">
          @for (axis of axes(); track axis.key) {
            <div class="axis-card">
              <div class="axis-top">
                <div class="axis-emoji">{{ axis.emoji }}</div>
                <div class="axis-meta">
                  <span class="axis-name">{{ axis.name }}</span>
                  <span class="axis-desc">{{ axis.description }}</span>
                </div>
                <span class="axis-score" [style.color]="scoreColor(axis.score)">{{ axis.score }}</span>
              </div>

              <div class="progress-track">
                <div
                  class="progress-fill"
                  [style.width.%]="axis.score"
                  [style.background]="scoreColor(axis.score)"
                ></div>
              </div>

              <div class="axis-bottom">
                <span class="axis-detail">{{ axis.detail }}</span>
                <span class="axis-label" [style.color]="scoreColor(axis.score)">{{ scoreLabel(axis.score) }}</span>
              </div>
            </div>
          }
        </div>

        @if (tradeCount() < 10) {
          <div class="advice-banner">
            💡 Enregistre au moins <strong>10 trades</strong> pour un score représentatif
            ({{ tradeCount() }}/10 actuellement)
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .content { padding: 28px; flex: 1; max-width: 1100px; }
    .loading { color: var(--text-2); padding: 2rem 0; }

    /* ─── Global card ─── */
    .global-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 28px;
      display: flex;
      gap: 32px;
      align-items: center;
      margin-bottom: 20px;
    }

    .ring-wrapper { flex-shrink: 0; }
    .ring-svg { width: 140px; height: 140px; }
    circle { transition: stroke-dashoffset 0.8s ease; }

    .global-info { flex: 1; }

    .global-grade {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 4px;
    }

    .global-desc { font-size: 13px; color: var(--text-2); margin-bottom: 16px; }

    .breakdown { display: flex; flex-direction: column; gap: 6px; }

    .breakdown-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-2);
      gap: 16px;
    }

    .breakdown-score { font-family: var(--font-mono); font-weight: 600; }

    /* ─── Axes grid ─── */
    .axes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }

    .axis-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
      transition: border-color 0.2s;
    }

    .axis-card:hover { border-color: var(--border-hover); }

    .axis-top {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 14px;
    }

    .axis-emoji { font-size: 20px; flex-shrink: 0; margin-top: 1px; }

    .axis-meta { flex: 1; }

    .axis-name {
      font-family: var(--font-display);
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      display: block;
      margin-bottom: 2px;
    }

    .axis-desc { font-size: 11px; color: var(--text-3); }

    .axis-score {
      font-family: var(--font-display);
      font-size: 22px;
      font-weight: 800;
      margin-left: auto;
    }

    /* ─── Progress bar ─── */
    .progress-track {
      background: var(--bg-3);
      border-radius: 4px;
      height: 6px;
      overflow: hidden;
      margin-bottom: 12px;
    }

    .progress-fill {
      height: 6px;
      border-radius: 4px;
      transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
      min-width: 4px;
    }

    .axis-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .axis-detail { font-size: 11px; color: var(--text-3); font-family: var(--font-mono); }
    .axis-label { font-size: 11px; font-weight: 600; font-family: var(--font-mono); }

    /* ─── Advice ─── */
    .advice-banner {
      background: rgba(245,158,11,0.08);
      border: 1px solid rgba(245,158,11,0.2);
      color: var(--yellow);
      border-radius: 10px;
      padding: 12px 16px;
      font-size: 13px;
    }
  `],
})
export class ScoringComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly isLoading = signal(true);
  private readonly trades = signal<Trade[]>([]);

  protected readonly axes = computed(() => computeScore(this.trades()));
  protected readonly globalScore = computed(() => {
    const a = this.axes();
    return a.length ? Math.round(a.reduce((sum, x) => sum + x.score, 0) / a.length) : 0;
  });
  protected readonly tradeCount = computed(() => this.trades().length);
  protected readonly scoreColor = scoreColor;
  protected readonly scoreLabel = scoreLabel;

  ngOnInit() {
    this.http.get<{ data: { data: Trade[] } }>(`${environment.apiUrl}/trades?limit=100`).subscribe({
      next: (res) => { this.trades.set(res.data.data); this.isLoading.set(false); },
      error: () => this.isLoading.set(false),
    });
  }
}
