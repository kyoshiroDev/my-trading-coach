import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { SessionApi, SessionHistoryItem } from '../../core/api/session.api';
import { PnlFormatPipe } from '../../shared/pipes/pnl-format.pipe';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';

@Component({
  selector: 'mtc-sessions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sessions.component.css',
  imports: [DatePipe, PnlFormatPipe, EmotionEmojiPipe],
  template: `
    <div class="sessions-page" data-testid="sessions-page">

      <div class="page-header">
        <div class="page-title">Mes sessions</div>
        <div class="page-sub">Historique de tes sessions de trading</div>
      </div>

      @if (isLoading()) {
        <div class="loading-state">
          @for (i of [1,2,3,4,5]; track i) {
            <div class="skel-row"></div>
          }
        </div>
      } @else if (sessions().length === 0) {
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-title">Aucune session clôturée</div>
          <div class="empty-sub">
            Démarre une session depuis le dashboard pour commencer à tracker tes journées de trading.
          </div>
        </div>
      } @else {
        <div class="sessions-list">
          @for (session of sessions(); track session.id) {
            <div
              class="session-card"
              [class.expanded]="expandedId() === session.id"
              (click)="toggleExpand(session.id)"
              role="button"
              tabindex="0"
              (keyup.enter)="toggleExpand(session.id)"
            >
              <!-- Main row -->
              <div class="session-row">
                <div class="session-date">
                  <div class="session-day">{{ session.startedAt | date:'EEEE d MMM' : '' : 'fr-FR' }}</div>
                  <div class="session-time">{{ formatDuration(session.startedAt, session.endedAt) }}</div>
                </div>

                <div class="session-moods">
                  <span title="Humeur début">{{ session.moodStart | emotionEmoji }}</span>
                  <span class="mood-arrow">→</span>
                  <span title="Humeur fin">{{ session.moodEnd | emotionEmoji }}</span>
                </div>

                <div class="session-stats">
                  <div class="stat">
                    <div class="stat-val"
                         [class.green]="(session.totalPnl ?? 0) >= 0"
                         [class.red]="(session.totalPnl ?? 0) < 0">
                      {{ session.totalPnl | pnlFormat }}
                    </div>
                    <div class="stat-lbl">P&L</div>
                  </div>
                  <div class="stat">
                    <div class="stat-val">{{ session.totalTrades }}</div>
                    <div class="stat-lbl">Trades</div>
                  </div>
                  <div class="stat">
                    <div class="stat-val">{{ session.winRate != null ? session.winRate.toFixed(0) + '%' : '—' }}</div>
                    <div class="stat-lbl">Win Rate</div>
                  </div>
                </div>

                <div class="session-expand-icon">{{ expandedId() === session.id ? '▲' : '▼' }}</div>
              </div>

              <!-- Expanded detail -->
              @if (expandedId() === session.id) {
                <div class="session-detail" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
                  @if (session.reflectionQuestion) {
                    <div class="detail-reflection">
                      <div class="detail-q-label">
                        <span>✦</span> Question de réflexion
                      </div>
                      <div class="detail-question">{{ session.reflectionQuestion }}</div>
                      @if (session.reflectionNote) {
                        <div class="detail-answer">{{ session.reflectionNote }}</div>
                      } @else {
                        <div class="detail-answer-empty">Aucune réponse enregistrée</div>
                      }
                    </div>
                  }
                  <div class="detail-footer">
                    <span class="detail-date-full">{{ session.startedAt | date:'EEEE d MMMM yyyy' : '' : 'fr-FR' }}</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        @if (hasMore()) {
          <div class="load-more-wrap">
            <button class="load-more-btn" [disabled]="isLoadingMore()" (click)="loadMore()">
              {{ isLoadingMore() ? 'Chargement...' : 'Voir plus de sessions' }}
            </button>
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
  protected readonly isLoadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly expandedId = signal<string | null>(null);

  private offset = 0;
  private readonly PAGE_SIZE = 20;

  constructor() {
    this.loadSessions();
  }

  private loadSessions(): void {
    this.sessionApi.getSessionHistory(this.PAGE_SIZE, 0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const items = res.data ?? [];
          this.sessions.set(items);
          this.offset = items.length;
          this.hasMore.set(items.length === this.PAGE_SIZE);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  protected loadMore(): void {
    this.isLoadingMore.set(true);
    this.sessionApi.getSessionHistory(this.PAGE_SIZE, this.offset)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const items = res.data ?? [];
          this.sessions.update(current => [...current, ...items]);
          this.offset += items.length;
          this.hasMore.set(items.length === this.PAGE_SIZE);
          this.isLoadingMore.set(false);
        },
        error: () => this.isLoadingMore.set(false),
      });
  }

  protected toggleExpand(id: string): void {
    this.expandedId.update(current => current === id ? null : id);
  }

  protected formatDuration(startedAt: string, endedAt?: string): string {
    if (!endedAt) return '—';
    const start = new Date(startedAt);
    const end = new Date(endedAt);
    const diff = Math.floor((end.getTime() - start.getTime()) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }
}
