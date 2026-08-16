import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { LucideAngularModule, Trash2, Edit2 } from 'lucide-angular';
import { Trade } from '../../core/stores/trades.store';
import { PnlColorPipe } from '../../shared/pipes/pnl-color.pipe';
import { PnlFormatPipe } from '../../shared/pipes/pnl-format.pipe';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';

/* eslint-disable @angular-eslint/component-selector */
@Component({
  selector: '[mtc-trade-row]',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    TitleCasePipe,
    LucideAngularModule,
    PnlColorPipe,
    PnlFormatPipe,
    EmotionEmojiPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'trade-row-host' },
  template: `
    <td class="td-asset">{{ trade().asset }}</td>
    <td>
      <span
        class="side-badge"
        [class]="trade().side === 'LONG' ? 'long' : 'short'"
      >
        {{ trade().side }}
      </span>
    </td>
    <td class="td-num">{{ trade().entry | number: '1.2-5' }}</td>
    <td class="td-num">
      {{ trade().exit !== null ? (trade().exit | number: '1.2-5') : '-' }}
    </td>
    <td class="td-num" [class]="trade().pnl | pnlColor">
      {{ trade().pnl | pnlFormat }}
    </td>
    <td class="td-num">
      {{
        trade().riskReward !== null
          ? (trade().riskReward | number: '1.2-2')
          : '-'
      }}
    </td>
    <td>
      <span class="emotion-cell">
        {{ trade().effectiveEmotion | emotionEmoji }} {{ (trade().effectiveEmotion | titlecase) || '-' }}
      </span>
    </td>
    <td>
      <span class="setup-chip">
        <span class="setup-chip-dot" [style.background]="trade().setup.color"></span>{{ trade().setup.title }}
      </span>
    </td>
    <td class="td-date">{{ trade().tradedAt | date: 'd MMM HH:mm' }}</td>
    <td class="td-actions">
      <button
        class="action-btn edit-btn"
        title="Modifier"
        (click)="edit.emit(trade())"
      >
        <lucide-icon [img]="Edit2Icon" [size]="13" />
      </button>
      <button
        class="action-btn del-btn"
        title="Supprimer"
        (click)="delete.emit(trade().id)"
      >
        <lucide-icon [img]="Trash2Icon" [size]="13" />
      </button>
    </td>
  `,
  styleUrl: './trade-row.component.css',
})
export class TradeRowComponent {
  trade = input.required<Trade>();
  edit = output<Trade>();
  delete = output<string>();

  protected readonly Edit2Icon = Edit2;
  protected readonly Trash2Icon = Trash2;
}
