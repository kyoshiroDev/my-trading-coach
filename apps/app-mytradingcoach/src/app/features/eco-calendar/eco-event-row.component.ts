import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
} from '@angular/core';
import { EcoEvent } from '../../core/api/eco-calendar.api';

@Component({
  selector: 'mtc-eco-event-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './eco-event-row.component.css',
  template: `
    <div class="eco-event-row"
         [class.pinned]="pinned()"
         [class.released]="event().isReleased"
         [class.high]="event().impact === 'high'">

      <div class="eco-pin-wrap">
        <input
          type="checkbox"
          class="eco-pin-check"
          [id]="'pin-' + event().name + '-' + event().currency"
          [checked]="pinned()"
          (change)="togglePin.emit(event())"
        />
        <label
          class="eco-pin-label"
          [attr.for]="'pin-' + event().name + '-' + event().currency"
          [title]="pinned() ? 'Retirer des épinglés' : 'Épingler dans ma session'"
        >📌</label>
      </div>

      <div class="eco-event-time">{{ event().time }}</div>
      <div class="eco-impact-bar" [class]="event().impact"></div>
      <span class="eco-flag">{{ flag() }}</span>

      <div class="eco-event-body">
        <div class="eco-event-name">{{ translatedName() }}</div>
        @if (event().previous !== null || event().estimate !== null || event().actual !== null) {
          <div class="eco-event-values">
            @if (event().actual !== null) {
              <span class="eco-val actual"
                    [class.beat]="event().estimate !== null && event().actual! > event().estimate!"
                    [class.miss]="event().estimate !== null && event().actual! < event().estimate!">
                A: {{ event().actual }}{{ event().unit }}
              </span>
            }
            @if (event().estimate !== null) {
              <span class="eco-val estimate">P: {{ event().estimate }}{{ event().unit }}</span>
            }
            @if (event().previous !== null) {
              <span class="eco-val previous">Préc: {{ event().previous }}{{ event().unit }}</span>
            }
          </div>
        }
      </div>

      <span class="eco-currency-tag">{{ event().currency }}</span>

      <span class="eco-impact-badge" [class]="event().impact">
        {{ event().impact === 'high' ? 'Fort' : 'Moyen' }}
      </span>

      @if (event().isReleased) {
        <span class="eco-published">✓ Publié</span>
      }
    </div>
  `,
})
export class EcoEventRowComponent {
  readonly event          = input.required<EcoEvent>();
  readonly pinned         = input(false);
  readonly flag           = input('🌐');
  readonly translatedName = input('');
  readonly togglePin      = output<EcoEvent>();
}
