import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
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
import { MoodState, SessionApi } from '../../core/api/session.api';
import { EmotionEmojiPipe, PnlColorPipe, PnlFormatPipe } from '../../shared/pipes';
import { UserStore } from '../../core/stores/user.store';
import { PremiumLockComponent } from '../../shared/components/premium-lock/premium-lock.component';

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
  imports: [DatePipe, DecimalPipe, TopbarComponent, SessionMorningComponent, SessionLiveComponent, SessionRecapComponent, EmotionEmojiPipe, PnlColorPipe, PnlFormatPipe, PremiumLockComponent],
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
        <button class="sess-stop-top" (click)="confirmCloseOpen.set(true)">🌙 Clôturer</button>
      }
    </mtc-topbar>

    <!-- Confirmation de clôture -->
    @if (confirmCloseOpen()) {
      <div class="confirm-overlay" role="button" tabindex="0"
           (click)="confirmCloseOpen.set(false)"
           (keyup.escape)="confirmCloseOpen.set(false)">
        <div class="confirm-modal" role="dialog" aria-modal="true"
             (click)="$event.stopPropagation()"
             (keydown)="$event.stopPropagation()">
          <div class="cm-title">Clôturer la session ?</div>
          <div class="cm-sub">Tu pourras compléter ton débrief juste après.</div>
          <div class="cm-actions">
            <button class="cm-cancel" (click)="confirmCloseOpen.set(false)">Annuler</button>
            <button class="cm-confirm" (click)="closeAndGoToDebrief()">Clôturer →</button>
          </div>
        </div>
      </div>
    }

    <div class="session-page" [class.live-mode]="activeTab() === 'live'">
      <div class="page-header">
        <div class="greeting-block">
          <h1 class="greeting-title">Ma session</h1>
          <div class="greeting-sub">{{ today | date:'EEEE d MMMM' }}</div>
        </div>
        <div class="tabs-and-badge">
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
          @if (activeTab() === 'debrief' && store.activeSession()?.status === 'CLOSED') {
            <div class="closed-badge">
              <span class="cb-ic">✓</span>
              <div>
                <div class="cb-t">Session clôturée</div>
                <div class="cb-d">Durée : {{ sessionDuration() }}</div>
              </div>
              @if (savedFlash()) { <span class="saved-pill">✓ Enregistré</span> }
            </div>
          }
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
            (goToDebrief)="closeAndGoToDebrief()"
          />
        </div>
      }

      @if (activeTab() === 'debrief') {
        <div class="session-debrief">

          @if (store.activeSession(); as session) {

            <!-- LIGNE DU HAUT : émotions (gauche) + score discipline (droite) -->
            <div class="debrief-top-row">
              <div class="debrief-mood-card">
                <h3 class="debrief-mood-title">Comment tu te sens en fin de session ?</h3>
                <div class="mood-row">
                  @for (mood of moods; track mood.value) {
                    <button class="mood-btn" [class.sel]="closeMood() === mood.value"
                            (click)="selectCloseMood(mood.value)">
                      {{ mood.emoji }} {{ mood.label }}
                    </button>
                  }
                </div>
              </div>
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
                    <div class="score-hint">{{ disciplinePhrase() }}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Bandeau journée sans trade -->
            @if (noTrades()) {
              <div class="debrief-zero-banner">
                <span class="dzb-icon">🧘</span>
                <div>
                  <div class="dzb-title">Pas de trade aujourd'hui — et c'est OK</div>
                  <div class="dzb-sub">Parfois, la meilleure décision est de rester à l'écart quand il n'y a pas de setup clair. Savoir ne pas trader est une vraie compétence.</div>
                </div>
              </div>
            }

            <!-- 4 cards stats -->
            <mtc-session-recap [session]="session" [liveStats]="store.todayStats()" />

            <!-- Meilleur / trade à revoir -->
            <div class="debrief-two-col">
              <div class="debrief-trade-card best">
                <div class="dtc-header"><span class="dtc-icon">🏆</span><span class="dtc-title">Meilleur trade</span></div>
                @if (bestTrade(); as t) {
                  <div class="dtc-asset">{{ t.asset }} <span class="dtc-side" [class]="t.side.toLowerCase()">{{ t.side }}</span></div>
                  <div class="dtc-row">
                    <span class="dtc-time">{{ t.tradedAt | date:'HH:mm' }}</span>
                    <span>{{ t.emotion | emotionEmoji }}</span>
                    <span class="dtc-pnl" [style.color]="t.pnl | pnlColor">{{ t.pnl | pnlFormat }}</span>
                  </div>
                } @else { <div class="dtc-empty">Aucun trade clôturé aujourd'hui</div> }
              </div>
              <div class="debrief-trade-card worst">
                <div class="dtc-header"><span class="dtc-icon">📉</span><span class="dtc-title">Trade à revoir</span></div>
                @if (worstTrade(); as t) {
                  <div class="dtc-asset">{{ t.asset }} <span class="dtc-side" [class]="t.side.toLowerCase()">{{ t.side }}</span></div>
                  <div class="dtc-row">
                    <span class="dtc-time">{{ t.tradedAt | date:'HH:mm' }}</span>
                    <span>{{ t.emotion | emotionEmoji }}</span>
                    <span class="dtc-pnl" [style.color]="t.pnl | pnlColor">{{ t.pnl | pnlFormat }}</span>
                  </div>
                } @else { <div class="dtc-empty">Rien à analyser — journée sans trade</div> }
              </div>
            </div>

            <!-- Trio : émotions+objectifs GAUCHE / journal DROITE -->
            <div class="debrief-trio">
              <div class="trio-left">

                <!-- États émotionnels -->
                <div class="debrief-card">
                  <div class="debrief-section-title">États émotionnels de la session</div>
                  @if (emotionBreakdown().length > 0) {
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
                  } @else {
                    <div class="emo-session-fallback">
                      <div class="esf-item">
                        <span class="esf-lbl">Au démarrage</span>
                        <span class="esf-emo">{{ store.selectedMood() | emotionEmoji }}</span>
                      </div>
                      <div class="esf-item">
                        <span class="esf-lbl">En fin de session</span>
                        <span class="esf-emo">{{ closeMood() | emotionEmoji }}</span>
                      </div>
                      <div class="esf-note">Pas de trade pour analyser les émotions en action.</div>
                    </div>
                  }
                </div>

                <!-- Objectifs du matin -->
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
                            @if (obj.detail) { <span class="obj-detail">{{ obj.detail }}</span> }
                          </div>
                        </div>
                      }
                    </div>
                  </div>
                }

              </div>

              <!-- Journal pleine hauteur DROITE -->
              <div class="trio-right">
                <div class="session-journal journal-card">
                  <div class="sj-header">
                    <span class="sj-icon">📓</span>
                    <div>
                      <div class="sj-title">Ton journal de session</div>
                      <div class="sj-sub">Écris librement : ce qui a marché, tes émotions, ce que tu retiens. C'est ton espace.</div>
                    </div>
                  </div>
                  <textarea class="sj-textarea"
                    [value]="journalText()"
                    (input)="onJournalInput($any($event.target).value)"
                    placeholder="Aujourd'hui, j'ai remarqué que..."
                    rows="6"></textarea>
                  <div class="sj-footer">
                    <span class="sj-count">{{ journalText().length }} caractères</span>
                    @if (journalSaved()) { <span class="sj-saved">✓ Enregistré</span> }
                    @else if (journalText().length > 0) { <span class="sj-saving">Enregistrement…</span> }
                  </div>
                </div>
              </div>
            </div>

            <!-- Question de réflexion (si disponible) -->
            @if (reflectionQuestion()) {
              <div class="debrief-card debrief-reflection">
                @if (userStore.isPremium()) {
                  <div class="recap-q-label"><span class="recap-q-icon">✦</span> Question de réflexion</div>
                  <div class="recap-question">{{ reflectionQuestion() }}</div>
                  <textarea class="recap-answer"
                    [value]="reflectionAnswer()"
                    (input)="onReflectionInput($any($event.target).value)"
                    placeholder="Ta réponse (optionnel — alimente ton Weekly Debrief)"
                    rows="2" maxlength="500"></textarea>
                } @else {
                  <div style="position:relative;min-height:70px;">
                    <div class="recap-q-label" style="filter:blur(3px);user-select:none;pointer-events:none;"><span class="recap-q-icon">✦</span> Question de réflexion</div>
                    <div class="recap-question" style="filter:blur(4px);user-select:none;pointer-events:none;">En une phrase, qu'est-ce que tu retiens de cette session ?</div>
                    <mtc-premium-lock title="Question de réflexion IA" subtitle="Alimente ton Weekly Debrief et ta progression" />
                  </div>
                }
              </div>
            }

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
export class SessionDayComponent implements OnInit, OnDestroy {
  protected readonly store          = inject(SessionStore);
  private  readonly liveModeService = inject(LiveModeService);
  private  readonly sessionApi      = inject(SessionApi);
  private  readonly destroyRef      = inject(DestroyRef);
  protected readonly userStore      = inject(UserStore);

  private  journalSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private  reflectionTimer:  ReturnType<typeof setTimeout> | null = null;

  protected readonly activeTab         = signal<'morning' | 'live' | 'debrief'>('morning');
  protected readonly confirmCloseOpen  = signal(false);
  protected readonly closeMood         = signal<MoodState>('NEUTRAL');
  protected readonly objectiveChecks   = signal<Record<number, boolean>>({});
  protected readonly journalText       = signal('');
  protected readonly journalSaved      = signal(false);
  protected readonly reflectionAnswer  = signal('');
  protected readonly savedFlash        = signal(false);
  protected readonly moods             = MOODS;
  protected readonly today             = new Date();

  // ── Session duration ──────────────────────────────────────────────────────
  protected readonly sessionDuration = computed(() => {
    const s = this.store.activeSession();
    if (!s?.startedAt) return '—';
    const end = s.endedAt ? new Date(s.endedAt) : new Date();
    const diff = Math.floor((end.getTime() - new Date(s.startedAt).getTime()) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  });

  // ── Question de réflexion ─────────────────────────────────────────────────
  protected readonly reflectionQuestion = computed(() => {
    const stats = this.store.todayStats();
    const s = this.store.activeSession();
    if (!stats || stats.tradesCount === 0) return null;
    const pnl = stats.totalPnl;
    const wr  = stats.winRate;
    if (s?.moodEnd === 'STRESSED' || s?.moodEnd === 'TIRED')
      return "Tu as clôturé en mode stressé. Qu'est-ce qui a changé par rapport au début de la session ?";
    if (pnl < 0 && wr < 40)
      return `Session difficile avec ${stats.tradesCount} trades. Quel était le signal que tu as ignoré ?`;
    if (wr >= 80)
      return `Excellente session à ${wr.toFixed(0)}% WR. Qu'est-ce qui a fait la différence aujourd'hui ?`;
    if (stats.tradesCount >= 6)
      return `Tu as fait ${stats.tradesCount} trades aujourd'hui. Est-ce que tous étaient dans ton plan ?`;
    return "En une phrase, qu'est-ce que tu retiens de cette session ?";
  });

  // ── Trades ────────────────────────────────────────────────────────────────
  protected readonly noTrades      = computed(() => this.store.todayTrades().length === 0);
  protected readonly closedTrades  = computed(() => this.store.todayTrades().filter(t => t.pnl !== null));
  protected readonly bestTrade     = computed(() => {
    const t = this.closedTrades();
    if (!t.length) return null;
    return t.reduce((best, cur) => (cur.pnl! > best.pnl! ? cur : best));
  });
  protected readonly worstTrade    = computed(() => {
    const t = this.closedTrades();
    if (!t.length) return null;
    return t.reduce((worst, cur) => (cur.pnl! < worst.pnl! ? cur : worst));
  });

  // ── Émotions ──────────────────────────────────────────────────────────────
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

  // ── Objectifs ─────────────────────────────────────────────────────────────
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
    if (!trades.length) return 100;
    let score = 100;
    score -= trades.filter(t => t.emotion === 'REVENGE').length * 20;
    score -= trades.filter(t => t.stopLoss === null).length * 8;
    score -= this.objectivesReview().filter(o => o.auto && o.ok === false).length * 15;
    return Math.max(0, Math.min(100, score));
  });
  protected readonly disciplineLabel = computed(() => {
    if (this.noTrades()) return 'Patient';
    const s = this.disciplineScore();
    if (s >= 85) return 'Excellent';
    if (s >= 70) return 'Bon';
    if (s >= 50) return 'Moyen';
    return 'À travailler';
  });
  protected readonly disciplinePhrase = computed(() => {
    if (this.noTrades()) return "Tu n'as pas forcé de trade aujourd'hui. C'est de la discipline.";
    const s = this.disciplineScore();
    const revenge = this.store.todayTrades().filter(t => t.emotion === 'REVENGE').length;
    if (revenge > 0) return `${revenge} revenge trade${revenge > 1 ? 's' : ''} détecté${revenge > 1 ? 's' : ''} — travailler la gestion émotionnelle.`;
    if (s >= 85) return 'Excellente gestion — plan respecté, émotions sous contrôle.';
    if (s >= 70) return "Bonne session dans l'ensemble. Quelques petits ajustements possibles.";
    return 'Score indicatif basé sur ta session — revenge trades, stops, objectifs.';
  });
  protected readonly scoreColor = computed(() => {
    const s = this.disciplineScore();
    if (s >= 85) return 'var(--green)';
    if (s >= 70) return 'var(--blue-bright)';
    if (s >= 50) return 'var(--yellow)';
    return 'var(--red)';
  });

  protected emoColor(emotion: string): string { return EMOTION_COLORS[emotion] ?? 'var(--text-3)'; }
  protected toggleObjCheck(index: number): void {
    const current = this.objectiveChecks();
    this.objectiveChecks.set({ ...current, [index]: !current[index] });
  }

  // ── Auto-save helper ──────────────────────────────────────────────────────
  private flashSaved(): void {
    this.savedFlash.set(true);
    setTimeout(() => this.savedFlash.set(false), 2000);
  }
  private patch(data: Record<string, unknown>): void {
    const s = this.store.activeSession();
    if (!s?.id) return;
    this.sessionApi.updateSession(s.id, data as Parameters<SessionApi['updateSession']>[1])
      .subscribe({ next: () => { this.journalSaved.set(true); this.flashSaved(); }, error: () => {} });
  }

  protected selectCloseMood(mood: MoodState): void {
    this.closeMood.set(mood);
    this.patch({ moodEnd: mood });
  }
  protected onJournalInput(value: string): void {
    this.journalText.set(value);
    this.journalSaved.set(false);
    if (this.journalSaveTimer) clearTimeout(this.journalSaveTimer);
    this.journalSaveTimer = setTimeout(() => this.patch({ notes: this.journalText() }), 1200);
  }
  protected onReflectionInput(value: string): void {
    this.reflectionAnswer.set(value);
    if (this.reflectionTimer) clearTimeout(this.reflectionTimer);
    this.reflectionTimer = setTimeout(() => this.patch({ reflectionNote: this.reflectionAnswer() }), 1200);
  }

  constructor() {
    // Bascule sur live quand session ACTIVE
    effect(() => {
      if (this.store.activeSession()?.status === 'ACTIVE') {
        this.activeTab.set('live');
      }
    });

    // Pré-remplir depuis la session
    effect(() => {
      const session = this.store.activeSession();
      if (!session) return;
      if (session.notes && this.journalText() === '')        this.journalText.set(session.notes);
      if (session.moodEnd && this.closeMood() === 'NEUTRAL') this.closeMood.set(session.moodEnd as MoodState);
      if ((session as any).reflectionNote && this.reflectionAnswer() === '')
        this.reflectionAnswer.set((session as any).reflectionNote);
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

  ngOnInit(): void { this.store.loadSessionData(); }
  ngOnDestroy(): void {
    if (this.journalSaveTimer)  clearTimeout(this.journalSaveTimer);
    if (this.reflectionTimer)   clearTimeout(this.reflectionTimer);
  }

  protected selectTab(tab: 'morning' | 'live' | 'debrief'): void { this.activeTab.set(tab); }
  protected startSession(): void { this.store.startSession(); this.activeTab.set('live'); }

  protected closeAndGoToDebrief(): void {
    this.confirmCloseOpen.set(false);
    this.store.closeSessionThenDebrief();
    this.activeTab.set('debrief');
  }
}