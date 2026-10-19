import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe, DecimalPipe, UpperCasePipe } from '@angular/common';
import { PnlFormatPipe } from '@app/shared/pipes';
import { DashboardTradeRow, TradeRowOutcome } from '../../dashboard-charts.util';

/**
 * « Historique des trades » du dashboard (derniers trades, P&L % sur le capital). Tableau sur tablette et
 * PC, cartes de 2 lignes sur téléphone : le tableau de 760 px défilait de côté et cachait le P&L (#633).
 * Un trade ouvert garde son badge « OUVERT » à toutes les tailles : colonne Résultat (large), à côté de
 * l'actif (moyenne, colonne masquée), dans la carte (téléphone).
 */
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
          <th class="r">Entrée</th><th class="r col-exit">Sortie</th><th class="r">R:R</th><th class="r">P&amp;L</th><th class="r">P&amp;L %</th><th class="c col-res">Résultat</th>
        </tr></thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              <td class="mono dim">{{ t.tradedAt | date:'d MMM' }}</td>
              <td class="mono strong">
                {{ t.asset | uppercase }}
                <!-- Taille moyenne : la colonne Résultat est masquée, un trade ouvert garde son badge ici. -->
                @if (t.outcome === 'open') { <span class="mtc-res open mtc-res-inline">{{ LABEL.open }}</span> }
              </td>
              <td><span class="mtc-side" [class.long]="t.side === 'LONG'">{{ t.side }}</span></td>
              <td><span class="mtc-setup-cell"><span class="setup-dot-sm" [style.background]="t.setup.color"></span>{{ t.setup.title }}</span></td>
              <td class="mono dim r">{{ t.entry | number:'1.0-2' }}</td>
              <td class="mono dim r col-exit">{{ t.exit !== null ? (t.exit | number:'1.0-2') : '-' }}</td>
              <td class="mono dim r">{{ t.riskReward !== null ? ((t.riskReward >= 0 ? '+' : '') + (t.riskReward | number:'1.1-1')) : '-' }}</td>
              <td class="mono strong r" [style.color]="TONE[t.outcome]">{{ t.pnl | pnlFormat : null : t.accountId }}</td>
              <td class="mono r" [style.color]="t.pct === null ? 'var(--text-3)' : TONE[t.outcome]">{{ t.pct === null ? '-' : ((t.pct >= 0 ? '+' : '') + (t.pct | number:'1.2-2') + '%') }}</td>
              <td class="c col-res"><span class="mtc-res" [class]="t.outcome">{{ LABEL[t.outcome] }}</span></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <ul class="mtc-trade-cards">
      @for (t of rows(); track t.id) {
        <li class="mtc-tc">
          <span class="mtc-tc-asset">
            {{ t.asset | uppercase }} <span class="mtc-side" [class.long]="t.side === 'LONG'">{{ t.side }}</span>
            <!-- La colonne Résultat n'existe pas en carte : un trade ouvert garde son badge. -->
            @if (t.outcome === 'open') { <span class="mtc-res open">{{ LABEL.open }}</span> }
          </span>
          <span class="mtc-tc-pnl" [style.color]="TONE[t.outcome]">{{ t.pnl | pnlFormat : null : t.accountId }}</span>
          <span class="mtc-tc-sub">
            {{ t.tradedAt | date:'d MMM' }} · <span class="setup-dot-sm" [style.background]="t.setup.color"></span>{{ t.setup.title }}
            · R:R {{ t.riskReward !== null ? ((t.riskReward >= 0 ? '+' : '') + (t.riskReward | number:'1.1-1')) : '-' }}
          </span>
          <span class="mtc-tc-pct" [style.color]="t.pct === null ? 'var(--text-3)' : TONE[t.outcome]">{{ t.pct === null ? '-' : ((t.pct >= 0 ? '+' : '') + (t.pct | number:'1.2-2') + '%') }}</span>
        </li>
      }
    </ul>
  `,
})
export class RecentTradesTableComponent {
  readonly rows = input<DashboardTradeRow[]>([]);

  /** Badge « Résultat » : un trade ouvert n'est ni gagnant ni perdant (#655). */
  protected readonly LABEL: Record<TradeRowOutcome, string> = { win: 'WIN', loss: 'LOSS', breakeven: 'BE', open: 'OUVERT' };
  protected readonly TONE: Record<TradeRowOutcome, string> = {
    win: 'var(--green)', loss: 'var(--red)', breakeven: 'var(--text-3)', open: 'var(--text-3)',
  };
}
