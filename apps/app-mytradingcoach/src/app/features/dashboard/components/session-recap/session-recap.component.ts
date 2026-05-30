import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { PnlFormatPipe } from '../../../../shared/pipes/pnl-format.pipe';
import { EmotionEmojiPipe } from '../../../../shared/pipes/emotion-emoji.pipe';
import { LiveStats, TradingSession } from '../../../../core/api/session.api';
import { UserStore } from '../../../../core/stores/user.store';
import { PremiumLockComponent } from '../../../../shared/components/premium-lock/premium-lock.component';

@Component({
  selector: 'mtc-session-recap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-recap.component.css',
  imports: [PnlFormatPipe, EmotionEmojiPipe, PremiumLockComponent],
  template: `
    <div class="recap-wrap" data-testid="session-recap">

      <!-- Header -->
      <div class="recap-header">
        <div class="recap-title">
          <span class="recap-icon">✓</span>
          Session clôturée
        </div>
        <div class="recap-date">{{ sessionDate() }}</div>
      </div>

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

      <!-- Durée session -->
      <div class="recap-duration">
        Durée : {{ sessionDuration() }}
      </div>

      <!-- Question de réflexion -->
      @if (reflectionQuestion()) {
        @if (userStore.isPremium()) {
          <div class="recap-reflection">
            <div class="recap-q-label">
              <span class="recap-q-icon">✦</span>
              Question de réflexion
            </div>
            <div class="recap-question">{{ reflectionQuestion() }}</div>
            <textarea
              class="recap-answer"
              [value]="reflectionAnswer()"
              (input)="reflectionAnswer.set($any($event.target).value)"
              placeholder="Ta réponse (optionnel — alimente ton Weekly Debrief)"
              rows="2"
              maxlength="500"
            ></textarea>
          </div>
        } @else {
          <div class="recap-reflection" style="position:relative;min-height:80px;">
            <div class="recap-q-label" style="filter:blur(3px);user-select:none;pointer-events:none;">
              <span class="recap-q-icon">✦</span>
              Question de réflexion
            </div>
            <div class="recap-question" style="filter:blur(4px);user-select:none;pointer-events:none;">
              En une phrase, qu'est-ce que tu retiens de cette session ?
            </div>
            <mtc-premium-lock
              title="Question de réflexion IA"
              subtitle="Alimente ton Weekly Debrief et ta progression"
            />
          </div>
        }
      }

      <!-- Countdown recap 17h30 -->
      <div class="recap-countdown">
        <div class="recap-countdown-icon">📧</div>
        <div>
          <div class="recap-countdown-title">Ton bilan complet arrive à 17h30</div>
          <div class="recap-countdown-sub">
            Analyse IA de ta session · Phrase coaching · Objectifs de demain
          </div>
        </div>
        @if (minutesUntilRecap() > 0) {
          <div class="recap-countdown-time">dans {{ minutesUntilRecap() }}min</div>
        } @else {
          <div class="recap-countdown-time" style="color:var(--green)">En cours...</div>
        }
      </div>

      <!-- Actions -->
      <div class="recap-actions">
        <button class="recap-btn-secondary" (click)="viewTrades()">
          Voir les trades de la session
        </button>
        <button class="recap-btn-primary" (click)="handleClose()">
          Retour au dashboard
        </button>
      </div>

    </div>
  `,
})
export class SessionRecapComponent {
  private readonly router = inject(Router);
  protected readonly userStore = inject(UserStore);

  readonly session   = input<TradingSession | null>(null);
  readonly liveStats = input<LiveStats | null>(null);
  readonly dismissed = output<{ note?: string; question?: string | null }>();

  protected readonly reflectionAnswer = signal('');

  protected readonly sessionDate = computed(() => {
    const s = this.session();
    if (!s?.startedAt) return '';
    return new Date(s.startedAt).toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  });

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

  protected readonly reflectionQuestion = computed(() => {
    const stats = this.liveStats();
    const s = this.session();
    if (!stats || stats.tradesCount === 0) return null;

    const pnl = stats.totalPnl;
    const wr  = stats.winRate;

    if (s?.moodEnd === 'STRESSED' || s?.moodEnd === 'TIRED') {
      return "Tu as clôturé en mode stressé. Qu'est-ce qui a changé par rapport au début de la session ?";
    }
    if (pnl < 0 && wr < 40) {
      return `Session difficile avec ${stats.tradesCount} trades. Quel était le signal que tu as ignoré ?`;
    }
    if (wr >= 80) {
      return `Excellente session à ${wr.toFixed(0)}% WR. Qu'est-ce qui a fait la différence aujourd'hui ?`;
    }
    if (stats.tradesCount >= 6) {
      return `Tu as fait ${stats.tradesCount} trades aujourd'hui. Est-ce que tous étaient dans ton plan ?`;
    }
    return "En une phrase, qu'est-ce que tu retiens de cette session ?";
  });

  protected readonly minutesUntilRecap = computed(() => {
    const now = new Date();
    const target = new Date();
    target.setHours(17, 30, 0, 0);
    if (now > target) return 0;
    return Math.floor((target.getTime() - now.getTime()) / 60000);
  });

  protected handleClose(): void {
    const note = this.reflectionAnswer().trim();
    this.dismissed.emit({
      note: note || undefined,
      question: this.userStore.isPremium() ? this.reflectionQuestion() : null,
    });
  }

  protected viewTrades(): void {
    this.router.navigate(['/journal'], { queryParams: { filter: 'today' } });
  }
}
