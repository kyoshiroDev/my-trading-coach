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
import { translateEcoEvent } from '../../../../core/data/eco-event-translations';
import { normalizeEventKey, eventKey } from '../../../../core/data/eco-event-key';
import { DailyRecap } from '../../../../core/api/daily-recap.api';
import { EcoCalendarApi, EcoCalendarData } from '../../../../core/api/eco-calendar.api';
import { MoodState } from '../../../../core/api/session.api';
import { DebriefApi, DebriefObjective } from '../../../../core/api/debrief.api';
import { UserStore } from '../../../../core/stores/user.store';
import { PremiumLockComponent } from '../../../../shared/components/premium-lock/premium-lock.component';

const MOODS: { value: MoodState; label: string; emoji: string }[] = [
  { value: 'CONFIDENT', label: 'Confiant', emoji: '😎' },
  { value: 'FOCUSED',   label: 'Focalisé', emoji: '🎯' },
  { value: 'NEUTRAL',   label: 'Neutre',   emoji: '😐' },
  { value: 'TIRED',     label: 'Fatigué',  emoji: '😰' },
];

@Component({
  selector: 'mtc-session-morning',
  standalone: true,
  imports: [DatePipe, RouterLink, PremiumLockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-morning.component.css',
  template: `
    <div data-testid="session-morning-view">

      <!-- Session banner — mood check + démarrer -->
      <div class="session-banner">
        <div class="sb-left">
          <div class="sb-title">
            🎯 Prépare ta session
           
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
          <div class="plan-input-wrap">
            <textarea
              class="plan-input"
              placeholder="Plan du jour (optionnel) — ex: Breakouts NQ uniquement, max 5 trades..."
              rows="2"
              [value]="planNote()"
              (input)="planNote.set($any($event.target).value)"
              (blur)="planNoteChanged.emit(planNote())"
              maxlength="300"
            ></textarea>
          </div>
        </div>
      </div>

      <div class="session-layout">

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
            @if (userStore.isPremium() && yesterdayRecap()!.aiOneLiner) {
              <div class="ai-oneliner" data-testid="ai-oneliner">
                <span class="ai-star">✦</span>
                <span>{{ yesterdayRecap()!.aiOneLiner }}</span>
              </div>
            } @else if (!userStore.isPremium()) {
              <div class="ai-oneliner" style="position:relative;min-height:40px;">
                <span class="ai-star" style="filter:blur(2px)">✦</span>
                <span style="filter:blur(4px);user-select:none;pointer-events:none;">
                  Ton compagnon a analysé ta session et identifié un pattern clé dans tes trades.
                </span>
                <mtc-premium-lock
                  title="Analyse IA de ta session"
                  subtitle="Disponible en Premium"
                />
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
             
            </div>
            @if (objectives().length) {
              <span style="font-size:11px;color:var(--text-3);font-family:var(--font-mono)">{{ objectives().length }} obj.</span>
            }
          </div>
          @if (objectives().length === 0) {
            <div class="empty-state">Objectifs générés après ton Weekly Debrief</div>
          } @else {
            @for (obj of objectives(); track $index; let i = $index) {
              @if (!userStore.isPremium() && i >= 1) {
                @if (i === 1) {
                  <!-- 2e objectif flou — aperçu Premium -->
                  <div style="position:relative;margin-top:4px;">
                    <div class="obj-item" style="filter:blur(3px);pointer-events:none;user-select:none;">
                      <div class="obj-check">·</div>
                      <div class="obj-body">
                        <div class="obj-text">{{ obj.title }}</div>
                      </div>
                      <div class="obj-bdg s">Semaine</div>
                    </div>
                    <mtc-premium-lock
                      title="{{ objectives().length - 1 }} autre(s) objectif(s) IA"
                      subtitle="Générés par ton compagnon chaque dimanche"
                    />
                  </div>
                }
                <!-- les suivants (i >= 2) sont masqués -->
              } @else {
                <div
                  class="obj-item"
                  [class.expandable]="!!debriefId()"
                  role="button"
                  tabindex="0"
                  (click)="debriefId() && toggleObjectiveNote(i)"
                  (keyup.enter)="debriefId() && toggleObjectiveNote(i)"
                >
                  <div class="obj-check">·</div>
                  <div class="obj-body">
                    <div class="obj-text">{{ obj.title }}</div>
                    @if (obj.note && expandedObjectiveIdx() !== i) {
                      <div class="obj-note-preview">{{ obj.note }}</div>
                    }
                  </div>
                  <div class="obj-bdg s">Semaine</div>
                  @if (debriefId()) {
                    <span class="obj-note-icon">{{ expandedObjectiveIdx() === i ? '▲' : '✏' }}</span>
                  }
                </div>
                @if (expandedObjectiveIdx() === i) {
                  <div class="obj-note-panel" tabindex="-1" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
                    <textarea
                      class="obj-note-input"
                      placeholder="Note sur cet objectif..."
                      rows="2"
                      [value]="objectiveNoteValues()[i] ?? obj.note ?? ''"
                      (input)="setNoteValue(i, $any($event.target).value)"
                    ></textarea>
                    <div class="obj-note-actions">
                      <button class="obj-note-cancel" (click)="toggleObjectiveNote(i)">Annuler</button>
                      <button class="obj-note-save" [disabled]="isSavingNote()" (click)="saveNote(i)">
                        {{ isSavingNote() ? '...' : 'Sauvegarder' }}
                      </button>
                    </div>
                  </div>
                }
              }
            }
            <div class="obj-footer">Générés par l'IA · Weekly Debrief</div>
          }
        </div>
      </div>

      <!-- Eco Calendar — toujours affiché -->
      <div class="eco-card" data-testid="eco-calendar">
        <div class="card-header">
          <div class="card-title">
            📅 {{ nextTradingLabel() }}
           
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
          <div class="eco-empty">
            <div style="font-size:24px;margin-bottom:6px;opacity:.4;">📅</div>
            <div class="eco-empty-text">
              @if (isNextDay()) {
                Aucun événement économique majeur prévu — lundi calme pour tes actifs.
              } @else {
                Aucun événement majeur prévu — journée calme pour tes actifs.
              }
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

          <!-- Notice events épinglés -->
          @if (pinnedKeys().size > 0) {
            <div class="eco-pinned-notice">
              📌 {{ pinnedKeys().size }} event{{ pinnedKeys().size > 1 ? 's' : '' }} épinglé{{ pinnedKeys().size > 1 ? 's' : '' }}
              — <a routerLink="/eco-calendar" class="eco-pinned-link">Gérer</a>
            </div>
          }

          <!-- Filtres style Investing.com -->
          <div class="eco-filters">
            <div class="eco-filter-group">
              <button class="eco-filter-btn"
                      [class.active]="filterImpact() === 'all'"
                      (click)="filterImpact.set('all')">Tous</button>
              <button class="eco-filter-btn"
                      [class.active]="filterImpact() === 'high'"
                      (click)="filterImpact.set('high')">
                <span class="eco-filter-dot high"></span> Fort
              </button>
              <button class="eco-filter-btn"
                      [class.active]="filterImpact() === 'medium'"
                      (click)="filterImpact.set('medium')">
                <span class="eco-filter-dot medium"></span> Moyen
              </button>
            </div>

            <select class="eco-filter-select"
                    [value]="filterCurrency()"
                    (change)="filterCurrency.set($any($event.target).value)">
              <option value="all">Toutes les devises</option>
              @for (c of availableCurrencies(); track c) {
                <option [value]="c">{{ getFlag({ currency: c }) }} {{ c }}</option>
              }
            </select>

            <span class="eco-filter-count">
              {{ filteredEvents().length }} événement{{ filteredEvents().length > 1 ? 's' : '' }}
            </span>
          </div>

          <!-- Liste des événements filtrés -->
          <div class="eco-events">
            @if (filteredEvents().length === 0) {
              <div class="eco-empty-filter">
                @if (pinnedKeys().size > 0 && !hasMatchingPins()) {
                  Aucun de tes events épinglés n'est prévu {{ dayLabel() }}.
                  <a routerLink="/eco-calendar" class="eco-pinned-link">Voir le calendrier →</a>
                } @else {
                  Aucun événement pour ce filtre.
                }
              </div>
            }

            @for (event of filteredEvents(); track event.name) {
              <div class="eco-event"
                   [class.dim]="isOutsideSession(event.time)"
                   [class.released]="event.isReleased">

                <span class="eco-event-time">{{ formatTime(event.time) }}</span>
                <div class="eco-impact" [class]="event.impact"></div>
                <span class="eco-flag">{{ getFlag(event) }}</span>

                <div class="eco-event-body">
                  <div class="eco-event-name">{{ translate(event.name) }}</div>
                  @if (event.previous !== null || event.estimate !== null || event.actual !== null) {
                    <div class="eco-event-detail">
                      @if (event.actual !== null) {
                        <span class="eco-actual"
                              [class.beat]="event.estimate !== null && event.actual > event.estimate"
                              [class.miss]="event.estimate !== null && event.actual < event.estimate">
                          Actuel&nbsp;: {{ event.actual }}{{ event.unit }}
                        </span>
                        <span class="eco-sep">·</span>
                      }
                      @if (event.estimate !== null) {
                        <span>Prévu&nbsp;: {{ event.estimate }}{{ event.unit }}</span>
                        <span class="eco-sep">·</span>
                      }
                      @if (event.previous !== null) {
                        <span>Préc.&nbsp;: {{ event.previous }}{{ event.unit }}</span>
                      }
                    </div>
                  }
                </div>

                @if (getAssetTag(event.currency)) {
                  <span class="eco-asset-tag">{{ getAssetTag(event.currency) }}</span>
                }
                <span class="eco-tag" [class]="event.impact">
                  {{ event.impact === 'high' ? 'Fort' : 'Moyen' }}
                </span>
                @if (event.isReleased) {
                  <span class="eco-released-badge">✓</span>
                }
                @if (isEventPinned(event)) {
                  <button
                    type="button"
                    class="eco-unpin-btn"
                    title="Retirer des épinglés"
                    (click)="unpinEvent(event)">
                    ✕
                  </button>
                }
              </div>
            }
          </div>

          <div class="eco-footer">
            <span>Événements grisés = hors de ta session</span>
          </div>
        }
      </div>

      </div>

    </div>
  `,
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
  private readonly ecoApi = inject(EcoCalendarApi);
  protected readonly userStore = inject(UserStore);

  protected readonly moods = MOODS;
  protected readonly planNote = signal('');

  // Pins chargés directement depuis l'API — indépendant du cache getTodayEvents
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

  protected readonly filteredEvents = computed(() => {
    const events = this.ecoCalendar()?.events ?? [];
    const pinned = this.pinnedKeys();
    const impact = this.filterImpact();
    const isKeyPinned = (e: { name: string; currency: string }) =>
      pinned.has(eventKey(e));

    return events
      .filter(e => {
        const currencyOk = this.filterCurrency() === 'all' || e.currency === this.filterCurrency();
        if (!currencyOk) return false;

        if (impact === 'all') {
          // Règle par défaut : épinglés OU fort impact uniquement
          return isKeyPinned(e) || e.impact === 'high';
        }
        // Filtre manuel choisi (high / medium) → il prime, comportement classique
        return e.impact === impact;
      })
      .sort((a, b) => {
        // Épinglés d'abord, puis tri par heure
        const aPin = isKeyPinned(a);
        const bPin = isKeyPinned(b);
        if (aPin && !bPin) return -1;
        if (!aPin && bPin) return 1;
        return a.time.localeCompare(b.time);
      });
  });

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
      .subscribe();
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
        error: () => this.isSavingNote.set(false),
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
