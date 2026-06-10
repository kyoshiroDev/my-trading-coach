import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { EcoEventRowComponent } from './eco-event-row.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { EcoCalendarApi, EcoEvent } from '../../core/api/eco-calendar.api';
import { translateEcoEvent } from '../../core/data/eco-event-translations';
import { normalizeEventKey } from '../../core/data/eco-event-key';
import { todayParis, toParisDateStr } from '../../core/utils/paris-date';

interface SessionGroup { europe: EcoEvent[]; us: EcoEvent[]; }
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

  protected readonly currentWeekStart = signal(this.getMonday(new Date()));
  protected readonly isLoading = signal(false);

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
          sessions: {
            europe: events.filter(e => this.sessionOf(e) === 'europe'),
            us:     events.filter(e => this.sessionOf(e) === 'us'),
          },
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
              sessions: {
                europe: events.filter(e => this.sessionOf(e) === 'europe'),
                us:     events.filter(e => this.sessionOf(e) === 'us'),
              },
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

  protected get pinnedCount(): number {
    return this.pinnedEvents().size;
  }

  /** Clés normalisées des épinglés ayant une occurrence dans la fenêtre (« Ma sélection »). */
  protected readonly pinnedUpcomingKeys = computed(
    () => new Set(this.pinnedUpcoming().map(e => normalizeEventKey(`${e.name}:${e.currency}`))),
  );

  /** Épinglés SANS occurrence proche → affichés honnêtement (pas de « 0 » silencieux). */
  protected readonly otherPinned = computed(() => {
    const upcoming = this.pinnedUpcomingKeys();
    return [...this.pinnedEvents()]
      .filter(k => !upcoming.has(normalizeEventKey(k)))
      .map(k => ({ key: k, label: this.pinLabel(k) }));
  });

  /** Libellé lisible d'une clé `name:currency` (sans suffixe de période ni devise). */
  private pinLabel(key: string): string {
    const colon = key.lastIndexOf(':');
    const name = (colon === -1 ? key : key.substring(0, colon)).replace(/\s*\([^)]*\)\s*$/, '').trim();
    return name;
  }

  /** Désépingle par clé brute (utilisé pour les épinglés « pas cette semaine »). */
  protected unpinKey(key: string): void {
    const pins = new Set(this.pinnedEvents());
    pins.delete(key);
    this.pinnedEvents.set(pins);
    this.isSavingPins.set(true);
    this.api.savePins([...pins])
      .pipe(finalize(() => this.isSavingPins.set(false)))
      .subscribe(() => this.loadPinnedUpcoming());
  }

  protected highCount(group: DayGroup): number {
    return group.events.filter(e => e.impact === 'high').length;
  }

  private sessionOf(event: EcoEvent): 'europe' | 'us' {
    const [h, m] = (event.time ?? '00:00').split(':').map(Number);
    return ((h || 0) * 60 + (m || 0)) >= 13 * 60 + 30 ? 'us' : 'europe';
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