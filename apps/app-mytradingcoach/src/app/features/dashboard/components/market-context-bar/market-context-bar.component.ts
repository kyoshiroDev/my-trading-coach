import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MarketContext } from '../../../../core/api/trades.api';

@Component({
  selector: 'mtc-market-context-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  styleUrl: './market-context-bar.component.css',
  template: `
    @if (ctx()) {
      <div class="ctx-wrap">
        <div class="ctx-header">
          <div class="ctx-pulse-dot"></div>
          <span class="ctx-lbl">Contexte marché</span>
          <span class="ctx-src-badge">FMP</span>
          <span class="ctx-upd">MAJ 15s · {{ updatedLabel() }}</span>
        </div>

        <div class="ctx-grid">
          <div class="ctx-cell bull">
            <div class="ctx-cell-name">NQ100 <span class="ctx-src">Yahoo</span></div>
            <div class="ctx-cell-val">{{ ctx()!.nq.value | number:'1.0-0' }}</div>
            <div class="ctx-cell-sub"></div>
          </div>

          <div class="ctx-cell bull">
            <div class="ctx-cell-name">SPX <span class="ctx-src">FMP</span></div>
            <div class="ctx-cell-val">{{ ctx()!.spx.value | number:'1.0-0' }}</div>
            <div class="ctx-cell-sub"></div>
          </div>

          <div class="ctx-cell"
               [class.dxy-warn]="dxyLabel() === 'risk-off'"
               [class.dxy-ok]="dxyLabel() === 'risk-on'">
            <div class="ctx-cell-name">DXY <span class="ctx-src">FMP</span></div>
            <div class="ctx-cell-val">{{ ctx()!.dxy.value | number:'1.2-2' }}</div>
            <div class="ctx-cell-sub">
              Dollar
              @if (dxyLabel()) {
                <span class="dxy-badge"
                      [class.risk-off]="dxyLabel() === 'risk-off'"
                      [class.risk-on]="dxyLabel() === 'risk-on'">
                  {{ dxyLabel() }}
                </span>
              }
            </div>
          </div>

          <div class="ctx-cell trate10">
            <div class="ctx-cell-name">US 10Y <span class="ctx-src">FMP</span></div>
            <div class="ctx-cell-val yellow">{{ ctx()!.treasury.t10y | number:'1.2-2' }}%</div>
            <div class="ctx-cell-sub"></div>
          </div>

          <div class="ctx-cell trate2">
            <div class="ctx-cell-name">US 2Y <span class="ctx-src">FMP</span></div>
            <div class="ctx-cell-val blue">{{ ctx()!.treasury.t2y | number:'1.2-2' }}%</div>
            <div class="ctx-cell-sub"></div>
          </div>

          @if (isInverted()) {
            <div class="ctx-cell inverted">
              <div class="ctx-cell-name red">Courbe</div>
              <div class="ctx-cell-val red small">2Y &gt; 10Y</div>
              <div class="ctx-cell-sub red">⚠ +{{ spread() }}%</div>
            </div>
          } @else {
            <div class="ctx-cell">
              <div class="ctx-cell-name">Spread</div>
              <div class="ctx-cell-val green">{{ spread() }}%</div>
              <div class="ctx-cell-sub">10Y - 2Y</div>
            </div>
          }

          @if (breakingNews()) {
            <div class="ctx-breaking">
              <div class="ctx-break-dot"></div>
              <div>
                <div class="ctx-break-lbl">BREAKING</div>
                <div class="ctx-break-txt">{{ breakingNews() }}</div>
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class MarketContextBarComponent {
  readonly ctx = input<MarketContext | null>(null);
  readonly breakingNews = input<string | null>(null);

  protected readonly spread = computed(() => {
    const t2  = this.ctx()?.treasury.t2y;
    const t10 = this.ctx()?.treasury.t10y;
    if (t2 == null || t10 == null) return null;
    return parseFloat((t2 - t10).toFixed(2));
  });

  protected readonly isInverted = computed(() => (this.spread() ?? 0) > 0);

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
