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

interface ScoreBar {
  name: string;
  score: number;
  color: string;
}

function computeScore(trades: Trade[]): ScoreBar[] {
  if (!trades.length) return defaultBars(0);

  const closed = trades.filter((t) => t.pnl !== null);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;

  const revengeCount = trades.filter((t) => t.emotion === 'REVENGE').length;
  const disciplineScore = Math.min(100, Math.max(0, 100 - (revengeCount / trades.length) * 200));

  const perfScore = Math.min(100, winRate * 1.4);

  const badEmotions = ['REVENGE', 'FEAR', 'STRESSED'];
  const badLosses = trades.filter((t) => badEmotions.includes(t.emotion) && (t.pnl ?? 0) < 0);
  const psychScore = Math.max(0, 100 - (badLosses.length / trades.length) * 300);

  const rrValues = closed.filter((t): t is typeof t & { riskReward: number } => t.riskReward != null).map((t) => t.riskReward);
  const avgRR = rrValues.length ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length : 0;
  const riskScore = Math.min(100, avgRR * 33);

  const setups = [...new Set(trades.map((t) => t.setup))];
  const setupWRs = setups.map((s) => {
    const st = closed.filter((t) => t.setup === s);
    return st.length ? st.filter((t) => (t.pnl ?? 0) > 0).length / st.length : 0;
  });
  const avg = setupWRs.length ? setupWRs.reduce((a, b) => a + b, 0) / setupWRs.length : 0;
  const variance = setupWRs.reduce((acc, s) => acc + Math.pow(s - avg, 2), 0) / (setupWRs.length || 1);
  const consistScore = Math.max(0, 100 - variance * 400);

  return [
    { name: 'Discipline',      score: Math.round(disciplineScore), color: barColor(Math.round(disciplineScore)) },
    { name: 'Performance',     score: Math.round(perfScore),       color: barColor(Math.round(perfScore)) },
    { name: 'Psychologie',     score: Math.round(psychScore),      color: barColor(Math.round(psychScore)) },
    { name: 'Gestion risque',  score: Math.round(riskScore),       color: barColor(Math.round(riskScore)) },
    { name: 'Consistance',     score: Math.round(consistScore),    color: barColor(Math.round(consistScore)) },
  ];
}

function defaultBars(score: number): ScoreBar[] {
  return [
    { name: 'Discipline',     score, color: barColor(score) },
    { name: 'Performance',    score, color: barColor(score) },
    { name: 'Psychologie',    score, color: barColor(score) },
    { name: 'Gestion risque', score, color: barColor(score) },
    { name: 'Consistance',    score, color: barColor(score) },
  ];
}

function barColor(score: number): string {
  if (score >= 70) return 'linear-gradient(90deg,#3b82f6,#10b981)';
  if (score >= 45) return 'linear-gradient(90deg,#f59e0b,#3b82f6)';
  return 'linear-gradient(90deg,#f59e0b,#ef4444)';
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Bon trader';
  if (score >= 50) return 'Correct';
  if (score >= 35) return 'À améliorer';
  return 'Critique';
}

const EARNED_BADGES = [
  { emoji: '🔥', label: 'Streak 7' },
  { emoji: '🎯', label: '100 trades' },
  { emoji: '📈', label: '+$5k' },
];

const LOCKED_BADGES = [
  { emoji: '🏅', label: 'Zen trader' },
  { emoji: '🧘', label: 'No revenge' },
  { emoji: '💎', label: 'Elite' },
];

@Component({
  selector: 'mtc-scoring',
  standalone: true,
  imports: [TopbarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './scoring.component.css',
  template: `
    <mtc-topbar title="Score Trader" />

    <div class="content">
      @if (isLoading()) {
        <div class="loading">Calcul du score...</div>
      } @else {

        <div class="grid-2">
          <!-- Left : score ring + bars -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">🏆 Score global du trader</div>
            </div>

            <div class="score-ring">
              <svg width="160" height="160" viewBox="0 0 160 160">
                <defs>
                  <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%">
                    <stop offset="0%" stop-color="#3b82f6"/>
                    <stop offset="100%" stop-color="#10b981"/>
                  </linearGradient>
                </defs>
                <circle cx="80" cy="80" r="65" fill="none" stroke="var(--bg-3)" stroke-width="14"/>
                <circle cx="80" cy="80" r="65" fill="none"
                  stroke="url(#scoreGrad)" stroke-width="14"
                  [attr.stroke-dasharray]="ringDash()"
                  stroke-dashoffset="0" stroke-linecap="round"
                  transform="rotate(-90 80 80)"/>
                <text x="80" y="72" text-anchor="middle" font-family="Syne" font-weight="800" font-size="34" fill="#e2eaf5">{{ globalScore() }}</text>
                <text x="80" y="92" text-anchor="middle" font-family="DM Mono" font-size="11" fill="#4a6080">/100</text>
                <text x="80" y="112" text-anchor="middle" font-family="Syne" font-weight="600" font-size="12" fill="#60a5fa">{{ scoreLabel(globalScore()) }}</text>
              </svg>
            </div>

            <div class="score-items">
              @for (bar of bars(); track bar.name) {
                <div class="score-row">
                  <span class="score-name">{{ bar.name }}</span>
                  <div class="bar-track">
                    <div class="bar-fill" [style.width.%]="bar.score" [style.background]="bar.color"></div>
                  </div>
                  <span class="score-val mono">{{ bar.score }}</span>
                </div>
              }
            </div>
          </div>

          <!-- Right : badges + streak -->
          <div class="right-col">
            <div class="card">
              <div class="card-title" style="margin-bottom:14px">🎖 Badges obtenus</div>
              <div class="badges-grid">
                @for (b of EARNED_BADGES; track b.label) {
                  <div class="badge-item">
                    <div class="badge-emoji">{{ b.emoji }}</div>
                    <div class="badge-label">{{ b.label }}</div>
                  </div>
                }
                @for (b of LOCKED_BADGES; track b.label) {
                  <div class="badge-item locked">
                    <div class="badge-emoji">{{ b.emoji }}</div>
                    <div class="badge-label">{{ b.label }}</div>
                  </div>
                }
              </div>
            </div>

            <div class="card streak-card">
              <div class="card-title" style="margin-bottom:14px">📅 Streak & activité</div>
              <div class="streak-dots">
                @for (d of streakDots; track $index) {
                  <div class="streak-dot" [style.background]="d" [title]="'Jour ' + ($index + 1)"></div>
                }
              </div>
              <div class="streak-info">
                🔥 Série actuelle :
                <strong class="text-green">{{ tradeCount() > 0 ? '7 jours' : '0 jour' }}</strong>
                consécutifs
              </div>
            </div>

            @if (tradeCount() < 10) {
              <div class="advice-banner">
                💡 Enregistre au moins <strong>10 trades</strong> pour un score représentatif
                ({{ tradeCount() }}/10)
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class ScoringComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly isLoading = signal(true);
  private readonly trades = signal<Trade[]>([]);

  protected readonly bars = computed(() => computeScore(this.trades()));
  protected readonly globalScore = computed(() => {
    const b = this.bars();
    return b.length ? Math.round(b.reduce((sum, x) => sum + x.score, 0) / b.length) : 0;
  });
  protected readonly tradeCount = computed(() => this.trades().length);
  protected readonly scoreLabel = scoreLabel;

  protected readonly EARNED_BADGES = EARNED_BADGES;
  protected readonly LOCKED_BADGES = LOCKED_BADGES;

  protected readonly streakDots = Array.from({ length: 35 }, () => {
    const v = Math.random();
    const colors = ['#1a2535', '#1a3a2a', '#1e5c3a', '#1a7a4a', '#10b981'];
    return colors[Math.floor(v * 5)];
  });

  protected ringDash(): string {
    const circumference = 2 * Math.PI * 65;
    const filled = (this.globalScore() / 100) * circumference;
    return `${filled} ${circumference - filled}`;
  }

  ngOnInit() {
    this.http.get<{ data: { data: Trade[] } }>(`${environment.apiUrl}/trades?limit=100`).subscribe({
      next: (res) => { this.trades.set(res.data.data); this.isLoading.set(false); },
      error: () => this.isLoading.set(false),
    });
  }
}
