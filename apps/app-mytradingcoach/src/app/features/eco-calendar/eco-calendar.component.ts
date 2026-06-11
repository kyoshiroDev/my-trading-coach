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
import { EcoEventRowComponent } from './eco-event-row.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { EcoCalendarApi, EcoEvent } from '../../core/api/eco-calendar.api';
import { translateEcoEvent } from '../../core/data/eco-event-translations';
import { todayParis, toParisDateStr } from '../../core/utils/paris-date';
import { UserStore } from '../../core/stores/user.store';

type EcoSession = 'asia' | 'europe' | 'us';
interface SessionGroup { asia: EcoEvent[]; europe: EcoEvent[]; us: EcoEvent[]; }
interface DayGroup {
  date: string;
  label: string;
  isToday: boolean;
  events: EcoEvent[];
  sessions: SessionGroup;
}

@Component({
  selector: 'mtc-eco-calendar-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EcoEventRowComponent],
  templateUrl: './eco-calendar.component.html',
  styleUrl: './eco-calendar.component.css',
})
export class EcoCalendarComponent implements OnInit {
  private readonly api = inject(EcoCalendarApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly userStore = inject(UserStore);

  protected readonly currentWeekStart = signal(this.getMonday(new Date()));
  protected readonly isLoading = signal(false);

  // ── Onglets de session ──────────────────────────────────────────────────
  protected readonly SESSION_TABS: { k: 'all' | EcoSession; nm: string }[] = [
    { k: 'all', nm: 'Tous' }, { k: 'asia', nm: '🌏 Asie' },
    { k: 'europe', nm: '🇪🇺 Europe' }, { k: 'us', nm: '🇺🇸 US' },
  ];
  protected readonly sessionTab = signal<'all' | EcoSession>('all');
  private tabInitialized = false;

  // tradingSessions du profil → onglet par défaut (1 seule session connue ⇒ celle-ci, sinon Tous)
  private static readonly SESSION_BY_PROFILE: Record<string, EcoSession> = {
    LONDON: 'europe', NEW_YORK: 'us', ASIAN: 'asia',
  };

  constructor() {
    effect(() => {
      if (this.tabInitialized) return;
      const user = this.userStore.user();
      if (!user) return; // on attend que le profil soit chargé
      this.tabInitialized = true;
      const unique = [...new Set(
        (user.tradingSessions ?? [])
          .map(s => EcoCalendarComponent.SESSION_BY_PROFILE[s])
          .filter((x): x is EcoSession => !!x),
      )];
      if (unique.length === 1) this.sessionTab.set(unique[0]);
    });
  }

  protected readonly dayGroups = signal<DayGroup[]>([]);
  protected readonly pinnedEvents = signal<Set<string>>(new Set());
  protected readonly isSavingPins = signal(false);
  protected readonly pinnedUpcoming = signal<EcoEvent[]>([]);

  protected readonly filterImpact = signal<'all' | 'high' | 'medium'>('all');
  protected readonly filterCurrency = signal<string>('all');
  protected readonly filterCountry = signal<string>('all');

  protected readonly availableCurrencies = computed(() => {
    const all = this.dayGroups().flatMap(d => d.events.map(e => e.currency));
    return [...new Set(all)].sort();
  });

  protected readonly availableCountries = computed(() => {
    const all = this.dayGroups().flatMap(d => d.events);
    return [...new Map(
      all.map(e => [e.country, { code: e.country, flag: this.getFlag(e) }]),
    ).values()].sort((a, b) => a.code.localeCompare(b.code));
  });

  protected readonly filteredDayGroups = computed(() =>
    this.dayGroups()
      .map(group => {
        const events = (group.events ?? []).filter(e => {
          const impactOk = this.filterImpact() === 'all' || e.impact === this.filterImpact();
          const currencyOk = this.filterCurrency() === 'all' || e.currency === this.filterCurrency();
          const countryOk = this.filterCountry() === 'all' || e.country === this.filterCountry();
          return impactOk && currencyOk && countryOk;
        });
        return {
          ...group,
          events,
          sessions: this.bucketBySession(events),
        };
      })
      .filter(g => g.events.length > 0),
  );

  protected readonly totalEvents = computed(() =>
    this.filteredDayGroups().reduce((s, g) => s + g.events.length, 0),
  );

  protected readonly hasActiveFilters = computed(() =>
    this.filterImpact() !== 'all' ||
    this.filterCurrency() !== 'all' ||
    this.filterCountry() !== 'all',
  );

  protected readonly selectedDate = signal<string | null>(null);

  protected readonly selectedDayGroup = computed(() => {
    const date = this.selectedDate();
    const groups = this.filteredDayGroups();
    if (!date) return groups[0] ?? null;
    return groups.find(g => g.date === date) ?? groups[0] ?? null;
  });

  // Compteurs par onglet pour le jour sélectionné (filtres déjà appliqués en amont).
  protected readonly tabCounts = computed(() => {
    const g = this.selectedDayGroup();
    const s = g?.sessions ?? { asia: [], europe: [], us: [] };
    return { all: g?.events.length ?? 0, asia: s.asia.length, europe: s.europe.length, us: s.us.length };
  });

  // Events du jour sélectionné filtrés par l'onglet (cumulé aux filtres existants), triés par heure.
  protected readonly tabbedEvents = computed(() => {
    const g = this.selectedDayGroup();
    if (!g) return [];
    const tab = this.sessionTab();
    const list = tab === 'all' ? g.events : g.sessions[tab];
    return [...list].sort((a, b) => this.timeMinutes(a.time) - this.timeMinutes(b.time));
  });

  protected readonly weekDays = computed(() => {
    const monday = this.currentWeekStart();
    const today = todayParis();
    const out: {
      date: string; label: string; short: string; dayNum: string;
      count: number; hasHigh: boolean; isToday: boolean;
    }[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const date = toParisDateStr(d);
      const group = this.filteredDayGroups().find(g => g.date === date);
      out.push({
        date,
        label: this.formatDayLabel(date),
        short: d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''),
        dayNum: String(d.getDate()),
        count: group?.events.length ?? 0,
        hasHigh: (group?.events ?? []).some(e => e.impact === 'high'),
        isToday: date === today,
      });
    }
    return out;
  });

  ngOnInit() {
    this.loadWeek(this.currentWeekStart());
    this.api.getPins()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => this.pinnedEvents.set(new Set(res.data ?? [])));
    this.loadPinnedUpcoming();
  }

  protected prevWeek(): void {
    const d = new Date(this.currentWeekStart());
    d.setDate(d.getDate() - 7);
    this.currentWeekStart.set(d);
    this.loadWeek(d);
  }

  protected nextWeek(): void {
    const d = new Date(this.currentWeekStart());
    d.setDate(d.getDate() + 7);
    this.currentWeekStart.set(d);
    this.loadWeek(d);
  }

  protected goToThisWeek(): void {
    const monday = this.getMonday(new Date());
    this.currentWeekStart.set(monday);
    this.loadWeek(monday);
  }

  protected resetFilters(): void {
    this.filterImpact.set('all');
    this.filterCurrency.set('all');
    this.filterCountry.set('all');
  }

  protected selectDay(date: string): void {
    this.selectedDate.set(date);
  }

  protected setSessionTab(tab: 'all' | EcoSession): void {
    this.sessionTab.set(tab);
  }

  private timeMinutes(time: string | undefined): number {
    const [h, m] = (time ?? '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  private setDefaultSelectedDay(): void {
    const today = todayParis();
    const days = this.weekDays();
    const todayInWeek = days.find(d => d.date === today);
    this.selectedDate.set(todayInWeek ? today : (days[0]?.date ?? null));
  }

  private loadWeek(monday: Date): void {
    this.isLoading.set(true);
    const from = toParisDateStr(monday);
    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 4);
    const to = toParisDateStr(friday);

    this.api.getEventsRange(from, to)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe(res => {
        const today = todayParis();

        this.dayGroups.set(
          (res.data ?? []).map(d => {
            const events = d.events ?? [];
            return {
              date: d.date,
              label: this.formatDayLabel(d.date),
              isToday: d.date === today,
              events,
              sessions: this.bucketBySession(events),
            };
          }),
        );
        this.setDefaultSelectedDay();
      });
  }

  protected togglePin(event: EcoEvent): void {
    const key = `${event.name}:${event.currency}`;
    const pins = new Set(this.pinnedEvents());
    if (pins.has(key)) { pins.delete(key); } else { pins.add(key); }
    this.pinnedEvents.set(pins);

    this.isSavingPins.set(true);
    this.api.savePins([...pins])
      .pipe(finalize(() => this.isSavingPins.set(false)))
      .subscribe(() => this.loadPinnedUpcoming());
  }

  private loadPinnedUpcoming(): void {
    this.api.getPinnedUpcoming()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => this.pinnedUpcoming.set(res.data ?? []));
  }

  protected formatShortDay(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  protected isPinned(event: EcoEvent): boolean {
    return this.pinnedEvents().has(`${event.name}:${event.currency}`);
  }

  protected translate(name: string): string {
    return translateEcoEvent(name);
  }

  private readonly FLAGS: Record<string, string> = {
    // Codes pays
    US: '🇺🇸', EU: '🇪🇺', GB: '🇬🇧', JP: '🇯🇵', CA: '🇨🇦', AU: '🇦🇺',
    NZ: '🇳🇿', CH: '🇨🇭', CN: '🇨🇳', DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹',
    ES: '🇪🇸', SE: '🇸🇪', NO: '🇳🇴', DK: '🇩🇰', KR: '🇰🇷', TR: '🇹🇷',
    RU: '🇷🇺', BR: '🇧🇷', IN: '🇮🇳', ZA: '🇿🇦', PL: '🇵🇱', HU: '🇭🇺',
    CZ: '🇨🇿', IL: '🇮🇱', TH: '🇹🇭', ID: '🇮🇩', MX: '🇲🇽', SG: '🇸🇬',
    HK: '🇭🇰', PT: '🇵🇹', AT: '🇦🇹', BE: '🇧🇪', FI: '🇫🇮', NL: '🇳🇱',
    // Codes devise
    USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CAD: '🇨🇦', AUD: '🇦🇺',
    NZD: '🇳🇿', CHF: '🇨🇭', CNY: '🇨🇳', CNH: '🇨🇳', SEK: '🇸🇪', NOK: '🇳🇴',
    DKK: '🇩🇰', HKD: '🇭🇰', SGD: '🇸🇬', MXN: '🇲🇽', KRW: '🇰🇷', TRY: '🇹🇷',
    RUB: '🇷🇺', BRL: '🇧🇷', INR: '🇮🇳', ZAR: '🇿🇦', PLN: '🇵🇱', HUF: '🇭🇺',
    CZK: '🇨🇿', ILS: '🇮🇱', THB: '🇹🇭', IDR: '🇮🇩',
  };

  protected getFlag(event: { country?: string | null; currency?: string | null }): string {
    if (event.country) {
      const f = this.FLAGS[event.country.toUpperCase()];
      if (f) return f;
    }
    return this.FLAGS[event.currency?.toUpperCase() ?? ''] ?? '🌐';
  }

  protected getWeekLabel(): string {
    const monday = this.currentWeekStart();
    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 4);
    const fmt = (d: Date) =>
      d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    return `Semaine du ${fmt(monday)} — ${fmt(friday)}`;
  }

  protected formatDayLabel(date: string): string {
    const d = new Date(date + 'T12:00:00');
    const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  protected isThisWeek(): boolean {
    const monday = this.getMonday(new Date());
    return toParisDateStr(this.currentWeekStart()) === toParisDateStr(monday);
  }

  /**
   * Compteur du bandeau = même source que « Ma sélection » (`pinnedUpcoming`),
   * la liste des épinglés du jour résolue côté serveur. Garantit par construction
   * bandeau = items « Ma sélection » = N, sans divergence possible.
   */
  protected get pinnedCount(): number {
    return this.pinnedUpcoming().length;
  }

  protected highCount(group: DayGroup): number {
    return group.events.filter(e => e.impact === 'high').length;
  }

  // Session de marché par région de la devise (et plus par heure) — ex. EUR 14:15 → Europe.
  private static readonly SESSION_BY_CCY: Record<string, EcoSession> = {
    // Asie / Pacifique
    JPY: 'asia', CNY: 'asia', AUD: 'asia', NZD: 'asia', KRW: 'asia', INR: 'asia',
    HKD: 'asia', SGD: 'asia', TWD: 'asia', IDR: 'asia', THB: 'asia', MYR: 'asia',
    // Europe / EMEA
    EUR: 'europe', GBP: 'europe', CHF: 'europe', SEK: 'europe', NOK: 'europe',
    DKK: 'europe', PLN: 'europe', HUF: 'europe', CZK: 'europe', TRY: 'europe', ZAR: 'europe', RUB: 'europe',
    // Amériques
    USD: 'us', CAD: 'us', MXN: 'us', BRL: 'us', ARS: 'us', CLP: 'us',
  };

  private sessionOf(event: EcoEvent): EcoSession {
    const byCcy = EcoCalendarComponent.SESSION_BY_CCY[event.currency?.toUpperCase()];
    if (byCcy) return byCcy;
    // Repli si devise non mappée : par heure (Europe/Paris) — avant 14h ⇒ europe, sinon us
    const [h, m] = (event.time ?? '00:00').split(':').map(Number);
    return ((h || 0) * 60 + (m || 0)) >= 14 * 60 ? 'us' : 'europe';
  }

  private bucketBySession(events: EcoEvent[]): SessionGroup {
    return {
      asia:   events.filter(e => this.sessionOf(e) === 'asia'),
      europe: events.filter(e => this.sessionOf(e) === 'europe'),
      us:     events.filter(e => this.sessionOf(e) === 'us'),
    };
  }

  private getMonday(d: Date): Date {
    const parisStr = d.toLocaleDateString('en-US', { timeZone: 'Europe/Paris', weekday: 'short' });
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = map[parisStr] ?? d.getDay();
    let diff: number;
    if (day === 0) diff = 1;
    else if (day === 6) diff = 2;
    else diff = 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }
}