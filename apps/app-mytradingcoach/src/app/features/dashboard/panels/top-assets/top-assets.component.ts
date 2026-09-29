import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { PnlFormatPipe } from '@app/shared/pipes';
import { TopAssetBar } from '../../dashboard-charts.util';

/**
 * Top actifs (P&L par instrument, barres horizontales) = vue de base FREE ;
 * le win rate par actif est la profondeur Premium (`showWinRate`).
 */
@Component({
  selector: 'mtc-top-assets',
  imports: [UpperCasePipe, PnlFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './top-assets.component.css',
  template: `
    <div class="mtc-hbars">
      @for (a of assets(); track a.asset) {
        <div class="mtc-hbar">
          <div class="mtc-hbar-l">
            <div class="mtc-hbar-name">{{ a.asset | uppercase }}</div>
            <div class="mtc-hbar-meta">{{ a.count }} trade{{ a.count > 1 ? 's' : '' }}@if (showWinRate()) { · {{ a.winRate.toFixed(0) }}%}</div>
          </div>
          <div class="mtc-hbar-track"><div class="mtc-hbar-fill" [class.neg]="a.pnl < 0" [style.width.%]="a.barPct"></div></div>
          <div class="mtc-hbar-v" [style.color]="a.pnl >= 0 ? 'var(--green)' : 'var(--red)'">{{ a.pnl | pnlFormat }}</div>
        </div>
      }
    </div>
  `,
})
export class TopAssetsComponent {
  readonly assets = input<TopAssetBar[]>([]);
  readonly showWinRate = input(false);
}
