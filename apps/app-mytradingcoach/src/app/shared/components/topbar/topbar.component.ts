import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule, Plus, Bell } from 'lucide-angular';

@Component({
  selector: 'mtc-topbar',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './topbar.component.css',
  template: `
    <header class="topbar">
      <h1 class="page-title">{{ title() }}</h1>
      <div class="topbar-actions">
        @if (showAddButton()) {
          <button class="btn btn-primary" (click)="addClick.emit()">
            <lucide-icon [img]="PlusIcon" [size]="14" />
            {{ addLabel() }}
          </button>
        }
        @if (showNotifications()) {
          <button class="btn btn-ghost icon-btn" title="Notifications">
            <lucide-icon [img]="BellIcon" [size]="16" />
          </button>
        }
      </div>
    </header>
  `,
})
export class TopbarComponent {
  title = input('');
  showAddButton = input(false);
  addLabel = input('Nouveau');
  showNotifications = input(false);
  addClick = output<void>();

  protected readonly PlusIcon = Plus;
  protected readonly BellIcon = Bell;
}