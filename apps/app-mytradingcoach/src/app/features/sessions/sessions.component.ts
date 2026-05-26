import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SessionApi, SessionHistoryItem } from '../../core/api/session.api';
import { PnlFormatPipe } from '../../shared/pipes/pnl-format.pipe';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';

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
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sessions.component.css',
  imports: [DatePipe, DecimalPipe, PnlFormatPipe, EmotionEmojiPipe, RouterLink],
  template: `
<div class="sessions-page" data-testid="sessions-page">

  <!-- Header + filtre -->
  <div class="page-header">
    <div>
      <div class="page-title">Mes sessions</div>
      <div class="page-sub">
        {{ monthSummary().sessionCount }} session{{ monthSummary().sessionCount > 1 ? 's' : '' }}
        · {{ weekGroups().length }} semaine{{ weekGroups().length > 1 ? 's' : '' }}
      </div>
    </div>
    <select class="month-select"
            [value]="selectedMonth()"
            (change)="onMonthChange($any($event.target).value)">
      @for (m of availableMonths(); track m.value) {
        <option [value]="m.value">{{ m.label }}</option>
      }
    </select>
  </div>

  <!-- Résumé du mois -->
  @if (sessions().length > 0) {
    <div class="month-summary">
      <div class="ms-card">
        <div class="ms-val" [class.g]="monthSummary().totalPnl >= 0" [class.r]="monthSummary().totalPnl < 0">
          {{ monthSummary().totalPnl | pnlFormat }}
        </div>
        <div class="ms-lbl">P&L du mois</div>
      </div>
      <div class="ms-card">
        <div class="ms-val b">{{ monthSummary().sessionCount }}</div>
        <div class="ms-lbl">Sessions</div>
      </div>
      <div class="ms-card">
        <div class="ms-val b">{{ monthSummary().totalTrades }}</div>
        <div class="ms-lbl">Trades</div>
      </div>
      <div class="ms-card">
        <div class="ms-val b">{{ monthSummary().avgWinRate | number:'1.0-0' }}%</div>
        <div class="ms-lbl">Win Rate moy.</div>
      </div>
      <div class="ms-card">
        <div class="ms-val b">{{ formatDurationSeconds(monthSummary().avgDuration) }}</div>
        <div class="ms-lbl">Durée moy.</div>
      </div>
    </div>
  }

  @if (isLoading()) {
    <div class="sessions-list">
      @for (i of [1,2,3,4]; track i) {
        <div class="skel-card"></div>
      }
    </div>
  } @else if (sessions().length === 0) {
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-title">Aucune session ce mois-ci</div>
      <div class="empty-sub">Démarre une session depuis le dashboard pour commencer à tracker tes journées.</div>
    </div>
  } @else {
    @for (group of weekGroups(); track group.weekNumber) {
      <div class="week-group">
        <div class="week-header">
          <div class="week-label">{{ group.label }}</div>
          <div class="week-line"></div>
          <div class="week-stats">
            <span class="week-pnl" [class.g]="group.totalPnl >= 0" [class.r]="group.totalPnl < 0">
              {{ group.totalPnl | pnlFormat }}
            </span>
            <span class="week-sep">·</span>
            <span class="week-count">{{ group.sessionCount }} session{{ group.sessionCount > 1 ? 's' : '' }}</span>
            <span class="week-sep">·</span>
            <span class="week-count">{{ group.totalTrades }} trades</span>
          </div>
        </div>

        <div class="sessions-list">
          @for (session of group.sessions; track session.id) {
            <div class="session-card"
                 [class.positive]="(session.totalPnl ?? 0) > 0"
                 [class.negative]="(session.totalPnl ?? 0) < 0"
                 [class.neutral]="(session.totalPnl ?? 0) === 0"
                 [class.expanded]="expandedId() === session.id"
                 role="button"
                 tabindex="0"
                 (click)="toggleExpand(session.id)"
                 (keyup.enter)="toggleExpand(session.id)">

              <!-- Barre principale -->
              <div class="session-row">

                <!-- GAUCHE : Date + emojis -->
                <div class="session-when">
                  <div class="session-date-block">
                    <div class="session-day">{{ session.startedAt | date:'EEEE d MMM' : '' : 'fr-FR' }}</div>
                    <div class="session-meta">
                      <span>{{ formatDuration(session.startedAt, session.endedAt) }}</span>
                      <span class="meta-dot">·</span>
                      <span>{{ session.startedAt | date:'HH:mm' }}</span>
                    </div>
                  </div>
                  <div class="session-moods">
                    <span class="mood-e">{{ session.moodStart | emotionEmoji }}</span>
                    <span class="mood-sep">→</span>
                    <span class="mood-e">{{ session.moodEnd | emotionEmoji }}</span>
                  </div>
                </div>

                <!-- CENTRE : Stats centrées -->
                <div class="session-center">
                  <div class="stat">
                    <div class="stat-val"
                         [class.g]="(session.totalPnl ?? 0) > 0"
                         [class.r]="(session.totalPnl ?? 0) < 0">
                      {{ session.totalPnl | pnlFormat }}
                    </div>
                    <div class="stat-lbl">P&L</div>
                  </div>
                  <div class="stat">
                    <div class="stat-val">{{ session.totalTrades }}</div>
                    <div class="stat-lbl">Trades</div>
                  </div>
                  <div class="stat">
                    <div class="stat-val">
                      {{ session.winRate !== null && session.winRate !== undefined ? (session.winRate | number:'1.0-0') + '%' : '—' }}
                    </div>
                    <div class="stat-lbl">Win Rate</div>
                  </div>
                </div>

                <!-- DROITE : Assets + indicateurs -->
                <div class="session-right">
                  @if (session.topAssets?.length) {
                    <div class="session-assets">
                      @for (asset of session.topAssets.slice(0, 3); track asset) {
                        <span class="asset-chip">{{ asset }}</span>
                      }
                    </div>
                  }
                  @if (session.planNote) {
                    <div class="plan-pill">📋 Plan</div>
                  }
                  @if (session.aiOneLiner) {
                    <div class="ai-dot">✦</div>
                  }
                  <div class="chevron">{{ expandedId() === session.id ? '▲' : '▼' }}</div>
                </div>

              </div>

              <!-- Détail expandé -->
              @if (expandedId() === session.id) {
                <div class="session-detail"
                     tabindex="0"
                     (click)="$event.stopPropagation()"
                     (keydown)="$event.stopPropagation()">

                  @if (session.planNote || session.marketContext || session.maxDrawdown !== null && session.maxDrawdown !== undefined || session.bestTradePnl !== null && session.bestTradePnl !== undefined) {
                    <div class="detail-fields">
                      @if (session.planNote) {
                        <div class="detail-field">
                          <div class="df-label">📋 Plan du jour</div>
                          <div class="df-value">{{ session.planNote }}</div>
                        </div>
                      }
                      @if (session.marketContext) {
                        <div class="detail-field">
                          <div class="df-label">📊 Contexte marché</div>
                          <div class="df-value">{{ session.marketContext }}</div>
                        </div>
                      }
                      @if (session.maxDrawdown !== null && session.maxDrawdown !== undefined) {
                        <div class="detail-field">
                          <div class="df-label">📉 Drawdown intra-session</div>
                          <div class="df-value mono" [class.r]="session.maxDrawdown < 0">
                            {{ session.maxDrawdown | pnlFormat }}
                          </div>
                        </div>
                      }
                      @if (session.bestTradePnl !== null && session.bestTradePnl !== undefined) {
                        <div class="detail-field">
                          <div class="df-label">🏆 Meilleur trade</div>
                          <div class="df-value mono g">
                            {{ session.bestTradePnl | pnlFormat }}
                            @if (session.bestTradeAsset) { · {{ session.bestTradeAsset }} }
                          </div>
                        </div>
                      }
                    </div>
                    <div class="detail-divider"></div>
                  }

                  @if (session.aiOneLiner) {
                    <div class="detail-ai">
                      <div class="detail-ai-lbl">
                        <span class="ai-star">✦</span> Analyse de ton compagnon
                      </div>
                      <div class="detail-ai-text">{{ session.aiOneLiner }}</div>
                    </div>
                  }

                  @if (session.reflectionQuestion) {
                    <div class="detail-refl">
                      <div class="detail-r-lbl">💭 Question de réflexion</div>
                      <div class="detail-r-q">{{ session.reflectionQuestion }}</div>
                      @if (session.reflectionNote) {
                        <div class="detail-r-ans">
                          <span class="qmark">"</span>{{ session.reflectionNote }}<span class="qmark">"</span>
                        </div>
                      } @else {
                        <div class="detail-r-empty">Aucune réponse enregistrée.</div>
                      }
                    </div>
                  }

                  @if (session.notes) {
                    <div class="detail-notes">
                      <div class="detail-notes-lbl">📝 Notes</div>
                      <div class="detail-notes-txt">{{ session.notes }}</div>
                    </div>
                  }

                  <div class="detail-footer">
                    <span class="detail-date-full">
                      {{ session.startedAt | date:'EEEE d MMMM yyyy · HH:mm' : '' : 'fr-FR' }}
                      @if (session.endedAt) { — {{ session.endedAt | date:'HH:mm' }} }
                    </span>
                    <a class="detail-link"
                       [routerLink]="['/journal']"
                       [queryParams]="{ date: (session.startedAt | date:'yyyy-MM-dd') }"
                       (click)="$event.stopPropagation()">
                      Voir les {{ session.totalTrades }} trades →
                    </a>
                  </div>

                </div>
              }
            </div>
          }
        </div>
      </div>
    }
  }

</div>
  `,
})
export class SessionsComponent {
  private readonly sessionApi = inject(SessionApi);
  private readonly destroyRef = inject(DestroyRef);

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
    this.loadSessions();
  }

  protected onMonthChange(value: string): void {
    this.selectedMonth.set(value);
    const [year, month] = value.split('-').map(Number);
    this.loadSessions(year, month);
  }

  private loadSessions(year?: number, month?: number): void {
    this.isLoading.set(true);
    const now = new Date();
    const y = year ?? now.getFullYear();
    const m = month ?? now.getMonth() + 1;
    this.sessionApi.getSessionsByMonth(y, m)
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
    if (!endedAt) return '—';
    const diff = Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  protected formatDurationSeconds(seconds: number): string {
    if (!seconds) return '—';
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
    return `Semaine ${this.getWeekNumber(date)} — ${fmt(monday)} au ${fmt(sunday)}`;
  }
}
