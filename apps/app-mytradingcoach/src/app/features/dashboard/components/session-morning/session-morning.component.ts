import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { DailyRecap } from '../../../../core/api/daily-recap.api';
import { EcoCalendarData } from '../../../../core/api/eco-calendar.api';
import { MoodState } from '../../../../core/api/session.api';
import { DebriefObjective } from '../../../../core/api/debrief.api';

const MOODS: { value: MoodState; label: string; emoji: string }[] = [
  { value: 'CONFIDENT', label: 'Confiant', emoji: '😎' },
  { value: 'FOCUSED',   label: 'Focalisé', emoji: '🎯' },
  { value: 'NEUTRAL',   label: 'Neutre',   emoji: '😐' },
  { value: 'TIRED',     label: 'Fatigué',  emoji: '😰' },
];

@Component({
  selector: 'mtc-session-morning',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-morning.component.css',
  template: `
    <div data-testid="session-morning-view">

      <!-- Session banner — mood check + démarrer -->
      <div class="session-banner">
        <div class="sb-left">
          <div class="sb-title">
            🎯 Prépare ta session
            <span class="badge-beta">BÊTA</span>
          </div>
          <div class="sb-sub">Comment tu te sens ce matin ? Ça influence tes décisions.</div>
          <div class="mood-row">
            @for (mood of moods; track mood.value) {
              <button
                class="mood-btn"
                [class.sel]="selectedMood() === mood.value"
                [attr.data-testid]="'mood-' + mood.value.toLowerCase()"
                (click)="moodSelected.emit(mood.value)"
              >{{ mood.emoji }} {{ mood.label }}</button>
            }
          </div>
        </div>
        <button
          class="session-start-btn"
          data-testid="start-session"
          (click)="sessionStarted.emit()"
        >Démarrer la session →</button>
      </div>

      <!-- Daily row — hier + objectifs -->
      <div class="daily-row" data-testid="yesterday-recap">
        <!-- Card : recap hier -->
        <div class="card">
          @if (yesterdayRecap()) {
            <div class="card-header">
              <div class="card-title">Hier — {{ yesterdayRecap()!.date | date:'EEEE d MMMM' }}</div>
              <span style="font-size:11px;color:var(--text-3);font-family:var(--font-mono)">{{ yesterdayRecap()!.tradesCount }} trades</span>
            </div>
            <div class="recap-stats">
              <div class="recap-stat">
                <div class="recap-stat-val" [class.green]="yesterdayRecap()!.pnl >= 0" [class.red]="yesterdayRecap()!.pnl < 0">
                  {{ yesterdayRecap()!.pnl >= 0 ? '+' : '' }}{{ yesterdayRecap()!.pnl.toFixed(0) }}$
                </div>
                <div class="recap-stat-lbl">P&L</div>
              </div>
              <div class="recap-stat">
                <div class="recap-stat-val">{{ yesterdayRecap()!.winRate.toFixed(0) }}%</div>
                <div class="recap-stat-lbl">Win Rate</div>
              </div>
              <div class="recap-stat">
                <div class="recap-stat-val" style="font-size:22px;">
                  {{ emotionEmoji(yesterdayRecap()!.dominantEmotion) }}
                </div>
                <div class="recap-stat-lbl">Émotion dom.</div>
              </div>
            </div>
            @if (yesterdayRecap()!.aiOneLiner) {
              <div class="ai-oneliner">
                <span class="ai-star">✦</span>
                <span>{{ yesterdayRecap()!.aiOneLiner }}</span>
              </div>
            }
          } @else {
            <div class="card-header">
              <div class="card-title">Hier</div>
            </div>
            <div class="empty-state">
              <div style="font-size:24px;margin-bottom:6px;opacity:.4;">📊</div>
              <div style="font-size:12px;color:var(--text-2);font-weight:600;margin-bottom:4px;">
                Pas de session hier
              </div>
              <div style="font-size:11px;color:var(--text-3);">
                Démarre une session pour commencer à tracker tes trades.
              </div>
            </div>
          }
        </div>

        <!-- Card : objectifs semaine -->
        <div class="card" data-testid="today-objectives">
          <div class="card-header">
            <div class="card-title">
              Objectifs semaine
              <span class="badge-beta">BÊTA</span>
            </div>
            @if (objectives().length) {
              <span style="font-size:11px;color:var(--text-3);font-family:var(--font-mono)">{{ objectives().length }} obj.</span>
            }
          </div>
          @if (objectives().length === 0) {
            <div class="empty-state">Objectifs générés après ton Weekly Debrief</div>
          } @else {
            @for (obj of objectives(); track $index) {
              <div class="obj-item">
                <div class="obj-check">·</div>
                <div class="obj-text">{{ obj.title }}</div>
                <div class="obj-bdg s">Semaine</div>
              </div>
            }
            <div class="obj-footer">Générés par l'IA · Weekly Debrief</div>
          }
        </div>
      </div>

      <!-- Eco Calendar — toujours affiché -->
      <div class="eco-card" data-testid="eco-calendar">
        <div class="card-header">
          <div class="card-title">
            📅 {{ isNextDay() ? 'Agenda de demain' : 'Agenda du jour' }}
            <span class="badge-beta">BÊTA</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="ai-badge">AI</span>
            <span style="font-size:10px;color:var(--text-3);">Filtré pour ton profil</span>
          </div>
        </div>

        @if (!ecoCalendar()) {
          <div class="empty-state" style="padding:20px 0;">
            <div style="font-size:11px;color:var(--text-3);line-height:1.6;">
              ✦ Données économiques en cours de chargement...<br>
              Les événements s'afficheront automatiquement.
            </div>
          </div>
        } @else if (ecoCalendar()!.events.length === 0) {
          <div class="empty-state" style="padding:20px 0;">
            <div style="font-size:11px;color:var(--text-3);">
              Aucun événement majeur prévu — journée calme pour tes actifs.
            </div>
          </div>
        } @else {
          @if (ecoCalendar()!.analysis.summary) {
            <div class="eco-ai-block">
              <span style="font-size:16px;flex-shrink:0;margin-top:1px;">✦</span>
              <div>
                {{ ecoCalendar()!.analysis.summary }}
                @if (ecoCalendar()!.analysis.recommendation) {
                  <strong style="color:var(--yellow);display:block;margin-top:4px;">
                    {{ ecoCalendar()!.analysis.recommendation }}
                  </strong>
                }
              </div>
            </div>
          }

          @if (highImpactCount() > 0) {
            <div class="eco-warning">
              <span>⚠️</span>
              <span>{{ highImpactCount() }} événement(s) à fort impact {{ isNextDay() ? "demain" : "aujourd'hui" }}</span>
            </div>
          }

          <div class="eco-events">
            @for (event of ecoCalendar()!.events; track event.name) {
              <div class="eco-event" [class.dim]="isOutsideSession(event.time)">
                <span class="eco-event-time">{{ formatTime(event.time) }}</span>
                <div class="eco-impact" [class]="event.impact"></div>
                <div class="eco-event-body">
                  <div class="eco-event-name">{{ event.name }}</div>
                  @if (event.previous !== null || event.estimate !== null) {
                    <div class="eco-event-detail">
                      @if (event.previous !== null) { Précédent : {{ event.previous }} · }
                      @if (event.estimate !== null) { Prévision : {{ event.estimate }} }
                    </div>
                  }
                </div>
                @if (getAssetTag(event.currency)) {
                  <span class="eco-asset-tag">{{ getAssetTag(event.currency) }}</span>
                }
                <span class="eco-tag" [class]="event.impact">
                  {{ event.impact === 'high' ? 'Fort' : 'Moyen' }}
                </span>
              </div>
            }
          </div>

          <div class="eco-footer">
            <span>Événements grisés = hors de ta session</span>
          </div>
        }
      </div>

    </div>
  `,
})
export class SessionMorningComponent {
  readonly yesterdayRecap = input<DailyRecap | null>(null);
  readonly objectives = input<DebriefObjective[]>([]);
  readonly ecoCalendar = input<EcoCalendarData | null>(null);
  readonly selectedMood = input<MoodState>('CONFIDENT');
  readonly isNextDay = input<boolean>(false);

  readonly moodSelected = output<MoodState>();
  readonly sessionStarted = output<void>();

  protected readonly moods = MOODS;

  protected emotionEmoji(emotion?: string): string {
    const map: Record<string, string> = {
      CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐',
      STRESSED: '😰', REVENGE: '🤬', FEAR: '😨',
    };
    return map[emotion ?? ''] ?? '😐';
  }

  protected highImpactCount(): number {
    return this.ecoCalendar()?.events.filter(e => e.impact === 'high').length ?? 0;
  }

  protected isOutsideSession(time: string): boolean {
    const h = parseInt(time.split(':')[0] ?? '0', 10);
    return h >= 16; // hors session London (après 16h UTC)
  }

  protected formatTime(iso: string): string {
    if (!iso) return '—';
    if (iso.includes('T')) {
      const d = new Date(iso);
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    return iso.slice(0, 5);
  }

  protected getAssetTag(currency: string): string {
    const map: Record<string, string> = {
      USD: 'NQ/ES', EUR: 'EUR/USD', GBP: 'GBP', JPY: 'USD/JPY',
    };
    return map[currency] ?? currency;
  }
}
