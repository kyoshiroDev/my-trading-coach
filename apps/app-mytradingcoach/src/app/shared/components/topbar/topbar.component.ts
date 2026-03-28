import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';
import { LucideAngularModule, Plus, Bell } from 'lucide-angular';

@Component({
  selector: 'mtc-topbar',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="topbar">
      <h1 class="page-title">{{ title }}</h1>
      <div class="topbar-actions">
        @if (showAddButton) {
          <button class="btn btn-primary" (click)="addClick.emit()">
            <lucide-icon [img]="PlusIcon" [size]="14" />
            {{ addLabel }}
          </button>
        }
        @if (showNotifications) {
          <button class="btn btn-ghost icon-btn" title="Notifications">
            <lucide-icon [img]="BellIcon" [size]="16" />
          </button>
        }
      </div>
    </header>
  `,
  styles: [`
    .topbar {
      position: sticky;
      top: 0;
      background: rgba(8, 12, 20, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      padding: 0 28px;
      height: 56px;
      display: flex;
      align-items: center;
      gap: 16px;
      z-index: 5;
    }

    .page-title {
      font-family: var(--font-display);
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.3px;
      flex: 1;
      color: var(--text);
    }

    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
      font-family: var(--font-body);
    }

    .btn-primary {
      background: var(--blue);
      color: white;
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
    }

    .btn-primary:hover {
      background: var(--blue-bright);
      box-shadow: 0 0 28px rgba(59, 130, 246, 0.45);
      transform: translateY(-1px);
    }

    .btn-ghost {
      background: transparent;
      color: var(--text-2);
      border: 1px solid var(--border);
    }

    .btn-ghost:hover {
      background: var(--bg-3);
      color: var(--text);
      border-color: var(--border-hover);
    }

    .icon-btn {
      padding: 7px 10px;
    }
  `],
})
export class TopbarComponent {
  @Input() title = '';
  @Input() showAddButton = false;
  @Input() addLabel = 'Nouveau';
  @Input() showNotifications = false;
  @Output() addClick = new EventEmitter<void>();

  protected readonly PlusIcon = Plus;
  protected readonly BellIcon = Bell;
}
