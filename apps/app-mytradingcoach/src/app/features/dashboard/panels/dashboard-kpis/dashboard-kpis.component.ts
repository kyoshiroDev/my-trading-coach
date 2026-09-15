import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MoneyService } from '../../../../core/services/money.service';
import { DecimalPipe } from '@angular/common';
import { AnalyticsSummary } from '../../../../core/api/analytics.api';
import { InfoTooltipComponent } from '../../../../shared/components/info-tooltip/info-tooltip.component';
import { PnlFormatPipe } from '../../../../shared/pipes';
import { sparkPath } from '../../dashboard-charts.util';

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
  readonly baseCapital = input(0);
  readonly currentCapital = input(0);
  /** P&L cumulé jour par jour sur la période (source des sparklines). */
  readonly equitySeries = input<number[]>([]);
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

  protected readonly drawdownDisplay = computed(() => {
    const dd = this.summary()?.maxDrawdown ?? 0;
    return dd > 0 ? -dd : dd;
  });
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
    const start = this.baseCapital();
    return start <= 0 ? 0 : ((this.summary()?.totalPnl ?? 0) / start) * 100;
  });
  protected readonly capitalColor = computed(() => {
    const start = this.baseCapital();
    if (start <= 0) return 'var(--text-2)';
    const pnl = this.summary()?.totalPnl ?? 0;
    return pnl === 0 ? 'var(--text-2)' : pnl > 0 ? 'var(--green)' : 'var(--red)';
  });
  protected readonly drawdownColor = computed(() =>
    (this.summary()?.maxDrawdown ?? 0) === 0 ? 'var(--text-2)' : 'var(--red)',
  );

  protected readonly capitalSeries = computed(() => {
    const b = this.baseCapital();
    return this.equitySeries().map((v) => b + v);
  });
  /** Drawdown courant (val − pic) le long de la courbe : série rouge des KPI. */
  protected readonly ddSeries = computed(() => {
    let peak = -Infinity;
    return this.equitySeries().map((v) => { peak = Math.max(peak, v); return v - peak; });
  });

  /** Donut mini win rate (KPI). */
  protected readonly winRateDonut = computed(() => {
    const wr = Math.max(0, Math.min(100, this.summary()?.winRate ?? 0));
    return `conic-gradient(var(--blue) 0% ${wr}%, rgba(143,163,191,.18) ${wr}% 100%)`;
  });
}
