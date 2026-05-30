import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NewsItem } from '../../../../../../core/api/trades.api';

@Component({
  selector: 'mtc-live-news',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="news-col">
      <div class="col-title-row">
        <div class="col-title">📰 News live</div>
        <span class="ai-badge">AI</span>
      </div>
      @if (breakingNews()) {
        <div class="news-breaking">
          <div class="news-break-dot"></div>
          <span class="news-break-txt">BREAKING · {{ breakingNews() }}</span>
        </div>
      }
      <div class="news-feed">
        @if (items().length === 0) {
          <div class="news-empty">Aucune news pour le moment</div>
        } @else {
          @for (item of items(); track item.publishedDate) {
            <div class="news-item"
                 role="button"
                 tabindex="0"
                 (click)="newsClicked.emit(item)"
                 (keyup.enter)="newsClicked.emit(item)">
              <div class="news-item-top">
                <span class="news-asset-tag">{{ item.symbol }}</span>
                <span class="news-sentiment" [class]="item.sentiment ?? 'neutral'">
                  {{ item.sentiment === 'bull' ? '▲ Bull' : item.sentiment === 'bear' ? '▼ Bear' : '— Neutre' }}
                </span>
                <span class="news-time">{{ formatNewsTime(item.publishedDate) }}</span>
              </div>
              <div class="news-title">{{ item.title }}</div>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class LiveNewsComponent {
  readonly items        = input<NewsItem[]>([]);
  readonly breakingNews = input<string | null>(null);
  readonly newsClicked  = output<NewsItem>();

  protected formatNewsTime(iso: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}
