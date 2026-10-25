import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import {
  LucideDynamicIcon,
  LucideTrophy as Trophy,
  LucideMedal as Medal,
  LucideCalendarDays as CalendarDays,
  LucideFlame as Flame,
  LucideTarget as Target,
  LucideTrendingUp as TrendingUp,
  LucideAward as Award,
  LucideShieldCheck as ShieldCheck,
  LucideGem as Gem,
} from '@lucide/angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { UserStore } from '../../core/stores/user.store';
import { environment } from '@app/environments/environment';
import { computeTradeStats } from '@mtc/shared';
import type { Trade as ApiTrade } from '@mtc/shared';
import { ErrorStateComponent } from '@mtc/front-ui';

/** Champs du trade utilisés par le calcul du score. */
type Trade = Pick<ApiTrade, 'pnl' | 'riskReward' | 'emotion' | 'effectiveEmotion' | 'setupId' | 'tradedAt'>;

interface ScoreBar {
  name: string;
  score: number;
  color: string;
}

export function computeScore(trades: Trade[]): ScoreBar[] {
  if (!trades.length) return defaultBars(0);

  const closed = trades.filter((t) => t.pnl !== null);
  // Win rate via le helper unique (BE exclus du dénominateur).
  const winRate = computeTradeStats(trades).winRate;

  const revengeCount = trades.filter((t) => (t.effectiveEmotion ?? t.emotion) === 'REVENGE').length;
  const disciplineScore = Math.min(
    100,
    Math.max(0, 100 - (revengeCount / trades.length) * 200),
  );

  const perfScore = Math.min(100, winRate * 1.4);

  const badEmotions = ['REVENGE', 'FEAR', 'STRESSED'];
  // Émotion effective (saisie, sinon humeur de session) : même règle que le dashboard.
  const badLosses = trades.filter((t) => {
    const emotion = t.effectiveEmotion ?? t.emotion;
    return emotion != null && badEmotions.includes(emotion) && (t.pnl ?? 0) < 0;
  });
  const psychScore = Math.max(
    0,
    100 - (badLosses.length / trades.length) * 300,
  );

  const rrValues = closed
    .filter((t): t is typeof t & { riskReward: number } => t.riskReward != null)
    .map((t) => t.riskReward);
  const avgRR = rrValues.length
    ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length
    : 0;
  const riskScore = Math.min(100, avgRR * 33);

  const setups = [...new Set(trades.map((t) => t.setupId))];
  const setupWRs = setups.map((s) => {
    const st = closed.filter((t) => t.setupId === s);
    return st.length
      ? st.filter((t) => (t.pnl ?? 0) > 0).length / st.length
      : 0;
  });
  const avg = setupWRs.length
    ? setupWRs.reduce((a, b) => a + b, 0) / setupWRs.length
    : 0;
  const variance =
    setupWRs.reduce((acc, s) => acc + Math.pow(s - avg, 2), 0) /
    (setupWRs.length || 1);
  const consistScore = Math.max(0, 100 - variance * 400);

  return [
    {
      name: 'Discipline',
      score: Math.round(disciplineScore),
      color: barColor(Math.round(disciplineScore)),
    },
    {
      name: 'Performance',
      score: Math.round(perfScore),
      color: barColor(Math.round(perfScore)),
    },
    {
      name: 'Psychologie',
      score: Math.round(psychScore),
      color: barColor(Math.round(psychScore)),
    },
    {
      name: 'Gestion risque',
      score: Math.round(riskScore),
      color: barColor(Math.round(riskScore)),
    },
    {
      name: 'Consistance',
      score: Math.round(consistScore),
      color: barColor(Math.round(consistScore)),
    },
  ];
}

function defaultBars(score: number): ScoreBar[] {
  return [
    { name: 'Discipline', score, color: barColor(score) },
    { name: 'Performance', score, color: barColor(score) },
    { name: 'Psychologie', score, color: barColor(score) },
    { name: 'Gestion risque', score, color: barColor(score) },
    { name: 'Consistance', score, color: barColor(score) },
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

// Icônes Lucide (ex-emojis 🔥 🎯 📈 / 🏅 🧘 💎).
const EARNED_BADGES = [
  { icon: Flame, label: 'Streak 7' },
  { icon: Target, label: '100 trades' },
  { icon: TrendingUp, label: '+$5k' },
];

const LOCKED_BADGES = [
  { icon: Award, label: 'Zen trader' },
  { icon: ShieldCheck, label: 'No revenge' },
  { icon: Gem, label: 'Elite' },
];

@Component({
  selector: 'mtc-scoring',
  imports: [ErrorStateComponent, TopbarComponent, PlanModalComponent, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scoring.component.html',
  styleUrl: './scoring.component.css',
})
export class ScoringComponent {
  protected readonly MedalIcon = Medal;
  protected readonly CalendarDaysIcon = CalendarDays;
  protected readonly userStore = inject(UserStore);
  protected readonly showPlanModal = signal(false);
  protected readonly TrophyIcon = Trophy;

  private readonly tradesResource = httpResource<{ data: { data: Trade[] } }>(
    () => `${environment.apiUrl}/trades?limit=100`,
  );
  /** Les trades n'ont pas pu être chargés : sinon le score s'afficherait à 0 comme si de rien n'était. */
  protected readonly loadError = computed(() => !!this.tradesResource.error());
  protected reload(): void {
    this.tradesResource.reload();
  }

  protected readonly isLoading = computed(() =>
    this.tradesResource.isLoading(),
  );
  private readonly trades = computed(
    () => this.tradesResource.value()?.data.data ?? [],
  );

  protected readonly bars = computed(() => computeScore(this.trades()));
  protected readonly globalScore = computed(() => {
    const b = this.bars();
    return b.length
      ? Math.round(b.reduce((sum, x) => sum + x.score, 0) / b.length)
      : 0;
  });
  protected readonly tradeCount = computed(() => this.trades().length);
  protected readonly scoreLabel = scoreLabel;

  protected readonly EARNED_BADGES = EARNED_BADGES;
  protected readonly LOCKED_BADGES = LOCKED_BADGES;

  // Niveau d'activité 0 à 4 par jour ; couleur : --streak-0 … --streak-4 (theme.css), via la classe niveau-N.
  protected readonly streakDots = Array.from({ length: 35 }, () => Math.floor(Math.random() * 5));

  protected ringDash(): string {
    const circumference = 2 * Math.PI * 65;
    const filled = (this.globalScore() / 100) * circumference;
    return `${filled} ${circumference - filled}`;
  }
}
