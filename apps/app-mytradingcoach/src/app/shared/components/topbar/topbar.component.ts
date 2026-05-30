import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Plus, Bell } from 'lucide-angular';

@Component({
  selector: 'mtc-topbar',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './topbar.component.css',
  host: { '[attr.title]': 'null' },
  template: `
    <header class="topbar">
      <h1 class="page-title">{{ title() }}</h1>
      <div class="topbar-actions">
        @if (showAddButton()) {
          <button
            class="btn btn-primary btn-add-desktop"
            [class.btn-loading]="addLoading()"
            [disabled]="addDisabled() || addLoading()"
            [attr.data-testid]="addTestId() || null"
            (click)="addClick.emit()"
          >
            @if (addLoading()) {
              <span class="btn-spinner"></span>
            } @else {
              <lucide-icon [img]="PlusIcon" [size]="14" />
            }
            {{ addLabel() }}
          </button>
        }
        @if (showNotifications()) {
          <button class="btn btn-ghost icon-btn" title="Notifications">
            <lucide-icon [img]="BellIcon" [size]="16" />
          </button>
        }
        <ng-content />
      </div>
    </header>

    @if (showAddButton()) {
      <button
        class="floating-add-btn"
        [class.btn-loading]="addLoading()"
        [disabled]="addDisabled() || addLoading()"
        [attr.data-testid]="addTestId() ? addTestId() + '-floating' : null"
        [attr.aria-label]="addLabel()"
        (click)="addClick.emit()"
      >
        @if (addLoading()) {
          <span class="btn-spinner"></span>
        } @else {
          <lucide-icon [img]="PlusIcon" [size]="24" />
        }
      </button>
    }
  `,
})
export class TopbarComponent {
  title = input('');
  showAddButton = input(false);
  addLabel = input('Nouveau');
  addDisabled = input(false);
  addLoading = input(false);
  addTestId = input('');
  showNotifications = input(false);
  addClick = output<void>();

  protected readonly PlusIcon = Plus;
  protected readonly BellIcon = Bell;
}
