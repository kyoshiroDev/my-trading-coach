import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { UserStore } from '../../core/stores/user.store';
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
  imports: [TopbarComponent, PlanModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scoring.component.html',
  styleUrl: './scoring.component.css',
})
export class ScoringComponent {
  protected readonly userStore = inject(UserStore);
  protected readonly showPlanModal = signal(false);

  private readonly tradesResource = httpResource<{ data: { data: Trade[] } }>(
    () => `${environment.apiUrl}/trades?limit=100`
  );

  protected readonly isLoading = computed(() => this.tradesResource.isLoading());
  private readonly trades = computed(() => this.tradesResource.value()?.data.data ?? []);

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
}
