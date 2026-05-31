import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { SessionStore } from '../../core/stores/session.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { SessionMorningComponent } from '../dashboard/components/session-morning/session-morning.component';
import { SessionLiveComponent } from '../dashboard/components/session-live/session-live.component';
import { SessionRecapComponent } from '../dashboard/components/session-recap/session-recap.component';
import { LiveModeService } from '../../core/services/live-mode.service';
import { MoodState } from '../../core/api/session.api';
import { EmotionEmojiPipe, PnlColorPipe, PnlFormatPipe } from '../../shared/pipes';

const MOODS: { value: MoodState; label: string; emoji: string }[] = [
  { value: 'CONFIDENT', label: 'Confiant', emoji: '😎' },
  { value: 'FOCUSED',   label: 'Focalisé', emoji: '🎯' },
  { value: 'NEUTRAL',   label: 'Neutre',   emoji: '😐' },
  { value: 'TIRED',     label: 'Fatigué',  emoji: '😰' },
];

const EMOTION_COLORS: Record<string, string> = {
  CONFIDENT: 'var(--green)',
  FOCUSED:   'var(--blue-bright)',
  NEUTRAL:   'var(--text-3)',
  STRESSED:  'var(--yellow)',
  FEAR:      'var(--yellow)',
  REVENGE:   'var(--red)',
};

@Component({
  selector: 'mtc-session-day',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TopbarComponent, SessionMorningComponent, SessionLiveComponent, SessionRecapComponent, EmotionEmojiPipe, PnlColorPipe, PnlFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-day.component.css',
  template: `
    <mtc-topbar title="Ma session" [showAddButton]="false">
      @if (activeTab() === 'live' && store.activeSession()?.status === 'ACTIVE') {
        <div class="sess-status-pill">
          <div class="sess-pulse-dot"></div>
          <span class="sess-timer-top">{{ store.sessionTimer() }}</span>
          <span class="sess-sep">·</span>
          <span class="sess-cnt-top">{{ store.todayTrades().length }} trade{{ store.todayTrades().length > 1 ? 's' : '' }}</span>
          <span class="sess-sep">·</span>
          <span class="sess-pnl-top" [style.color]="(store.todayStats()?.totalPnl ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'">
            {{ (store.todayStats()?.totalPnl ?? 0) >= 0 ? '+' : '' }}{{ (store.todayStats()?.totalPnl ?? 0).toFixed(0) }}$
          </span>
          <span class="sess-sep">·</span>
          <span class="sess-emo-top">{{ store.moodEmoji(store.activeSession()?.moodStart) }}</span>
        </div>
        <button class="sess-stop-top" (click)="selectTab('debrief')">🌙 Débrief</button>
      }
    </mtc-topbar>

    <div class="session-page" [class.live-mode]="activeTab() === 'live'">
      <div class="page-header">
        <div class="greeting-block">
          <h1 class="greeting-title">Ma session</h1>
          <div class="greeting-sub">{{ today | date:'EEEE d MMMM' }}</div>
        </div>
        <div class="tabs-block">
          <button class="session-tab" [class.active]="activeTab() === 'morning'"
                  data-testid="tab-morning" (click)="selectTab('morning')">
            ☀️ Pré-session
          </button>
          <button class="session-tab" [class.active]="activeTab() === 'live'"
                  data-testid="tab-live" (click)="selectTab('live')">
            ⚡ Session live
          </button>
          <button class="session-tab" [class.active]="activeTab() === 'debrief'"
                  data-testid="tab-debrief" (click)="selectTab('debrief')">
            🌙 Débrief
          </button>
        </div>
        <div class="header-spacer"></div>
      </div>

      @if (activeTab() === 'morning') {
        <mtc-session-morning
          [yesterdayRecap]="store.yesterdayRecap()"
          [objectives]="store.currentObjectives()"
          [debriefId]="store.currentDebriefId()"
          [ecoCalendar]="store.ecoCalendarDay()"
          [selectedMood]="store.selectedMood()"
          (moodSelected)="store.selectMood($event)"
          (sessionStarted)="startSession()"
          (objectiveNoteAdded)="store.updateObjectiveNote($event)"
          (planNoteChanged)="store.savePlanNote($event)"
        />
      }

      @if (activeTab() === 'live') {
        <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;">
          <mtc-session-live
            [session]="store.activeSession()"
            [todayTrades]="store.todayTrades()"
            [liveStats]="store.todayStats()"
            [ecoCalendar]="store.ecoCalendarDay()"
            [marketCtx]="store.marketCtx()"
            [newsItems]="store.newsItems()"
            [breakingNews]="store.breakingNews()"
            [triggerCloseModal]="store.triggerCloseModal()"
            (startSession)="startSession()"
            (tradeClosed)="store.confirmCloseTrade($event)"
            (tradeLogged)="store.logQuickTrade($event)"
            (goToDebrief)="selectTab('debrief')"
          />
        </div>
      }

      @if (activeTab() === 'debrief') {
        <div class="session-debrief">

          @if (store.activeSession(); as session) {

            <!-- 1. Choix émotion fin -->
            <div class="debrief-mood-card">
              <h3 class="debrief-mood-title">Comment tu te sens en fin de session ?</h3>
              <div class="mood-row">
                @for (mood of moods; track mood.value) {
                  <button class="mood-btn" [class.sel]="closeMood() === mood.value"
                          (click)="closeMood.set(mood.value)">
                    {{ mood.emoji }} {{ mood.label }}
                  </button>
                }
              </div>
            </div>

            <!-- 2. Score de discipline -->
            @if (disciplineScore() !== null) {
              <div class="debrief-card debrief-score-card">
                <div class="score-ring-wrap">
                  <div class="score-ring"
                       [style.background]="'conic-gradient(' + scoreColor() + ' ' + disciplineScore() + '%, var(--bg-3) 0)'">
                    <div class="score-ring-inner">
                      <span class="score-val">{{ disciplineScore() }}</span>
                      <span class="score-unit">/100</span>
                    </div>
                  </div>
                  <div class="score-label-wrap">
                    <div class="score-label" [style.color]="scoreColor()">{{ disciplineLabel() }}</div>
                    <div class="score-desc">Score de discipline</div>
                    <div class="score-hint">Score indicatif basé sur ta session — revenge trades, stops, objectifs.</div>
                  </div>
                </div>
              </div>
            }

            <!-- 3. Meilleur / pire trade -->
            @if (closedTrades().length > 0) {
              <div class="debrief-two-col">
                @if (bestTrade(); as t) {
                  <div class="debrief-trade-card best">
                    <div class="dtc-header">
                      <span class="dtc-icon">🏆</span>
                      <span class="dtc-title">Meilleur trade</span>
                    </div>
                    <div class="dtc-asset">{{ t.asset }} <span class="dtc-side" [class]="t.side.toLowerCase()">{{ t.side }}</span></div>
                    <div class="dtc-row">
                      <span class="dtc-time">{{ t.tradedAt | date:'HH:mm' }}</span>
                      <span>{{ t.emotion | emotionEmoji }}</span>
                      <span class="dtc-pnl" [style.color]="t.pnl | pnlColor">{{ t.pnl | pnlFormat }}</span>
                    </div>
                  </div>
                }
                @if (worstTrade(); as t) {
                  <div class="debrief-trade-card worst">
                    <div class="dtc-header">
                      <span class="dtc-icon">📉</span>
                      <span class="dtc-title">Trade difficile</span>
                    </div>
                    <div class="dtc-asset">{{ t.asset }} <span class="dtc-side" [class]="t.side.toLowerCase()">{{ t.side }}</span></div>
                    <div class="dtc-row">
                      <span class="dtc-time">{{ t.tradedAt | date:'HH:mm' }}</span>
                      <span>{{ t.emotion | emotionEmoji }}</span>
                      <span class="dtc-pnl" [style.color]="t.pnl | pnlColor">{{ t.pnl | pnlFormat }}</span>
                    </div>
                  </div>
                }
              </div>
            }

            <!-- 4. Répartition émotionnelle -->
            @if (emotionBreakdown().length > 0) {
              <div class="debrief-card">
                <div class="debrief-section-title">États émotionnels de la session</div>
                <div class="emo-list">
                  @for (e of emotionBreakdown(); track e.emotion) {
                    <div class="emo-row">
                      <span class="emo-emoji">{{ e.emotion | emotionEmoji }}</span>
                      <div class="emo-bar-wrap">
                        <div class="emo-bar" [style.width.%]="e.pct" [style.background]="emoColor(e.emotion)"></div>
                      </div>
                      <span class="emo-stat">{{ e.count }} ({{ e.pct }}%)</span>
                    </div>
                  }
                </div>
              </div>
            }

            <!-- 5. Objectifs du matin -->
            @if (objectivesReview().length > 0) {
              <div class="debrief-card">
                <div class="debrief-section-title">Objectifs du matin</div>
                <div class="obj-list">
                  @for (obj of objectivesReview(); track $index) {
                    <div class="obj-row" [class.obj-ok]="obj.ok === true" [class.obj-ko]="obj.ok === false">
                      @if (obj.auto) {
                        <span class="obj-check-auto">{{ obj.ok ? '✓' : '✗' }}</span>
                      } @else {
                        <input type="checkbox" class="obj-check-manual"
                               [checked]="objectiveChecks()[$index] ?? false"
                               (change)="toggleObjCheck($index)" />
                      }
                      <div class="obj-body">
                        <span class="obj-title">{{ obj.title }}</span>
                        @if (obj.detail) {
                          <span class="obj-detail">{{ obj.detail }}</span>
                        }
                      </div>
                    </div>
                  }
                </div>
              </div>
            }

            <!-- 6. Recap (question réflexion + 17h30 + actions) -->
            <mtc-session-recap
              [session]="session"
              [liveStats]="store.todayStats()"
              (dismissed)="confirmDebrief($event)"
            />

          } @else {
            <div class="debrief-empty">
              <div class="debrief-empty-icon">🌙</div>
              <p>Aucune session en cours à débriefer.</p>
              <p class="debrief-empty-sub">Lance une session depuis l'onglet ☀️ Pré-session,<br>puis reviens ici pour la clôturer.</p>
            </div>
          }

        </div>
      }
    </div>
  `,
})
export class SessionDayComponent implements OnInit {
  protected readonly store          = inject(SessionStore);
  private  readonly liveModeService = inject(LiveModeService);
  private  readonly destroyRef      = inject(DestroyRef);

  protected readonly activeTab         = signal<'morning' | 'live' | 'debrief'>('morning');
  protected readonly closeMood         = signal<MoodState>('NEUTRAL');
  protected readonly objectiveChecks   = signal<Record<number, boolean>>({});
  protected readonly moods             = MOODS;
  protected readonly today             = new Date();

  // ── Trades clôturés ───────────────────────────────────────────────────────
  protected readonly closedTrades = computed(() =>
    this.store.todayTrades().filter(t => t.pnl !== null),
  );

  protected readonly bestTrade = computed(() => {
    const t = this.closedTrades();
    if (!t.length) return null;
    return t.reduce((best, cur) => (cur.pnl! > best.pnl! ? cur : best));
  });

  protected readonly worstTrade = computed(() => {
    const t = this.closedTrades();
    if (!t.length) return null;
    return t.reduce((worst, cur) => (cur.pnl! < worst.pnl! ? cur : worst));
  });

  // ── Répartition émotionnelle ──────────────────────────────────────────────
  protected readonly emotionBreakdown = computed(() => {
    const trades = this.store.todayTrades();
    const total = trades.length;
    if (!total) return [];
    const counts = new Map<string, number>();
    for (const t of trades) counts.set(t.emotion, (counts.get(t.emotion) ?? 0) + 1);
    return [...counts.entries()]
      .map(([emotion, count]) => ({ emotion, count, pct: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count);
  });

  // ── Objectifs du matin ────────────────────────────────────────────────────
  protected readonly objectivesReview = computed(() => {
    const objs = this.store.currentObjectives();
    const tradeCount = this.store.todayTrades().length;
    const hasRevenge = this.store.todayTrades().some(t => t.emotion === 'REVENGE');
    return objs.map((o) => {
      const title = o.title.toLowerCase();
      const maxMatch = title.match(/max\s*(\d+)\s*trade/);
      if (maxMatch) {
        const limit = +maxMatch[1];
        return { ...o, auto: true, ok: tradeCount <= limit,
                 detail: tradeCount <= limit ? '' : `${tradeCount} trades — dépassé` };
      }
      if (/revenge|vengeance/.test(title) || /apr[èe]s.*perte/.test(title)) {
        return { ...o, auto: true, ok: !hasRevenge,
                 detail: hasRevenge ? 'revenge trade détecté' : '' };
      }
      return { ...o, auto: false, ok: null as boolean | null, detail: '' };
    });
  });

  // ── Score de discipline ───────────────────────────────────────────────────
  protected readonly disciplineScore = computed(() => {
    const trades = this.store.todayTrades();
    if (!trades.length) return null;
    let score = 100;
    const revenge = trades.filter(t => t.emotion === 'REVENGE').length;
    score -= revenge * 20;
    const noSL = trades.filter(t => t.stopLoss === null).length;
    score -= noSL * 8;
    const failedAuto = this.objectivesReview().filter(o => o.auto && o.ok === false).length;
    score -= failedAuto * 15;
    return Math.max(0, Math.min(100, score));
  });

  protected readonly disciplineLabel = computed(() => {
    const s = this.disciplineScore();
    if (s === null) return '';
    if (s >= 85) return 'Excellent';
    if (s >= 70) return 'Bon';
    if (s >= 50) return 'Moyen';
    return 'À travailler';
  });

  protected readonly scoreColor = computed(() => {
    const s = this.disciplineScore() ?? 0;
    if (s >= 85) return 'var(--green)';
    if (s >= 70) return 'var(--blue-bright)';
    if (s >= 50) return 'var(--yellow)';
    return 'var(--red)';
  });

  // ─────────────────────────────────────────────────────────────────────────

  protected emoColor(emotion: string): string {
    return EMOTION_COLORS[emotion] ?? 'var(--text-3)';
  }

  protected toggleObjCheck(index: number): void {
    const current = this.objectiveChecks();
    this.objectiveChecks.set({ ...current, [index]: !current[index] });
  }

  constructor() {
    effect(() => {
      if (this.store.activeSession()?.status === 'ACTIVE') {
        this.activeTab.set('live');
      }
    });

    effect(() => {
      const live = this.activeTab() === 'live';
      document.body.classList.toggle('live-mode-active', live);
      if (live) { this.liveModeService.activate(); } else { this.liveModeService.deactivate(); }
    });

    this.destroyRef.onDestroy(() => {
      document.body.classList.remove('live-mode-active');
      this.liveModeService.deactivate();
    });
  }

  ngOnInit(): void {
    this.store.loadSessionData();
  }

  protected selectTab(tab: 'morning' | 'live' | 'debrief'): void {
    this.activeTab.set(tab);
  }

  protected startSession(): void {
    this.store.startSession();
    this.activeTab.set('live');
  }

  protected confirmDebrief(payload: { note?: string; question?: string | null }): void {
    this.store.onSessionClosed({
      mood: this.closeMood(),
      note: payload.note,
      question: payload.question,
    });
    this.closeMood.set('NEUTRAL');
    this.objectiveChecks.set({});
    this.activeTab.set('morning');
  }
}
