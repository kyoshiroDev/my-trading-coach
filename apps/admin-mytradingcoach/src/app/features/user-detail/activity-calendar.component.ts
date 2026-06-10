import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { buildMonthGrid, activityStats } from './activity-calendar.util';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/**
 * Calendrier mensuel des connexions (données réelles `activeDates`).
 * Navigation ‹ › (pas dans le futur) + pied de stats (total / série / moyenne).
 */
@Component({
  selector: 'mtc-admin-activity-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './activity-calendar.component.css',
  template: `
    <div class="cal-nav">
      <button class="cal-arrow" (click)="nav(-1)" aria-label="Mois précédent">‹</button>
      <div class="cal-month-label">{{ label() }}</div>
      <button class="cal-arrow" [disabled]="atCurrentMonth()" (click)="nav(1)" aria-label="Mois suivant">›</button>
    </div>

    <div class="cal-single">
      @for (h of weekdays; track $index) { <div class="cal-hd">{{ h }}</div> }
      @for (c of grid(); track $index) {
        @if (c.state === 'pad') {
          <div class="cal-d pad"></div>
        } @else {
          <div class="cal-d" [class.on]="c.state === 'on'" [class.future]="c.state === 'future'">{{ c.day }}</div>
        }
      }
    </div>

    <div class="hm-legend">
      <i class="lg-on"></i> connecté&nbsp;&nbsp;<i class="lg-off"></i> non
      <span class="hm-sum">{{ monthCount() }} jour{{ monthCount() > 1 ? 's' : '' }} connecté ce mois</span>
    </div>

    <div class="cal-stats">
      <div class="cal-stat"><div class="v">{{ stats().total }}</div><div class="l">jours connectés</div></div>
      <div class="cal-stat"><div class="v">{{ stats().best }}</div><div class="l">plus longue série</div></div>
      <div class="cal-stat"><div class="v">{{ stats().avg }}</div><div class="l">jours / sem.</div></div>
    </div>
  `,
})
export class ActivityCalendarComponent {
  readonly activeDates = input.required<string[]>();
  readonly createdAt = input.required<string>();

  protected readonly weekdays = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

  private readonly now = new Date();
  protected readonly view = signal({ y: this.now.getFullYear(), m: this.now.getMonth() });

  private readonly activeSet = computed(() => new Set(this.activeDates()));
  private readonly signup = computed(() => new Date(this.createdAt()));

  protected readonly grid = computed(() => buildMonthGrid(this.view().y, this.view().m, this.activeSet(), this.now));
  protected readonly monthCount = computed(() => this.grid().filter((c) => c.state === 'on').length);
  protected readonly label = computed(() => `${MONTHS[this.view().m]} ${this.view().y}`);
  protected readonly stats = computed(() => activityStats(this.activeSet(), this.signup(), this.now));

  protected readonly atCurrentMonth = computed(() => {
    const { y, m } = this.view();
    return y > this.now.getFullYear() || (y === this.now.getFullYear() && m >= this.now.getMonth());
  });

  protected nav(dir: number): void {
    let { y, m } = this.view();
    m += dir;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    // pas au-delà du mois courant
    if (y > this.now.getFullYear() || (y === this.now.getFullYear() && m > this.now.getMonth())) {
      y = this.now.getFullYear();
      m = this.now.getMonth();
    }
    this.view.set({ y, m });
  }
}
