import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LucideAngularModule, Activity } from 'lucide-angular';
import { MarketContext } from '../../../../core/api/trades.api';

@Component({
  selector: 'mtc-market-context-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  styleUrl: './market-context-bar.component.css',
  template: `
    @if (ctx()) {
      <div class="ctx-wrap">
        <div class="ctx-header">
          <lucide-icon [img]="CtxIcon" [size]="14" class="ctx-ic" />
          <span class="ctx-lbl">Contexte marché</span>
          <span class="ctx-upd"><span class="ctx-pulse-dot"></span> MAJ 15s · {{ updatedLabel() }}</span>
        </div>

        <div class="ctx-grid">
          @if (breakingNews()) {
            <div class="ctx-breaking">
              <div class="ctx-break-dot"></div>
              <div>
                <div class="ctx-break-lbl">BREAKING</div>
                <div class="ctx-break-txt">{{ breakingNews() }}</div>
              </div>
            </div>
          }

          <div class="ctx-cell"
               [class.bull]="dir(ctx()!.nq.changePct) === 'up'"
               [class.bear]="dir(ctx()!.nq.changePct) === 'down'">
            <div class="ctx-cell-name">NQ100 <span class="ctx-desc">(Nasdaq)</span></div>
            <div class="ctx-cell-line">
              <span class="ctx-cell-val">{{ fmt(ctx()!.nq.value, 0, 0) }}</span>
              <span class="ctx-cell-chg"
                    [class.green]="dir(ctx()!.nq.changePct) === 'up'"
                    [class.red]="dir(ctx()!.nq.changePct) === 'down'">{{ pctLabel(ctx()!.nq.changePct) }}</span>
            </div>
          </div>

          <div class="ctx-cell"
               [class.bull]="dir(ctx()!.spx.changePct) === 'up'"
               [class.bear]="dir(ctx()!.spx.changePct) === 'down'">
            <div class="ctx-cell-name">SPX <span class="ctx-desc">(S&amp;P 500)</span></div>
            <div class="ctx-cell-line">
              <span class="ctx-cell-val">{{ fmt(ctx()!.spx.value, 0, 0) }}</span>
              <span class="ctx-cell-chg"
                    [class.green]="dir(ctx()!.spx.changePct) === 'up'"
                    [class.red]="dir(ctx()!.spx.changePct) === 'down'">{{ pctLabel(ctx()!.spx.changePct) }}</span>
            </div>
          </div>

          <div class="ctx-cell"
               [class.bull]="dir(ctx()!.dxy.changePct) === 'up'"
               [class.bear]="dir(ctx()!.dxy.changePct) === 'down'">
            <div class="ctx-cell-name">DXY @if (dxyLabel()) {<span class="ctx-desc"
                      [class.risk-off]="dxyLabel() === 'risk-off'"
                      [class.risk-on]="dxyLabel() === 'risk-on'">({{ dxyLabel() }})</span>}</div>
            <div class="ctx-cell-line">
              <span class="ctx-cell-val">{{ fmt(ctx()!.dxy.value, 2, 2) }}</span>
              <span class="ctx-cell-chg"
                    [class.green]="dir(ctx()!.dxy.changePct) === 'up'"
                    [class.red]="dir(ctx()!.dxy.changePct) === 'down'">{{ pctLabel(ctx()!.dxy.changePct) }}</span>
            </div>
          </div>

          <div class="ctx-cell trate2">
            <div class="ctx-cell-name">US 2Y <span class="ctx-desc">(Taux court)</span></div>
            <div class="ctx-cell-line">
              <span class="ctx-cell-val blue">{{ ctx()!.treasury.t2y !== null ? fmt(ctx()!.treasury.t2y, 2, 2) + '%' : '-' }}</span>
              <span class="ctx-cell-chg"
                    [class.green]="dir(ctx()!.treasury.t2yChg) === 'up'"
                    [class.red]="dir(ctx()!.treasury.t2yChg) === 'down'">{{ pctLabel(ctx()!.treasury.t2yChg) }}</span>
            </div>
          </div>

          <div class="ctx-cell trate5">
            <div class="ctx-cell-name">US 5Y <span class="ctx-desc">(Taux moyen)</span></div>
            <div class="ctx-cell-line">
              <span class="ctx-cell-val blue">{{ ctx()!.treasury.t5y !== null ? fmt(ctx()!.treasury.t5y, 2, 2) + '%' : '-' }}</span>
              <span class="ctx-cell-chg"
                    [class.green]="dir(ctx()!.treasury.t5yChg) === 'up'"
                    [class.red]="dir(ctx()!.treasury.t5yChg) === 'down'">{{ pctLabel(ctx()!.treasury.t5yChg) }}</span>
            </div>
          </div>

          <div class="ctx-cell trate10">
            <div class="ctx-cell-name">US 10Y <span class="ctx-desc">(Référence)</span></div>
            <div class="ctx-cell-line">
              <span class="ctx-cell-val yellow">{{ ctx()!.treasury.t10y !== null ? fmt(ctx()!.treasury.t10y, 2, 2) + '%' : '-' }}</span>
              <span class="ctx-cell-chg"
                    [class.green]="dir(ctx()!.treasury.t10yChg) === 'up'"
                    [class.red]="dir(ctx()!.treasury.t10yChg) === 'down'">{{ pctLabel(ctx()!.treasury.t10yChg) }}</span>
            </div>
          </div>

          <div class="ctx-cell trate30">
            <div class="ctx-cell-name">US 30Y <span class="ctx-desc">(Taux long)</span></div>
            <div class="ctx-cell-line">
              <span class="ctx-cell-val yellow">{{ ctx()!.treasury.t30y !== null ? fmt(ctx()!.treasury.t30y, 2, 2) + '%' : '-' }}</span>
              <span class="ctx-cell-chg"
                    [class.green]="dir(ctx()!.treasury.t30yChg) === 'up'"
                    [class.red]="dir(ctx()!.treasury.t30yChg) === 'down'">{{ pctLabel(ctx()!.treasury.t30yChg) }}</span>
            </div>
          </div>

          @if (isInverted()) {
            <div class="ctx-cell inverted">
              <div class="ctx-cell-name red">Courbe <span class="ctx-desc">(2Y &gt; 10Y)</span></div>
              <div class="ctx-cell-line">
                <span class="ctx-cell-val red small">⚠ {{ fmt(spread(), 2, 2) }}%</span>
                <span class="ctx-cell-chg red">{{ pctLabel(spreadChg()) }}</span>
              </div>
            </div>
          } @else {
            <div class="ctx-cell">
              <div class="ctx-cell-name">Spread <span class="ctx-desc">(10Y - 2Y)</span></div>
              <div class="ctx-cell-line">
                <span class="ctx-cell-val green">{{ spread() !== null ? (spread()! > 0 ? '+' : '') + fmt(spread(), 2, 2) + '%' : '-' }}</span>
                <span class="ctx-cell-chg"
                      [class.green]="dir(spreadChg()) === 'up'"
                      [class.red]="dir(spreadChg()) === 'down'">{{ pctLabel(spreadChg()) }}</span>
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class MarketContextBarComponent {
  protected readonly CtxIcon = Activity;
  readonly ctx = input<MarketContext | null>(null);
  readonly breakingNews = input<string | null>(null);

  /** Sens de variation d'un actif (vert/rouge/neutre selon changePct). */
  protected dir(pct: number | null | undefined): 'up' | 'down' | 'flat' {
    if (pct == null) return 'flat';
    return pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  }

  /** Libellé variation : « ▲ +0.45% » / « ▼ -0.32% », ou « — » si indisponible. */
  protected pctLabel(pct: number | null | undefined): string {
    if (pct == null) return '-';
    const v = pct.toFixed(2);
    if (pct > 0) return `▲ +${v}%`;
    if (pct < 0) return `▼ ${v}%`;
    return `${v}%`;
  }

  /** Formatage nombre : séparateur de milliers espace + décimale POINT (fidélité maquette). */
  protected fmt(v: number | null | undefined, min = 0, max = 2): string {
    if (v == null) return '-';
    return v.toLocaleString('fr-FR', { minimumFractionDigits: min, maximumFractionDigits: max }).replace(',', '.');
  }

  /** Spread de courbe = 10Y − 2Y (positif = courbe normale). */
  protected readonly spread = computed(() => {
    const t2  = this.ctx()?.treasury.t2y;
    const t10 = this.ctx()?.treasury.t10y;
    if (t2 == null || t10 == null) return null;
    return parseFloat((t10 - t2).toFixed(2));
  });

  /** Variation du spread (10Y − 2Y) = variation 10Y − variation 2Y. */
  protected readonly spreadChg = computed(() => {
    const c2  = this.ctx()?.treasury.t2yChg;
    const c10 = this.ctx()?.treasury.t10yChg;
    if (c2 == null || c10 == null) return null;
    return parseFloat((c10 - c2).toFixed(2));
  });

  protected readonly isInverted = computed(() => (this.spread() ?? 0) < 0);

  protected readonly dxyLabel = computed(() => {
    const v = this.ctx()?.dxy.value;
    if (v == null) return null;
    return v > 103 ? 'risk-off' : 'risk-on';
  });

  protected readonly updatedLabel = computed(() => {
    const iso = this.ctx()?.updatedAt;
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  });
}
