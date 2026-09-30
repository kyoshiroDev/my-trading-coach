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
import { DatePipe, registerLocaleData } from '@angular/common';
import { netPnl } from '@mtc/shared';
import localeFr from '@angular/common/locales/fr';
registerLocaleData(localeFr);
import {
  LucideDynamicIcon,
  LucidePlay as Play,
  LucideSunrise as Sunrise,
  LucideZap as Zap,
  LucideMoon as Moon,
  LucideTrophy as Trophy,
  LucideTrendingDown as TrendingDown,
  LucideNotebookPen as NotebookPen,
  LucideMenu as Menu,
} from '@lucide/angular';
import { SessionStore } from '../../core/stores/session.store';
import { SessionMorningComponent } from '../dashboard/components/session-morning/session-morning.component';
import { SessionLiveComponent } from '../dashboard/components/session-live/session-live.component';
import { LiveModeService } from '../../core/services/live-mode.service';
import { MoodState, SessionApi, SessionTrade } from '../../core/api/session.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { TradingAccount } from '../../core/api/accounts.api';
import { UserStore } from '../../core/stores/user.store';
import { DebriefObjective } from '../../core/api/debrief.api';
import { evaluateObjectiveCheck } from './objective-check.util';
import { EmotionEmojiPipe, PnlColorPipe, PnlFormatPipe } from '../../shared/pipes';
import { ToastService } from '../../core/services/toast.service';
import { DialogDirective, ErrorStateComponent } from '@mtc/front-ui';

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
  selector: 'mtc-today-session',
  imports: [DialogDirective, ErrorStateComponent, DatePipe, LucideDynamicIcon, SessionMorningComponent, SessionLiveComponent, EmotionEmojiPipe, PnlColorPipe, PnlFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './today-session.component.css',
  templateUrl: './today-session.component.html',
})
export class TodaySessionComponent implements OnInit, OnDestroy {
  protected readonly store          = inject(SessionStore);
  protected readonly selectedAccount = inject(SelectedAccountStore);
  protected readonly userStore      = inject(UserStore);
  private  readonly liveModeService = inject(LiveModeService);
  private  readonly sessionApi      = inject(SessionApi);
  private  readonly destroyRef      = inject(DestroyRef);
  private  readonly toast           = inject(ToastService);

  private  journalSaveTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly activeTab         = signal<'morning' | 'live' | 'debrief'>('morning');
  protected readonly confirmCloseOpen  = signal(false);
  protected readonly closeMood         = signal<MoodState>('NEUTRAL');
  protected readonly objectiveChecks   = signal<Record<number, boolean>>({});
  protected readonly journalText       = signal('');
  protected readonly journalSaved      = signal(false);
  protected readonly savedFlash        = signal(false);
  protected readonly moods             = MOODS;
  protected readonly today             = new Date();

  // Icônes Lucide (segmented control + actions du shell).
  protected readonly PlayIcon    = Play;
  protected readonly MenuIcon    = Menu;
  protected readonly MorningIcon = Sunrise;
  protected readonly LiveIcon    = Zap;
  protected readonly DebriefIcon = Moon;
  protected readonly BestIcon    = Trophy;
  protected readonly WorstIcon   = TrendingDown;
  protected readonly JournalIcon = NotebookPen;

  private readonly frDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  // Sous-titre du header : « Vendredi 27 juin · FTMO 100K » (date + compte de session).
  protected readonly headerSub = computed(() => {
    const d = this.frDate.format(this.today);
    const date = d.charAt(0).toUpperCase() + d.slice(1);
    const acct = this.activeAccountLabel();
    return acct ? `${date} · ${acct}` : date;
  });

  // ── Compte de la session ────────────────────────────────────────────────
  // Vrai si l'utilisateur a plusieurs comptes mais reste sur « Tous » :
  // une session = un compte → on demande un choix précis avant de lancer.
  protected readonly accountChoiceRequired = computed(
    () => this.selectedAccount.activeAccounts().length > 0
      && this.selectedAccount.accountParam() === undefined,
  );

  /** Libellé d'option du dropdown compte : « FTMO 100K · Éval · Apex ». */
  protected acctOption(a: TradingAccount): string {
    const type = a.type === 'EVALUATION' ? 'Éval' : a.type === 'FUNDED' ? 'Funded' : a.type === 'PERSONAL' ? 'Perso' : 'Démo';
    return a.broker ? `${a.label} · ${type} · ${a.broker}` : `${a.label} · ${type}`;
  }

  // Libellé du compte rattaché à la session active (en-tête « Session · Apex 50k »).
  protected readonly activeAccountLabel = computed(() => {
    const id = this.store.activeSession()?.accountId;
    if (!id) return null;
    return this.selectedAccount.accounts().find(a => a.id === id)?.label ?? null;
  });

  // ── Session duration ──────────────────────────────────────────────────────
  protected readonly sessionDuration = computed(() => {
    const s = this.store.activeSession();
    if (!s?.startedAt) return '-';
    const end = s.endedAt ? new Date(s.endedAt) : new Date();
    const diff = Math.floor((end.getTime() - new Date(s.startedAt).getTime()) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  });

  // ── Trades ────────────────────────────────────────────────────────────────
  protected readonly noTrades      = computed(() => this.store.todayTrades().length === 0);
  /** Trades clôturés du jour, `pnl` remplacé par le NET (frais déduits) : c'est lui qui classe et s'affiche. */
  protected readonly closedTrades  = computed(() =>
    this.store.todayTrades()
      .filter(t => t.pnl !== null)
      .map(t => ({ ...t, pnl: netPnl(t) })),
  );
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
    const trades = this.store.todayTrades();
    const journalLen = this.journalText().length;

    return objs.map((o) => {
      const ok = evaluateObjectiveCheck(o.check, trades, journalLen);
      return { ...o, auto: ok !== null, ok, detail: this.objDetail(o, ok, trades) };
    });
  });

  /** Libellé court d'échec pour un objectif (vide si réussi ou manuel). */
  private objDetail(o: DebriefObjective, ok: boolean | null, trades: SessionTrade[]): string {
    if (ok !== false) return '';
    const p = o.check?.params ?? {};
    switch (o.check?.type) {
      case 'max_trades':      return `${trades.length} trades (dépassé)`;
      case 'min_trades':      return `${trades.length}/${Number(p['min'])} trades`;
      case 'no_revenge':      return 'revenge trade détecté';
      case 'all_stops':       return 'stop loss manquant';
      case 'min_rr': {
        const rr = trades.map((t) => t.riskReward).filter((v): v is number => v != null);
        const avg = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : 0;
        return `R:R ${avg.toFixed(1)} < ${Number(p['value'])}`;
      }
      case 'journal_filled':  return 'journal trop court';
      case 'trade_window':    return `aucun trade ${String(p['start'])}-${String(p['end'])}`;
      case 'setup_only':      return 'setup hors liste';
      case 'max_loss_trades': return `${trades.filter((t) => (netPnl(t) ?? 0) < 0).length} pertes (dépassé)`;
      default:                return '';
    }
  }

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
    if (revenge > 0) return `${revenge} revenge trade${revenge > 1 ? 's' : ''} détecté${revenge > 1 ? 's' : ''} : travailler la gestion émotionnelle.`;
    if (s >= 85) return 'Excellente gestion : plan respecté, émotions sous contrôle.';
    if (s >= 70) return "Bonne session dans l'ensemble. Quelques petits ajustements possibles.";
    return 'Score indicatif basé sur ta session : revenge trades, stops, objectifs.';
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
      .subscribe({
        next: () => { this.journalSaved.set(true); this.flashSaved(); },
        // AVANT : échec muet, l'utilisateur croyait sa saisie enregistrée.
        error: () => this.toast.error('Ta saisie n’a pas pu être enregistrée. Réessaie.'),
      });
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
    this.selectedAccount.load(); // Premium-only en interne ; alimente le sélecteur
  }
  ngOnDestroy(): void {
    if (this.journalSaveTimer)  clearTimeout(this.journalSaveTimer);
  }

  protected selectTab(tab: 'morning' | 'live' | 'debrief'): void { this.activeTab.set(tab); }
  protected startSession(): void {
    // 1 session = 1 compte : sécurité serveur/UX même si les boutons sont déjà désactivés
    // (accountChoiceRequired) quand aucun compte précis n'est choisi.
    if (this.accountChoiceRequired()) return;
    this.store.startSession(this.selectedAccount.accountParam());
    this.activeTab.set('live');
  }

  protected closeAndGoToDebrief(): void {
    this.confirmCloseOpen.set(false);
    this.store.closeSessionThenDebrief();
    this.activeTab.set('debrief');
  }
}