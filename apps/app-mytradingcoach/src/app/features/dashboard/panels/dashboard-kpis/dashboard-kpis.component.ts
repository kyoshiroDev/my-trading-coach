import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MoneyService } from '@app/core/services/money.service';
import { DecimalPipe } from '@angular/common';
import { AnalyticsSummary } from '@app/core/api/analytics.api';
import { InfoTooltipComponent } from '@app/shared/components/info-tooltip/info-tooltip.component';
import { PnlFormatPipe } from '@app/shared/pipes';
import { sparkPath } from '../../dashboard-charts.util';
import { maxDrawdownOf } from '@app/core/services/equity-period.util';

/** Rangée des 6 KPIs du dashboard (capital, P&L, win rate, profit factor, trades, drawdown). */
@Component({
  selector: 'mtc-dashboard-kpis',
  imports: [DecimalPipe, PnlFormatPipe, InfoTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dashboard-kpis.component.css',
  templateUrl: './dashboard-kpis.component.html',
})
export class DashboardKpisComponent {
  /** Squelette tant que les comptes ou les données de base ne sont pas chargés. */
  readonly loading = input(false);
  readonly summary = input<AnalyticsSummary | null>(null);
  /** Solde au début de la période (solde actuel − P&L de la période) : base du % et de la sparkline. */
  readonly periodStartCapital = input(0);
  /** Solde actuel du compte (le même que le sélecteur et Mes comptes). */
  readonly currentCapital = input(0);
  /** Drawdown jour par jour depuis le plus haut du compte (règle EOD), point de départ compris. */
  readonly drawdownSeries = input<number[]>([]);
  /** P&L cumulé jour par jour sur la période (source des sparklines). */
  readonly equitySeries = input<number[]>([]);
  /** Payouts cumulés aux mêmes points : la sparkline du Capital les déduit (fin = Capital). */
  readonly payoutSeries = input<number[]>([]);
  readonly periodShort = input('');
  /** Trades chargés : repli du compteur tant que les KPIs n'en donnent pas. */
  readonly fallbackTradesCount = input(0);

  protected readonly sparkPath = sparkPath;

  /** Profit factor : valeur 2 décimales, ∞ si aucune perte, - si aucune donnée. */
  protected readonly profitFactorDisplay = computed(() => {
    const pf = this.summary()?.profitFactor;
    if (pf == null) return (this.summary()?.totalTrades ?? 0) > 0 ? '∞' : '-';
    return pf.toFixed(2);
  });

  /** Plus fort drawdown de la période : même série que la courbe de drawdown des Statistiques. */
  protected readonly drawdownDisplay = computed(() => maxDrawdownOf(this.drawdownSeries()));
  protected readonly pnlColor = computed(() => {
    const pnl = this.summary()?.totalPnl ?? 0;
    return pnl === 0 ? 'var(--text-2)' : pnl > 0 ? 'var(--green)' : 'var(--red)';
  });
  protected readonly winRateColor = computed(() =>
    (this.summary()?.winRate ?? 0) === 0 ? 'var(--text-2)' : 'var(--blue-bright)',
  );
  private readonly money = inject(MoneyService);

  /** Capital dans la devise native du compte, sans conversion. */
  protected readonly capitalDisplay = computed(() =>
    this.money.format(this.currentCapital(), { sign: false }),
  );
  protected readonly capitalPct = computed(() => {
    const start = this.periodStartCapital();
    return start <= 0 ? 0 : ((this.summary()?.totalPnl ?? 0) / start) * 100;
  });
  protected readonly capitalColor = computed(() => {
    const start = this.periodStartCapital();
    if (start <= 0) return 'var(--text-2)';
    const pnl = this.summary()?.totalPnl ?? 0;
    return pnl === 0 ? 'var(--text-2)' : pnl > 0 ? 'var(--green)' : 'var(--red)';
  });
  protected readonly drawdownColor = computed(() =>
    this.drawdownDisplay() === 0 ? 'var(--text-2)' : 'var(--red)',
  );

  protected readonly capitalSeries = computed(() => {
    const b = this.periodStartCapital();
    const paid = this.payoutSeries();
    return this.equitySeries().map((v, i) => b + v - (paid[i] ?? 0));
  });
  /** Série rouge du KPI drawdown (sans le point de départ, comme les autres sparklines). */
  protected readonly ddSeries = computed(() => this.drawdownSeries().slice(1));

  /** Barre win rate (KPI), pleine largeur de la carte comme les autres visuels (#642). */
  protected readonly winRatePct = computed(() => Math.max(0, Math.min(100, this.summary()?.winRate ?? 0)));
}
