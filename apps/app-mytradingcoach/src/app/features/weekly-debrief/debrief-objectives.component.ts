import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export interface Objective {
  title: string;
  reason: string;
  done?: boolean;
}

@Component({
  selector: 'mtc-debrief-objectives',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="objectives">
      @for (obj of objectives; track obj.title; let i = $index) {
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
      @if (!objectives.length) {
        <p class="empty">Aucun objectif défini</p>
      }
    </div>
  `,
  styles: [`
    .objectives { display: flex; flex-direction: column; }

    .obj-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 11px 0;
      border-bottom: 1px solid rgba(99,155,255,0.06);
    }

    .obj-row:last-child { border-bottom: none; padding-bottom: 0; }

    .obj-num {
      width: 22px; height: 22px;
      min-width: 22px;
      background: var(--blue-glow);
      border: 1px solid var(--blue);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--blue-bright);
      font-weight: 600;
      margin-top: 1px;
    }

    .obj-num.done {
      background: var(--green-dim);
      border-color: var(--green);
      color: var(--green);
    }

    .obj-content { flex: 1; min-width: 0; }

    .obj-title {
      font-size: 13px;
      color: var(--text);
      line-height: 1.4;
      margin-bottom: 3px;
    }

    .obj-title.done { text-decoration: line-through; color: var(--text-3); }

    .obj-meta {
      font-size: 11px;
      color: var(--text-3);
      font-family: var(--font-mono);
    }

    .obj-check {
      font-size: 12px;
      color: var(--green);
      margin-top: 2px;
    }

    .empty { font-size: 13px; color: var(--text-3); padding: 8px 0; }
  `],
})
export class DebriefObjectivesComponent {
  @Input({ required: true }) objectives: Objective[] = [];
}
