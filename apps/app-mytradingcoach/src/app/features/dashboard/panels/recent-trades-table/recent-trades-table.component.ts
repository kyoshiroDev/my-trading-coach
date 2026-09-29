import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe, DecimalPipe, UpperCasePipe } from '@angular/common';
import { PnlFormatPipe } from '@app/shared/pipes';
import { DashboardTradeRow } from '../../dashboard-charts.util';

/** Tableau « historique des trades » du dashboard (derniers trades, P&L % sur le capital). */
@Component({
  selector: 'mtc-recent-trades-table',
  imports: [DatePipe, DecimalPipe, UpperCasePipe, PnlFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './recent-trades-table.component.css',
  template: `
    <div class="mtc-table-wrap">
      <table class="mtc-table">
        <thead><tr>
          <th>Date</th><th>Actif</th><th>Direction</th><th>Stratégie</th>
          <th class="r">Entrée</th><th class="r">Sortie</th><th class="r">R:R</th><th class="r">P&amp;L</th><th class="r">P&amp;L %</th><th class="c">Résultat</th>
        </tr></thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              <td class="mono dim">{{ t.tradedAt | date:'d MMM' }}</td>
              <td class="mono strong">{{ t.asset | uppercase }}</td>
              <td><span class="mtc-side" [class.long]="t.side === 'LONG'">{{ t.side }}</span></td>
              <td><span class="mtc-setup-cell"><span class="setup-dot-sm" [style.background]="t.setup.color"></span>{{ t.setup.title }}</span></td>
              <td class="mono dim r">{{ t.entry | number:'1.0-2' }}</td>
              <td class="mono dim r">{{ t.exit !== null ? (t.exit | number:'1.0-2') : '-' }}</td>
              <td class="mono dim r">{{ t.riskReward !== null ? ((t.riskReward >= 0 ? '+' : '') + (t.riskReward | number:'1.1-1')) : '-' }}</td>
              <td class="mono strong r" [style.color]="t.win ? 'var(--green)' : 'var(--red)'">{{ t.pnl | pnlFormat : null : t.accountId }}</td>
              <td class="mono r" [style.color]="t.pct === null ? 'var(--text-3)' : (t.win ? 'var(--green)' : 'var(--red)')">{{ t.pct === null ? '-' : ((t.pct >= 0 ? '+' : '') + (t.pct | number:'1.2-2') + '%') }}</td>
              <td class="c"><span class="mtc-res" [class.win]="t.win">{{ t.win ? 'WIN' : 'LOSS' }}</span></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class RecentTradesTableComponent {
  readonly rows = input<DashboardTradeRow[]>([]);
}
