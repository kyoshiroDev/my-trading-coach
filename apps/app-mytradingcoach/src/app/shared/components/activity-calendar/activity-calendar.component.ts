import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { MonthlyActivitySummary, DailyActivity } from '../../../core/api/analytics.api';

export interface CalendarCell {
  date: string;
  day: number;
  isEmpty: boolean;
  activity: DailyActivity | null;
}

const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

@Component({
  selector: 'mtc-activity-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './activity-calendar.component.css',
  template: `
    <div class="cal-wrapper">
      <div class="cal-header">
        <div class="cal-title-row">
          <span class="cal-title">
            Activité — {{ monthLabel() }}
          </span>
          @if (data()) {
            <span class="cal-summary">
              <span class="cal-sum-item" [class.green]="data()!.totalPnl >= 0" [class.red]="data()!.totalPnl < 0">
                {{ data()!.totalPnl >= 0 ? '+' : '' }}{{ data()!.totalPnl.toFixed(0) }}$
              </span>
              <span class="cal-sum-sep">·</span>
              <span class="cal-sum-item">{{ data()!.tradingDays }}j</span>
              <span class="cal-sum-sep">·</span>
              <span class="cal-sum-item">{{ data()!.totalTrades }} trades</span>
            </span>
          }
        </div>
        @if (showNavigation()) {
          <div class="cal-nav">
            <button class="cal-nav-btn" (click)="prevMonth()" aria-label="Mois précédent">‹</button>
            <button class="cal-nav-btn" (click)="nextMonth()" [disabled]="isCurrentMonth()" aria-label="Mois suivant">›</button>
          </div>
        }
      </div>

      @if (loading()) {
        <div class="cal-loading">
          <div class="cal-skel-row">
            @for (_ of [1,2,3,4,5,6,7]; track $index) {
              <div class="cal-skel-cell"></div>
            }
          </div>
        </div>
      } @else {
        <div class="cal-grid">
          @for (label of dayLabels; track label) {
            <div class="cal-day-label">{{ label }}</div>
          }
          @for (cell of calendarGrid(); track cell.date || $index) {
            @if (cell.isEmpty) {
              <div class="cal-cell empty"></div>
            } @else {
              <div
                class="cal-cell"
                [class]="cellClass(cell)"
                [attr.title]="cellTitle(cell)"
                [attr.aria-label]="cellTitle(cell)"
              >
                <span class="cal-day-num">{{ cell.day }}</span>
                @if (cell.activity) {
                  <span class="cal-pnl">{{ formatPnl(cell.activity.pnl) }}</span>
                }
              </div>
            }
          }
        </div>
        <div class="cal-legend">
          <span class="legend-label">Perte</span>
          <div class="legend-dot red-3"></div>
          <div class="legend-dot red-2"></div>
          <div class="legend-dot red-1"></div>
          <div class="legend-dot neutral"></div>
          <div class="legend-dot green-1"></div>
          <div class="legend-dot green-2"></div>
          <div class="legend-dot green-3"></div>
          <span class="legend-label">Gain</span>
        </div>
      }
    </div>
  `,
})
export class ActivityCalendarComponent {
  readonly data = input<MonthlyActivitySummary | null>(null);
  readonly loading = input<boolean>(false);
  readonly showNavigation = input<boolean>(false);
  readonly year = input<number>(new Date().getFullYear());
  readonly month = input<number>(new Date().getMonth() + 1);

  readonly monthChange = output<{ year: number; month: number }>();

  protected readonly dayLabels = DAY_LABELS;

  protected readonly monthLabel = computed(() => {
    const m = this.month();
    const y = this.year();
    return `${MONTH_LABELS[m - 1]} ${y}`;
  });

  protected readonly isCurrentMonth = computed(() => {
    const now = new Date();
    return this.year() === now.getFullYear() && this.month() === now.getMonth() + 1;
  });

  protected readonly calendarGrid = computed((): CalendarCell[] => {
    const y = this.year();
    const m = this.month();
    const activityMap = new Map<string, DailyActivity>();
    for (const d of this.data()?.days ?? []) {
      activityMap.set(d.date, d);
    }

    const firstDay = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    // Monday = 0, Sunday = 6
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const cells: CalendarCell[] = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push({ date: '', day: 0, isEmpty: true, activity: null });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({
        date: dateKey,
        day: d,
        isEmpty: false,
        activity: activityMap.get(dateKey) ?? null,
      });
    }

    return cells;
  });

  protected cellClass(cell: CalendarCell): string {
    if (!cell.activity) return 'cal-cell no-trade';
    const pnl = cell.activity.pnl;
    if (pnl === 0) return 'cal-cell neutral';

    const absMax = Math.max(...(this.data()?.days.map(d => Math.abs(d.pnl)) ?? [1]));
    const ratio = Math.abs(pnl) / (absMax || 1);
    const intensity = ratio > 0.66 ? 3 : ratio > 0.33 ? 2 : 1;

    return pnl > 0 ? `cal-cell green-${intensity}` : `cal-cell red-${intensity}`;
  }

  protected cellTitle(cell: CalendarCell): string {
    if (!cell.activity) return cell.date;
    const { pnl, tradesCount, winRate } = cell.activity;
    const sign = pnl >= 0 ? '+' : '';
    return `${cell.date} — ${sign}${pnl.toFixed(0)}$ · ${tradesCount} trades · ${winRate.toFixed(0)}% WR`;
  }

  protected formatPnl(pnl: number): string {
    if (Math.abs(pnl) >= 1000) return `${pnl >= 0 ? '+' : ''}${(pnl / 1000).toFixed(1)}k`;
    return `${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}`;
  }

  protected prevMonth(): void {
    let y = this.year();
    let m = this.month() - 1;
    if (m < 1) { m = 12; y--; }
    this.monthChange.emit({ year: y, month: m });
  }

  protected nextMonth(): void {
    if (this.isCurrentMonth()) return;
    let y = this.year();
    let m = this.month() + 1;
    if (m > 12) { m = 1; y++; }
    this.monthChange.emit({ year: y, month: m });
  }
}
