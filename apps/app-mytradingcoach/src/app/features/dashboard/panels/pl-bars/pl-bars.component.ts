import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PlBucket } from '../../dashboard-charts.util';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';

/** Barres P&L divergentes depuis la ligne médiane (jour, semaine ou mois selon la période). */
@Component({
  selector: 'mtc-pl-bars',
  imports: [MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pl-bars.component.css',
  template: `
    <div class="mtc-plday">
      @for (d of buckets(); track d.key; let i = $index) {
        <div class="mtc-plday-col" [title]="d.title + ' · ' + (d.pnl | money: 0)">
          <div class="mtc-plday-cell">
            <div class="mtc-plday-bar" [class.pos]="d.pos && d.traded" [class.neg]="!d.pos && d.traded" [style.height.%]="d.barPct"></div>
            @if (d.traded && d.label) {
              <span class="mtc-plday-val" [class.pos]="d.pos" [class.neg]="!d.pos"
                [style.bottom]="d.pos ? 'calc(50% + ' + d.barPct + '%)' : null"
                [style.top]="!d.pos ? 'calc(50% + ' + d.barPct + '%)' : null">{{ d.label }}</span>
            }
          </div>
          <!-- Plus de 15 colonnes : un libellé sur deux, sinon ils se chevauchent (taille mini 11 px). -->
          <span class="mtc-plday-day" [class.traded]="d.traded" [class.skip]="buckets().length > 15 && i % 2 === 1">{{ d.axisLabel }}</span>
        </div>
      }
    </div>
  `,
})
export class PlBarsComponent {
  readonly buckets = input<PlBucket[]>([]);
}
