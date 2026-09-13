import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { PlBucket } from '../../dashboard-charts.util';

/** Barres P&L divergentes depuis la ligne médiane (jour, semaine ou mois selon la période). */
@Component({
  selector: 'mtc-pl-bars',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pl-bars.component.css',
  template: `
    <div class="mtc-plday">
      @for (d of buckets(); track d.key) {
        <div class="mtc-plday-col" [title]="d.title + ' · ' + (d.pnl >= 0 ? '+' : '') + (d.pnl | number: '1.0-0') + '$'">
          <div class="mtc-plday-cell">
            <div class="mtc-plday-bar" [class.pos]="d.pos && d.traded" [class.neg]="!d.pos && d.traded" [style.height.%]="d.barPct"></div>
            @if (d.traded && d.label) {
              <span class="mtc-plday-val" [class.pos]="d.pos" [class.neg]="!d.pos"
                [style.bottom]="d.pos ? 'calc(50% + ' + d.barPct + '%)' : null"
                [style.top]="!d.pos ? 'calc(50% + ' + d.barPct + '%)' : null">{{ d.label }}</span>
            }
          </div>
          <span class="mtc-plday-day" [class.traded]="d.traded">{{ d.axisLabel }}</span>
        </div>
      }
    </div>
  `,
})
export class PlBarsComponent {
  readonly buckets = input<PlBucket[]>([]);
}
