import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe, UpperCasePipe } from '@angular/common';
import { PctPipe } from '@mtc/front-ui';
import { PnlFormatPipe } from '@app/shared/pipes';
import { DashboardTradeRow, TradeRowOutcome } from '../../dashboard-charts.util';
import { isInactiveStatus, statusBadgeClass, statusLabel } from '@app/core/utils/account-status.util';

/**
 * « Historique des trades » du dashboard (derniers trades, P&L % sur le capital du compte du trade). Tableau sur tablette et
 * PC, cartes de 2 lignes sur téléphone : le tableau de 760 px défilait de côté et cachait le P&L (#633).
 * Un trade ouvert garde son badge « OUVERT » à toutes les tailles : colonne Résultat (large), à côté de
 * l'actif (moyenne, colonne masquée), dans la carte (téléphone). Un trade d'un compte échoué ou
 * archivé (interrupteur « Inclure les comptes échoués et archivés » allumé) porte le badge du journal.
 */
@Component({
  selector: 'mtc-recent-trades-table',
  imports: [DatePipe, UpperCasePipe, PnlFormatPipe, PctPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './recent-trades-table.component.css',
  template: `
    <div class="mtc-table-wrap">
      <table class="mtc-table">
        <thead><tr>
          <th>Date</th><th>Actif</th><th>Direction</th><th>Stratégie</th>
          <th class="r">Entrée</th><th class="r col-exit">Sortie</th><th class="r">R:R</th><th class="r">P&amp;L</th><th class="r">P&amp;L&nbsp;%</th><th class="c col-res">Résultat</th>
        </tr></thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              <td class="mono dim">{{ t.tradedAt | date:'d MMM' }}</td>
              <td class="mono strong">
                {{ t.asset | uppercase }}
                <!-- Taille moyenne : la colonne Résultat est masquée, un trade ouvert garde son badge ici. -->
                @if (t.outcome === 'open') { <span class="mtc-res open mtc-res-inline">{{ LABEL.open }}</span> }
                <!-- Compte échoué ou archivé (interrupteur allumé) : même badge que le journal. -->
                @if (t.account && isInactiveStatus(t.account.status)) {
                  <span class="status-badge {{ statusBadgeClass(t.account.status) }}"
                        [attr.title]="t.account.label + '\u00a0: hors statistiques'"
                        data-testid="trade-account-badge">{{ statusLabel(t.account.status) }}</span>
                }
              </td>
              <td><span class="mtc-side" [class.long]="t.side === 'LONG'">{{ t.side }}</span></td>
              <td><span class="mtc-setup-cell"><span class="setup-dot-sm" [style.background]="t.setup.color"></span>{{ t.setup.title }}</span></td>
              <td class="mono dim r">{{ price(t.entry) }}</td>
              <td class="mono dim r col-exit">{{ price(t.exit) }}</td>
              <td class="mono dim r">{{ rr(t.riskReward) }}</td>
              <td class="mono strong r" [style.color]="TONE[t.outcome]">{{ t.pnl | pnlFormat : null : t.accountId }}</td>
              <td class="mono r" [style.color]="t.pct === null ? 'var(--text-3)' : TONE[t.outcome]">{{ t.pct === null ? '-' : (t.pct | pct:2:true) }}</td>
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
            @if (t.account && isInactiveStatus(t.account.status)) {
              <span class="status-badge {{ statusBadgeClass(t.account.status) }}"
                    [attr.title]="t.account.label + '\u00a0: hors statistiques'"
                    data-testid="trade-account-badge">{{ statusLabel(t.account.status) }}</span>
            }
          </span>
          <span class="mtc-tc-pnl" [style.color]="TONE[t.outcome]">{{ t.pnl | pnlFormat : null : t.accountId }}</span>
          <span class="mtc-tc-sub">
            {{ t.tradedAt | date:'d MMM' }} · <span class="setup-dot-sm" [style.background]="t.setup.color"></span>{{ t.setup.title }}
            · R:R {{ rr(t.riskReward) }}
          </span>
          <span class="mtc-tc-pct" [style.color]="t.pct === null ? 'var(--text-3)' : TONE[t.outcome]">{{ t.pct === null ? '-' : (t.pct | pct:2:true) }}</span>
        </li>
      }
    </ul>
  `,
})
export class RecentTradesTableComponent {
  readonly rows = input<DashboardTradeRow[]>([]);

  protected readonly isInactiveStatus = isInactiveStatus;
  protected readonly statusLabel = statusLabel;
  protected readonly statusBadgeClass = statusBadgeClass;

  /** Badge « Résultat » : un trade ouvert n'est ni gagnant ni perdant (#655). */
  protected readonly LABEL: Record<TradeRowOutcome, string> = { win: 'WIN', loss: 'LOSS', breakeven: 'BE', open: 'OUVERT' };
  protected readonly TONE: Record<TradeRowOutcome, string> = {
    win: 'var(--green)', loss: 'var(--red)', breakeven: 'var(--text-3)', open: 'var(--text-3)',
  };

  /** Prix : milliers en espace, décimale au point, 2 décimales au plus (#1180) : « 21 489.25 ». */
  protected price(v: number | null | undefined): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '-';
    return v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(',', '.');
  }

  /** R:R signé à 1 décimale, au point (#1180) : « +1.5 », « -0.8 » ; inconnu → « — ». */
  protected rr(v: number | null | undefined): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  }
}
