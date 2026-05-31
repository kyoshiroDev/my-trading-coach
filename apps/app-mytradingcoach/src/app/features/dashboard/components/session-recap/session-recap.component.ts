import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { PnlFormatPipe } from '../../../../shared/pipes/pnl-format.pipe';
import { EmotionEmojiPipe } from '../../../../shared/pipes/emotion-emoji.pipe';
import { LiveStats, TradingSession } from '../../../../core/api/session.api';

@Component({
  selector: 'mtc-session-recap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-recap.component.css',
  imports: [PnlFormatPipe, EmotionEmojiPipe],
  template: `
    <div class="recap-wrap" data-testid="session-recap">
      <!-- Stats rapides -->
      <div class="recap-stats">
        <div class="recap-stat">
          <div class="recap-stat-val"
               [class.green]="(liveStats()?.totalPnl ?? 0) >= 0"
               [class.red]="(liveStats()?.totalPnl ?? 0) < 0">
            {{ liveStats()?.totalPnl | pnlFormat }}
          </div>
          <div class="recap-stat-lbl">P&L session</div>
        </div>
        <div class="recap-stat">
          <div class="recap-stat-val">{{ liveStats()?.tradesCount ?? 0 }}</div>
          <div class="recap-stat-lbl">Trades</div>
        </div>
        <div class="recap-stat">
          <div class="recap-stat-val">{{ winRateDisplay() }}</div>
          <div class="recap-stat-lbl">Win Rate</div>
        </div>
        <div class="recap-stat">
          <div class="recap-stat-val" style="font-size:22px;">
            {{ session()?.moodEnd | emotionEmoji }}
          </div>
          <div class="recap-stat-lbl">Humeur finale</div>
        </div>
      </div>
      <div class="recap-duration">Durée : {{ sessionDuration() }}</div>
    </div>
  `,
})
export class SessionRecapComponent {
  readonly session   = input<TradingSession | null>(null);
  readonly liveStats = input<LiveStats | null>(null);

  protected readonly winRateDisplay = computed(() => {
    const stats = this.liveStats();
    if (!stats || stats.tradesCount === 0) return '—';
    return stats.winRate.toFixed(0) + '%';
  });

  protected readonly sessionDuration = computed(() => {
    const s = this.session();
    if (!s?.startedAt) return '—';
    const end = s.endedAt ? new Date(s.endedAt) : new Date();
    const diff = Math.floor((end.getTime() - new Date(s.startedAt).getTime()) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  });
}
