import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface Objective {
  title: string;
  reason: string;
  done?: boolean;
}

@Component({
  selector: 'mtc-debrief-objectives',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './debrief-objectives.component.css',
  template: `
    <div class="objectives">
      @for (obj of objectives(); track obj.title; let i = $index) {
        <div class="obj-row">
          <div class="obj-num" [class.done]="obj.done">{{ i + 1 }}</div>
          <div class="obj-content">
            <div class="obj-title" [class.done]="obj.done">{{ obj.title }}</div>
            <div class="obj-meta">{{ obj.reason }}</div>
          </div>
          @if (obj.done) {
            <span class="obj-check">✓</span>
          }
        </div>
      }
      @if (!objectives().length) {
        <p class="empty">Aucun objectif défini</p>
      }
    </div>
  `,
})
export class DebriefObjectivesComponent {
  objectives = input.required<Objective[]>();
}