import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PlBucket } from '../../dashboard-charts.util';
import { MoneyPipe } from '@app/shared/pipes/money.pipe';

/** Barres P&L divergentes depuis la ligne médiane (jour, semaine ou mois selon la période). */
@Component({
  selector: 'mtc-pl-bars',
  imports: [MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pl-bars.component.css',
  template: `
    <div class="mtc-plday" [class.dense]="buckets().length > 15">
      @for (d of buckets(); track d.key; let i = $index) {
        <div class="mtc-plday-col" [title]="d.title + ' · ' + (d.pnl | money: 0)">
          <div class="mtc-plday-cell">
            <div class="mtc-plday-bar" [class.pos]="d.pos && d.traded" [class.neg]="!d.pos && d.traded" [style.height.%]="d.barPct"></div>
            @if (d.traded && d.label) {
              <span class="mtc-plday-val" [class.pos]="d.pos" [class.neg]="!d.pos" [class.minor]="!extremes().has(d.key)"
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

  /** Meilleur gain et pire perte : seules valeurs gardées quand le graphique est trop serré (#639). */
  protected readonly extremes = computed(() => {
    const traded = this.buckets().filter((b) => b.traded && b.label);
    const keys = new Set<string>();
    const best = traded.filter((b) => b.pos).sort((a, b) => b.pnl - a.pnl)[0];
    const worst = traded.filter((b) => !b.pos).sort((a, b) => a.pnl - b.pnl)[0];
    if (best) keys.add(best.key);
    if (worst) keys.add(worst.key);
    return keys;
  });
}
