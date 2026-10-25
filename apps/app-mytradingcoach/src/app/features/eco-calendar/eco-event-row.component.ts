import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
} from '@angular/core';
import type { EcoEvent } from '@mtc/shared';
import {
  LucideDynamicIcon,
  LucidePin as Pin,
} from '@lucide/angular';

@Component({
  selector: 'mtc-eco-event-row',
  imports: [LucideDynamicIcon],
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
        ><svg [lucideIcon]="PinIcon" [size]="13"></svg></label>
      </div>

      <div class="eco-impact-bar" [class]="event().impact"></div>

      <div class="eco-event-main">
        <div class="eco-event-top">
          <span class="eco-event-time">{{ event().time }}</span>
          <span class="eco-flag">{{ flag() }}</span>
          <span class="eco-event-name" [title]="translatedName()">{{ translatedName() }}</span>
        </div>

        <div class="eco-event-meta">
          <span class="eco-currency-tag">{{ event().currency }}</span>
          <span class="eco-impact-badge" [class]="event().impact">
            {{ event().impact === 'high' ? 'Fort' : 'Moyen' }}
          </span>
          @if (event().isReleased) {
            <span class="eco-published">✓ Publié</span>
          }
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
      </div>
    </div>
  `,
})
export class EcoEventRowComponent {
  protected readonly PinIcon = Pin;
  readonly event          = input.required<EcoEvent>();
  readonly pinned         = input(false);
  readonly flag           = input('🌐');
  readonly translatedName = input('');
  readonly togglePin      = output<EcoEvent>();
}
