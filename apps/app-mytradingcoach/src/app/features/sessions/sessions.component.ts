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
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SessionApi, SessionHistoryItem } from '../../core/api/session.api';
import { PnlFormatPipe } from '../../shared/pipes/pnl-format.pipe';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';
import { AccountSelectorComponent } from '../../shared/components/account-selector/account-selector.component';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';

interface WeekGroup {
  weekNumber: number;
  label: string;
  sessions: SessionHistoryItem[];
  totalPnl: number;
  totalTrades: number;
  sessionCount: number;
}

@Component({
  selector: 'mtc-sessions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sessions.component.css',
  imports: [DatePipe, DecimalPipe, PnlFormatPipe, EmotionEmojiPipe, RouterLink, AccountSelectorComponent],
  templateUrl: './sessions.component.html',
})
export class SessionsComponent {
  private readonly sessionApi = inject(SessionApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly selectedAccount = inject(SelectedAccountStore);
  protected readonly userStore = inject(UserStore);

  protected readonly sessions = signal<SessionHistoryItem[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly expandedId = signal<string | null>(null);

  protected readonly selectedMonth = signal(
    `${new Date().getFullYear()}-${new Date().getMonth() + 1}`,
  );

  protected readonly availableMonths = computed(() => {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        value: `${d.getFullYear()}-${d.getMonth() + 1}`,
        label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
    }
    return months;
  });

  protected readonly monthSummary = computed(() => {
    const s = this.sessions();
    const totalPnl = s.reduce((acc, x) => acc + (x.totalPnl ?? 0), 0);
    const sessionCount = s.length;
    const totalTrades = s.reduce((acc, x) => acc + (x.totalTrades ?? 0), 0);
    const avgWinRate = sessionCount
      ? s.reduce((acc, x) => acc + (x.winRate ?? 0), 0) / sessionCount
      : 0;
    const avgDuration = sessionCount
      ? s.reduce((acc, x) => acc + this.durationSeconds(x.startedAt, x.endedAt), 0) / sessionCount
      : 0;
    return { totalPnl, sessionCount, totalTrades, avgWinRate, avgDuration };
  });

  protected readonly weekGroups = computed<WeekGroup[]>(() => {
    const sessions = this.sessions();
    if (!sessions.length) return [];

    const groups = new Map<number, WeekGroup>();

    for (const s of sessions) {
      const date = new Date(s.startedAt);
      const weekNum = this.getWeekNumber(date);
      if (!groups.has(weekNum)) {
        groups.set(weekNum, {
          weekNumber: weekNum,
          label: this.getWeekLabel(date),
          sessions: [],
          totalPnl: 0,
          totalTrades: 0,
          sessionCount: 0,
        });
      }
      const group = groups.get(weekNum)!;
      group.sessions.push(s);
      group.totalPnl += s.totalPnl ?? 0;
      group.totalTrades += s.totalTrades ?? 0;
      group.sessionCount++;
    }

    return [...groups.values()].sort((a, b) => b.weekNumber - a.weekNumber);
  });

  constructor() {
    // Recharge à chaque changement de mois OU de compte sélectionné (contexte global).
    effect(() => {
      const [year, month] = this.selectedMonth().split('-').map(Number);
      const accountId = this.selectedAccount.accountParam(); // lit selectedAccountId (réactif)
      this.loadSessions(year, month, accountId);
    });
  }

  protected onMonthChange(value: string): void {
    this.selectedMonth.set(value); // l'effect ci-dessus déclenche le rechargement
  }

  private loadSessions(year: number, month: number, accountId?: string): void {
    this.isLoading.set(true);
    this.sessionApi.getSessionsByMonth(year, month, accountId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.sessions.set(res.data ?? []);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  protected toggleExpand(id: string): void {
    this.expandedId.update(current => current === id ? null : id);
  }

  protected formatDuration(startedAt: string, endedAt?: string | null): string {
    if (!endedAt) return '-';
    const diff = Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  protected formatDurationSeconds(seconds: number): string {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  private durationSeconds(start: string, end?: string | null): number {
    if (!end) return 0;
    return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  }

  private getWeekNumber(date: Date): number {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  private getWeekLabel(date: Date): string {
    const d = new Date(date);
    const day = d.getDay() || 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - day + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (dt: Date) =>
      dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    return `Semaine ${this.getWeekNumber(date)} · ${fmt(monday)} au ${fmt(sunday)}`;
  }
}
