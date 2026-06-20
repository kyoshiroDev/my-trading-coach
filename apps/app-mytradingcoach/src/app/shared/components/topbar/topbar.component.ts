import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Plus, Bell } from 'lucide-angular';
import { AccountSelectorComponent } from '../account-selector/account-selector.component';
import { UserStore } from '../../../core/stores/user.store';

@Component({
  selector: 'mtc-topbar',
  standalone: true,
  imports: [LucideAngularModule, AccountSelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './topbar.component.css',
  host: { '[attr.title]': 'null' },
  template: `
    <header class="topbar">
      <div class="topbar-title-wrap">
        <h1 class="page-title">{{ title() }}</h1>
        @if (globalScopeNote() && userStore.isStarterOrAbove()) {
          <span class="topbar-scope">analyse tous comptes confondus</span>
        }
      </div>
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

    <!-- Sélecteur de compte global (multi-comptes Starter+) — source unique. -->
    @if (showAccountSelector() && userStore.isStarterOrAbove()) {
      <div class="topbar-accounts">
        <mtc-account-selector />
      </div>
    }

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
  /** Affiche le sélecteur de compte global (écrans scopés par compte, Starter+). */
  showAccountSelector = input(false);
  /** Libellé « analyse tous comptes confondus » (écrans IA globaux, Starter+). */
  globalScopeNote = input(false);
  addClick = output<void>();

  protected readonly userStore = inject(UserStore);
  protected readonly PlusIcon = Plus;
  protected readonly BellIcon = Bell;
}
