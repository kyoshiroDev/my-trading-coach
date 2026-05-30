import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { SessionTrade } from '../../../../../../core/api/session.api';

@Component({
  selector: 'mtc-live-feed',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="feed-col" data-testid="live-feed">
      <div class="col-title">
        Live feed
        <div class="pulse-dot"></div>
      </div>
      @if (trades().length === 0) {
        <div class="empty-feed">
          <div class="empty-feed-icon">📋</div>
          <div class="empty-feed-title">Aucun trade loggué</div>
          <div class="empty-feed-sub">Utilise le formulaire →<br>Asset + direction + émotion suffisent</div>
        </div>
      } @else {
        <div class="feed-list">
          @for (trade of trades(); track trade.id) {
            @if (trade.pnl !== null) {
              <div class="feed-row-2l">
                <div class="feed-l1">
                  <span class="feed-time">{{ tradeTime(trade.tradedAt) }}</span>
                  <span class="trade-side" [class]="trade.side.toLowerCase()">{{ trade.side }}</span>
                  <span class="feed-asset">{{ trade.asset }}</span>
                  <span class="feed-badge" [class]="closeBadgeClass(trade.tags)" style="margin-left:auto">
                    {{ closeBadgeLabel(trade.tags) }}
                  </span>
                </div>
                <div class="feed-l2">
                  <span class="feed-price">Entrée: {{ (trade.entry && trade.entry > 0) ? trade.entry : '—' }}</span>
                  <span class="feed-sep">·</span>
                  <span class="feed-price">Sortie: {{ trade.exit ?? '—' }}</span>
                  <span class="feed-pnl" [class.green]="trade.pnl >= 0" [class.red]="trade.pnl < 0" style="margin-left:auto">
                    {{ trade.pnl >= 0 ? '+' : '' }}{{ trade.pnl.toFixed(0) }}$
                  </span>
                </div>
              </div>
            } @else {
              <div class="feed-row-2l live-row" role="button" tabindex="0"
                   (click)="openClosePanel(trade.id)"
                   (keyup.enter)="openClosePanel(trade.id)">
                <div class="feed-l1">
                  <span class="feed-time">{{ tradeTime(trade.tradedAt) }}</span>
                  <span class="trade-side" [class]="trade.side.toLowerCase()">{{ trade.side }}</span>
                  <span class="feed-asset">{{ trade.asset }}</span>
                  <span class="live-tag">● LIVE</span>
                </div>
                <div class="feed-l2">
                  <span class="feed-price">Entrée: {{ (trade.entry && trade.entry > 0) ? trade.entry : '—' }}</span>
                  <span class="feed-sep">·</span>
                  <span class="feed-price">Sortie: —</span>
                </div>
              </div>
              @if (closingTradeId() === trade.id) {
                <div class="close-panel" data-testid="trade-close-panel">
                  <div class="close-panel-title">{{ trade.side }} {{ trade.asset }} · Clôture</div>
                  <div class="close-panel-row">
                    <div class="close-input-wrap">
                      <div class="close-input-lbl">PRIX DE SORTIE</div>
                      <input class="close-input" type="number" placeholder="0.00"
                             data-testid="trade-exit-price"
                             [value]="exitPriceInput()"
                             (input)="exitPriceInput.set($any($event.target).value)" />
                    </div>
                    <button class="close-btn-ok" (click)="submitClose(trade)">OK →</button>
                    <button class="close-btn-cancel" (click)="cancelClose()">✕</button>
                  </div>
                  @if (exitPriceInput()) {
                    <div data-testid="trade-close-type" style="margin-top:6px;font-size:10px;color:var(--text-3);font-family:var(--font-mono);">
                      → {{ detectCloseType(trade, +exitPriceInput()) }}
                    </div>
                  }
                </div>
              }
            }
          }
        </div>
      }
    </div>
  `,
})
export class LiveFeedComponent {
  readonly trades      = input<SessionTrade[]>([]);
  readonly tradeClosed = output<{ tradeId: string; exitPrice: number }>();

  protected readonly closingTradeId = signal<string | null>(null);
  protected readonly exitPriceInput = signal('');

  protected openClosePanel(id: string): void {
    if (this.closingTradeId() === id) { this.cancelClose(); return; }
    this.closingTradeId.set(id);
    this.exitPriceInput.set('');
  }

  protected cancelClose(): void { this.closingTradeId.set(null); this.exitPriceInput.set(''); }

  protected submitClose(trade: SessionTrade): void {
    const exitPrice = parseFloat(this.exitPriceInput());
    if (!exitPrice || exitPrice <= 0) return;
    this.tradeClosed.emit({ tradeId: trade.id, exitPrice });
    this.closingTradeId.set(null);
    this.exitPriceInput.set('');
  }

  protected tradeTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  protected closeBadgeClass(tags: string[]): string {
    if (tags.includes('TP')) return 'tp';
    if (tags.includes('SL')) return 'sl';
    return 'manual';
  }

  protected closeBadgeLabel(tags: string[]): string {
    if (tags.includes('TP')) return 'TP';
    if (tags.includes('SL')) return 'SL';
    return '—';
  }

  protected detectCloseType(trade: SessionTrade, exitPrice: number): string {
    if (trade.stopLoss !== null) {
      const isSl = trade.side === 'LONG' ? exitPrice <= trade.stopLoss : exitPrice >= trade.stopLoss;
      if (isSl) return 'SL détecté';
    }
    if (trade.takeProfit !== null) {
      const isTp = trade.side === 'LONG' ? exitPrice >= trade.takeProfit : exitPrice <= trade.takeProfit;
      if (isTp) return 'TP détecté';
    }
    return 'Clôture manuelle';
  }
}
