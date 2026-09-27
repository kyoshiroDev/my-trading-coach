import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { LucideDynamicIcon, LucideListOrdered as ListOrdered } from '@lucide/angular';
import { SessionTrade } from '../../../../../../core/api/session.api';
import { NumericInputDirective } from '../../../../../../core/directives/numeric-input.directive';
import { parseDecimal } from '../../../../../../core/utils/parse-decimal';
import { EmotionEmojiPipe } from '../../../../../../shared/pipes/emotion-emoji.pipe';
import { MoneyPipe } from '../../../../../../shared/pipes/money.pipe';
import { netPnl } from '@mtc/shared';

/**
 * Live feed de la session : trades du jour en ligne compacte. Un trade encore ouvert se
 * clôture sur place (prix de sortie → SL / TP / clôture manuelle détectés).
 */
@Component({
  selector: 'mtc-live-feed',
  imports: [LucideDynamicIcon, NumericInputDirective, EmotionEmojiPipe, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './live-feed.component.css',
  template: `
    <div class="feed-col" data-testid="live-feed">
      <div class="col-title">
        <svg [lucideIcon]="FeedIcon" [size]="14" class="ct-ic"></svg> Live feed
        <div class="pulse-dot"></div>
      </div>

      @if (trades().length === 0) {
        <div class="empty-feed">
          <div class="empty-feed-icon">📋</div>
          <div class="empty-feed-title">Aucun trade loggué</div>
          <div class="empty-feed-sub">
            Utilise le formulaire →<br>
            Asset + direction + émotion suffisent
          </div>
        </div>
      } @else {
        <div class="feed-list">
          @for (trade of trades(); track trade.id) {
            @if (trade.pnl !== null) {
              <div class="feed-row">
                <span class="feed-time">{{ tradeTime(trade.tradedAt) }}</span>
                <span class="feed-asset">{{ trade.asset }}</span>
                <span class="trade-side" [class]="trade.side.toLowerCase()">{{ trade.side === 'LONG' ? '▲' : '▼' }} {{ trade.side }}</span>
                <span class="feed-emo" [title]="trade.emotion">{{ trade.emotion | emotionEmoji }}</span>
                @let net = netPnl(trade) ?? 0;
                <span class="feed-pnl" [class.green]="net >= 0" [class.red]="net < 0" style="margin-left:auto;">
                  {{ net | money:0 }}
                </span>
              </div>
            } @else {
              <div
                class="feed-row live-row"
                role="button"
                tabindex="0"
                (click)="openClosePanel(trade.id)"
                (keyup.enter)="openClosePanel(trade.id)"
              >
                <span class="feed-time">{{ tradeTime(trade.tradedAt) }}</span>
                <span class="feed-asset">{{ trade.asset }}</span>
                <span class="trade-side" [class]="trade.side.toLowerCase()">{{ trade.side === 'LONG' ? '▲' : '▼' }} {{ trade.side }}</span>
                <span class="feed-emo" [title]="trade.emotion">{{ trade.emotion | emotionEmoji }}</span>
                <span class="live-tag" style="margin-left:auto;">● LIVE</span>
              </div>

              @if (closingTradeId() === trade.id) {
                <div class="close-panel" data-testid="trade-close-panel">
                  <div class="close-panel-title">
                    {{ trade.side }} {{ trade.asset }} · Clôture
                  </div>
                  <div class="close-panel-row">
                    <div class="close-input-wrap">
                      <div class="close-input-lbl">PRIX DE SORTIE</div>
                      <input
                        class="close-input"
                        type="text"
                        inputmode="decimal"
                        mtcNumericInput
                        placeholder="0.00"
                        data-testid="trade-exit-price"
                        [value]="exitPriceInput()"
                        (input)="exitPriceInput.set($any($event.target).value)"
                      />
                    </div>
                    <button class="close-btn-ok" (click)="submitClose()">OK →</button>
                    <button aria-label="Annuler" class="close-btn-cancel" (click)="cancelClose()">✕</button>
                  </div>
                  @if (exitPriceInput()) {
                    <div data-testid="trade-close-type" style="margin-top:6px;font-size:var(--fs-2xs);color:var(--text-3);font-family:var(--font-mono);">
                      → {{ detectCloseType(trade, exitPriceInput()) }}
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

  protected readonly FeedIcon = ListOrdered;
  /** P&L net des frais, comme le total de la session. */
  protected readonly netPnl = netPnl;

  protected readonly closingTradeId = signal<string | null>(null);
  protected readonly exitPriceInput = signal('');

  protected openClosePanel(tradeId: string): void {
    if (this.closingTradeId() === tradeId) {
      this.cancelClose();
    } else {
      this.closingTradeId.set(tradeId);
      this.exitPriceInput.set('');
    }
  }

  protected cancelClose(): void {
    this.closingTradeId.set(null);
    this.exitPriceInput.set('');
  }

  protected submitClose(): void {
    const tradeId = this.closingTradeId();
    const exitPrice = parseDecimal(this.exitPriceInput());
    if (!tradeId || exitPrice == null || exitPrice <= 0) return;
    this.tradeClosed.emit({ tradeId, exitPrice });
    this.cancelClose();
  }

  protected detectCloseType(trade: SessionTrade, exitRaw: string): string {
    const exitPrice = parseDecimal(exitRaw);
    if (exitPrice == null) return 'Clôture manuelle';
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

  protected tradeTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}
