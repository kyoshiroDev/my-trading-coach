import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { EcoCalendarApi, EcoEvent } from '../../core/api/eco-calendar.api';
import { translateEcoEvent } from '../../core/data/eco-event-translations';
import { todayParis, toParisDateStr } from '../../core/utils/paris-date';

interface DayGroup {
  date: string;
  label: string;
  isToday: boolean;
  events: EcoEvent[];
}

@Component({
  selector: 'mtc-eco-calendar-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
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
      .map(group => ({
        ...group,
        events: group.events.filter(e => {
          const impactOk = this.filterImpact() === 'all' || e.impact === this.filterImpact();
          const currencyOk = this.filterCurrency() === 'all' || e.currency === this.filterCurrency();
          const countryOk = this.filterCountry() === 'all' || e.country === this.filterCountry();
          return impactOk && currencyOk && countryOk;
        }),
      }))
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

  ngOnInit() {
    this.loadWeek(this.currentWeekStart());
    this.api.getPins()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => this.pinnedEvents.set(new Set(res.data ?? [])));
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
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = toParisDateStr(tomorrow);

        this.dayGroups.set(
          (res.data ?? []).map(d => ({
            date: d.date,
            label: this.formatDayLabel(d.date, today, tomorrowStr),
            isToday: d.date === today,
            events: d.events,
          })),
        );
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
      .subscribe();
  }

  protected isPinned(event: EcoEvent): boolean {
    return this.pinnedEvents().has(`${event.name}:${event.currency}`);
  }

  protected translate(name: string): string {
    return translateEcoEvent(name);
  }

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
    return `${fmt(monday)} — ${fmt(friday)}`;
  }

  protected formatDayLabel(date: string, today: string, tomorrow: string): string {
    if (date === today) return "Aujourd'hui";
    if (date === tomorrow) return 'Demain';
    const d = new Date(date + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  protected isThisWeek(): boolean {
    const monday = this.getMonday(new Date());
    return toParisDateStr(this.currentWeekStart()) === toParisDateStr(monday);
  }

  protected get pinnedCount(): number {
    return this.pinnedEvents().size;
  }

  private getMonday(d: Date): Date {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }
}