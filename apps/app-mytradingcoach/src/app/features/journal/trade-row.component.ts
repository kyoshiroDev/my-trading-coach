import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { LucideAngularModule, Trash2, Edit2 } from 'lucide-angular';
import { Trade } from '../../core/stores/trades.store';
import { PnlColorPipe } from '../../shared/pipes/pnl-color.pipe';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';

/* eslint-disable @angular-eslint/component-selector */
@Component({
  selector: '[mtc-trade-row]',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TitleCasePipe, LucideAngularModule, PnlColorPipe, EmotionEmojiPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'trade-row-host' },
  template: `
    <td class="td-asset">{{ trade.asset }}</td>
    <td>
      <span class="side-badge" [class]="trade.side === 'LONG' ? 'long' : 'short'">
        {{ trade.side }}
      </span>
    </td>
    <td class="td-num">{{ trade.entry | number:'1.2-5' }}</td>
    <td class="td-num">{{ trade.exit !== null ? (trade.exit | number:'1.2-5') : '—' }}</td>
    <td class="td-num" [class]="trade.pnl | pnlColor">
      @if (trade.pnl !== null) {
        {{ trade.pnl >= 0 ? '+' : '' }}\${{ trade.pnl | number:'1.2-2' }}
      } @else {
        <span class="neutral">—</span>
      }
    </td>
    <td class="td-num">
      {{ trade.riskReward !== null ? (trade.riskReward | number:'1.2-2') : '—' }}
    </td>
    <td>
      <span class="emotion-cell">
        {{ trade.emotion | emotionEmoji }} {{ trade.emotion | titlecase }}
      </span>
    </td>
    <td>
      <span class="setup-chip">{{ trade.setup }}</span>
    </td>
    <td class="td-date">{{ trade.tradedAt | date:'d MMM HH:mm' }}</td>
    <td class="td-actions">
      <button class="action-btn edit-btn" title="Modifier" (click)="edit.emit(trade)">
        <lucide-icon [img]="Edit2Icon" [size]="13" />
      </button>
      <button class="action-btn del-btn" title="Supprimer" (click)="delete.emit(trade.id)">
        <lucide-icon [img]="Trash2Icon" [size]="13" />
      </button>
    </td>
  `,
  styles: [`
    :host { display: contents; }

    .td-asset {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 500;
      color: var(--blue-bright);
    }

    .side-badge {
      font-size: 10px;
      font-family: var(--font-mono);
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }

    .side-badge.long { background: rgba(16,185,129,0.12); color: var(--green); }
    .side-badge.short { background: rgba(239,68,68,0.12); color: var(--red); }

    .td-num {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-2);
    }

    .td-num.pos { color: var(--green); }
    .td-num.neg { color: var(--red); }

    .neutral { color: var(--text-3); }

    .emotion-cell {
      font-size: 12px;
      color: var(--text-2);
    }

    .setup-chip {
      font-size: 10px;
      font-family: var(--font-mono);
      background: var(--blue-glow);
      color: var(--blue-bright);
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid rgba(59,130,246,0.15);
    }

    .td-date {
      font-size: 11px;
      color: var(--text-3);
      font-family: var(--font-mono);
    }

    .td-actions {
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.15s;
    }

    :host(:hover) .td-actions { opacity: 1; }

    .action-btn {
      width: 26px; height: 26px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }

    .edit-btn { background: var(--bg-3); color: var(--text-2); }
    .edit-btn:hover { background: var(--blue-glow); color: var(--blue-bright); }

    .del-btn { background: var(--bg-3); color: var(--text-2); }
    .del-btn:hover { background: var(--red-dim); color: var(--red); }
  `],
})
export class TradeRowComponent {
  @Input({ required: true }) trade!: Trade;
  @Output() edit = new EventEmitter<Trade>();
  @Output() delete = new EventEmitter<string>();

  protected readonly Edit2Icon = Edit2;
  protected readonly Trash2Icon = Trash2;
}
