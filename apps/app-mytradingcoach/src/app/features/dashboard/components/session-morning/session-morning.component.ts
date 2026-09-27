import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideTarget as Target,
  LucideCalendarDays as CalendarDays,
  LucideTriangleAlert as TriangleAlert,
} from '@lucide/angular';
import { translateEcoEvent } from '../../../../core/data/eco-event-translations';

import { filterMorningEvents } from './session-morning.util';
import { DailyRecap } from '../../../../core/api/daily-recap.api';
import { EcoCalendarApi, EcoCalendarData } from '../../../../core/api/eco-calendar.api';
import { MoodState } from '../../../../core/api/session.api';
import { DebriefApi, DebriefObjective } from '../../../../core/api/debrief.api';
import { UserStore } from '../../../../core/stores/user.store';
import { ToastService } from '../../../../core/services/toast.service';
import { PremiumLockComponent } from '../../../../shared/components/premium-lock/premium-lock.component';
import { MoneyPipe } from '../../../../shared/pipes';
import { eventKey, normalizeEventKey } from '@mtc/shared';
import type { EcoEvent } from '@mtc/shared';

const MOODS: { value: MoodState; label: string; emoji: string }[] = [
  { value: 'CONFIDENT', label: 'Confiant', emoji: '😎' },
  { value: 'FOCUSED',   label: 'Focalisé', emoji: '🎯' },
  { value: 'NEUTRAL',   label: 'Neutre',   emoji: '😐' },
  { value: 'TIRED',     label: 'Fatigué',  emoji: '😰' },
];

// Agenda éco d'exemple (mode démo) : vitrine « pleine » de la carte Agenda du jour.
const DEMO_ECO_EVENTS: EcoEvent[] = [
  { time: '14:30', name: 'Non-Farm Payrolls', currency: 'USD', country: 'US', impact: 'high', actual: null, estimate: 185, previous: 206, isReleased: false, unit: 'K' },
  { time: '14:30', name: 'Taux de chômage', currency: 'USD', country: 'US', impact: 'high', actual: null, estimate: 4.1, previous: 4.0, isReleased: false, unit: '%' },
  { time: '16:00', name: 'ISM Manufacturing PMI', currency: 'USD', country: 'US', impact: 'medium', actual: null, estimate: 48.5, previous: 48.7, isReleased: false, unit: null },
  { time: '11:00', name: 'IPC Zone Euro (final)', currency: 'EUR', country: 'EU', impact: 'medium', actual: 2.4, estimate: 2.4, previous: 2.4, isReleased: true, unit: '%' },
];
const DEMO_ECO_SUMMARY = "Journée chargée côté USD : les chiffres de l'emploi peuvent créer de la volatilité sur NQ et ES en début d'après-midi.";
const DEMO_ECO_RECO = "Évite d'ouvrir une position 5 min avant le NFP (14:30).";
// Recap « Hier » d'exemple (mode démo).
const DEMO_RECAP: DailyRecap = {
  id: 'demo', date: new Date(Date.now() - 864e5).toISOString(),
  tradesCount: 5, pnl: 320, winRate: 68, dominantEmotion: 'FOCUSED',
  aiOneLiner: 'Belle discipline hier : tu as coupé tes pertes vite et laissé courir ton meilleur trade.',
};
const DEMO_OBJECTIVES: DebriefObjective[] = [
  { title: 'Max 5 trades par session', reason: '' },
  { title: 'Aucun revenge trade', reason: '' },
  { title: 'Stop loss sur 100% des trades', reason: '' },
  { title: 'Journal rempli en fin de session', reason: '' },
];

@Component({
  selector: 'mtc-session-morning',
  imports: [DatePipe, RouterLink, LucideDynamicIcon, PremiumLockComponent, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-morning.component.css',
  templateUrl: './session-morning.component.html',
})
export class SessionMorningComponent {
  readonly yesterdayRecap = input<DailyRecap | null>(null);
  readonly objectives = input<DebriefObjective[]>([]);
  readonly debriefId = input<string | null>(null);
  readonly ecoCalendar = input<EcoCalendarData | null>(null);
  readonly selectedMood = input<MoodState>('CONFIDENT');
  readonly isNextDay = input<boolean>(false);
  readonly nextTradingDate = input<string | null>(null);

  readonly moodSelected = output<MoodState>();
  readonly sessionStarted = output<void>();
  readonly objectiveNoteAdded = output<{ index: number; note: string }>();
  readonly planNoteChanged = output<string>();

  private readonly debriefApi = inject(DebriefApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly ecoApi = inject(EcoCalendarApi);
  protected readonly userStore = inject(UserStore);

  protected readonly moods = MOODS;
  protected readonly planNote = signal('');

  // Icônes Lucide (headers de panels, design « Ma session »).
  protected readonly PrepareIcon = Target;
  protected readonly AgendaIcon  = CalendarDays;
  protected readonly WarnIcon    = TriangleAlert;

  // Pins chargés directement depuis l'API : indépendant du cache getTodayEvents
  private readonly freshPins = signal<string[] | null>(null);

  private readonly FLAGS: Record<string, string> = {
    US: '🇺🇸', EU: '🇪🇺', GB: '🇬🇧', JP: '🇯🇵',
    CA: '🇨🇦', AU: '🇦🇺', NZ: '🇳🇿', CH: '🇨🇭',
    CN: '🇨🇳', DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹',
    ES: '🇪🇸', SE: '🇸🇪', NO: '🇳🇴', DK: '🇩🇰',
    USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
    CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', CHF: '🇨🇭',
    CNY: '🇨🇳', CNH: '🇨🇳', SEK: '🇸🇪', NOK: '🇳🇴',
    DKK: '🇩🇰', HKD: '🇭🇰', SGD: '🇸🇬', MXN: '🇲🇽',
  };

  protected readonly filterImpact = signal<'all' | 'high' | 'medium'>('all');
  protected readonly filterCurrency = signal<string>('all');

  protected readonly availableCurrencies = computed(() => {
    const events = this.ecoCalendar()?.events ?? [];
    return [...new Set(events.map(e => e.currency))].sort();
  });

  protected readonly pinnedKeys = computed(() => {
    const fresh = this.freshPins();
    // freshPins (API) en priorité, sinon le champ pinnedEvents du cache backend.
    const raw = fresh !== null ? fresh : (this.ecoCalendar()?.pinnedEvents ?? []);
    // Clés normalisées (suffixe de période retiré) pour un matching stable dans le temps.
    return new Set(raw.map(normalizeEventKey));
  });

  /** Un event affiché est-il épinglé ? (clé normalisée). */
  protected isEventPinned(e: { name: string; currency: string }): boolean {
    return this.pinnedKeys().has(eventKey(e));
  }

  protected readonly filteredEvents = computed(() =>
    filterMorningEvents(
      this.ecoCalendar()?.events ?? [],
      this.pinnedKeys(),
      this.filterImpact(),
      this.filterCurrency(),
    ),
  );

  protected readonly isDemo = computed(() => this.userStore.isDemo());

  /** Agenda affiché : en démo = vitrine figée (4 events) filtrée par impact ; sinon réel. */
  protected readonly agendaEvents = computed(() => {
    if (this.isDemo()) {
      const imp = this.filterImpact();
      return imp === 'all' ? DEMO_ECO_EVENTS : DEMO_ECO_EVENTS.filter(e => e.impact === imp);
    }
    return this.filteredEvents();
  });

  /** Recap « Hier » : réel, ou exemple en démo. */
  protected readonly recapView = computed(() => this.yesterdayRecap() ?? (this.isDemo() ? DEMO_RECAP : null));
  /** Résumé/reco IA de l'agenda : réel, ou exemple en démo. */
  protected readonly ecoSummaryText = computed(() => this.ecoCalendar()?.analysis.summary || (this.isDemo() ? DEMO_ECO_SUMMARY : ''));
  protected readonly ecoRecoText    = computed(() => this.ecoCalendar()?.analysis.recommendation || (this.isDemo() ? DEMO_ECO_RECO : ''));
  /** Nb d'events fort impact (démo-aware). */
  protected readonly highImpactCountView = computed(() =>
    this.isDemo()
      ? DEMO_ECO_EVENTS.filter(e => e.impact === 'high').length
      : (this.ecoCalendar()?.events.filter(e => e.impact === 'high').length ?? 0),
  );
  /** Objectifs semaine : réels, ou exemples en démo. */
  protected readonly objectivesView = computed(() =>
    this.objectives().length ? this.objectives() : (this.isDemo() ? DEMO_OBJECTIVES : []),
  );

  protected readonly hasMatchingPins = computed(() => {
    const events = this.ecoCalendar()?.events ?? [];
    const pinned = this.pinnedKeys();
    return pinned.size > 0 && events.some(e => pinned.has(eventKey(e)));
  });

  protected unpinEvent(event: { name: string; currency: string }): void {
    const target = eventKey(event); // forme normalisée de l'event à retirer
    // On travaille sur les pins BRUTS stockés (avec suffixe de période) pour ne
    // pas réécrire les autres clés. On retire toute clé dont la forme normalisée
    // correspond à l'event désépinglé (insensible au suffixe « (Jun) »…).
    const rawPins = this.freshPins() ?? this.ecoCalendar()?.pinnedEvents ?? [];
    const next = rawPins.filter(p => normalizeEventKey(p) !== target);
    if (next.length === rawPins.length) return; // rien à retirer
    // Mise à jour optimiste du signal local → l'event disparaît immédiatement
    this.freshPins.set(next);
    // Persistance backend (même API que eco-calendar)
    this.ecoApi.savePins(next)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.toast.error('Désépinglage non enregistré. Réessaie.') });
  }

  protected readonly dayLabel = computed(() => {
    const parisNow = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }),
    );
    const isWeekend = parisNow.getDay() === 0 || parisNow.getDay() === 6;
    return (!isWeekend && parisNow.getHours() < 18) ? "aujourd'hui" : 'demain';
  });

  protected translate(name: string): string {
    return translateEcoEvent(name);
  }

  protected getFlag(event: { country?: string | null; currency?: string | null }): string {
    if (event.country) {
      const flag = this.FLAGS[event.country.toUpperCase()];
      if (flag) return flag;
    }
    return this.FLAGS[event.currency?.toUpperCase() ?? ''] ?? '🌐';
  }

  protected readonly expandedObjectiveIdx = signal<number | null>(null);
  protected readonly objectiveNoteValues = signal<Partial<Record<number, string>>>({});
  protected readonly isSavingNote = signal(false);

  constructor() {
    this.ecoApi.getPins()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => this.freshPins.set(res.data ?? []));
  }

  protected toggleObjectiveNote(idx: number): void {
    this.expandedObjectiveIdx.update(current => current === idx ? null : idx);
  }

  protected setNoteValue(idx: number, value: string): void {
    this.objectiveNoteValues.update(map => ({ ...map, [idx]: value }));
  }

  protected saveNote(idx: number): void {
    const debriefId = this.debriefId();
    if (!debriefId) return;
    const note = this.objectiveNoteValues()[idx] ?? this.objectives()[idx]?.note ?? '';
    this.isSavingNote.set(true);
    this.debriefApi.addObjectiveNote(debriefId, idx, note)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.objectiveNoteAdded.emit({ index: idx, note });
          this.expandedObjectiveIdx.set(null);
          this.isSavingNote.set(false);
        },
        error: () => {
          this.isSavingNote.set(false);
          this.toast.error('Ta note n’a pas pu être enregistrée. Réessaie.');
        },
      });
  }

  protected nextTradingLabel(): string {
    if (!this.isNextDay()) return 'Agenda du jour';
    const d = this.nextTradingDate();
    if (!d) return 'Agenda de demain';
    const date = new Date(d + 'T00:00:00');
    return 'Agenda du ' + date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

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
    if (!iso) return '-';
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
