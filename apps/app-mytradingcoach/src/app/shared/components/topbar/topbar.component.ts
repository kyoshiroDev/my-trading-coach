import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import {
  LucideDynamicIcon,
  LucidePlus as Plus,
  LucideBell as Bell,
  LucideMessageCircle as MessageCircle,
} from '@lucide/angular';
import { AccountSelectorComponent } from '../account-selector/account-selector.component';

@Component({
  selector: 'mtc-topbar',
  imports: [LucideDynamicIcon, AccountSelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './topbar.component.css',
  host: { '[attr.title]': 'null' },
  template: `
    <header class="topbar" [class.hero]="heroHeader()">
      <div class="topbar-title-wrap">
        <h1 class="page-title">{{ title() }}</h1>
        @if (period()) {
          <span class="topbar-period">{{ heroHeader() ? '' : '· ' }}{{ period() }}</span>
        }
        @if (globalScopeNote()) {
          <span class="topbar-scope">analyse tous comptes confondus</span>
        }
      </div>

      @if (heroHeader()) {
        <div class="topbar-center">
          <ng-content select="[topbar-center]" />
        </div>
      }

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
              <svg [lucideIcon]="PlusIcon" [size]="14"></svg>
            }
            {{ addLabel() }}
          </button>
        }

        @if (!heroHeader()) {
          <a
            href="https://discord.gg/TDK2npvkSN"
            target="_blank"
            rel="noopener"
            class="tb-discord"
            title="Rejoindre la communauté Discord"
          >
            <svg [lucideIcon]="DiscordIcon" [size]="15" class="tb-discord-ic"></svg>
            <span class="tb-discord-label">Discord</span>
          </a>
        }

        @if (showNotifications()) {
          <button class="btn btn-ghost icon-btn" title="Notifications">
            <svg [lucideIcon]="BellIcon" [size]="16"></svg>
          </button>
        }
        <ng-content />
      </div>
    </header>

    <!-- Sélecteur de compte global (multi-comptes, accessible à tous) : source unique. -->
    @if (showAccountSelector()) {
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
          <svg [lucideIcon]="PlusIcon" [size]="24"></svg>
        }
      </button>
    }
  `,
})
export class TopbarComponent {
  title = input('');
  /** Période affichée à côté du titre (ex. « juin 2026 ») : design chrome.jsx. */
  period = input('');
  heroHeader = input(false);
  showAddButton = input(false);
  addLabel = input('Nouveau');
  addDisabled = input(false);
  addLoading = input(false);
  addTestId = input('');
  showNotifications = input(false);
  /** Affiche le sélecteur de compte global (écrans scopés par compte). */
  showAccountSelector = input(false);
  /** Libellé « analyse tous comptes confondus » (écrans agrégés). */
  globalScopeNote = input(false);
  addClick = output<void>();

  protected readonly PlusIcon = Plus;
  protected readonly BellIcon = Bell;
  protected readonly DiscordIcon = MessageCircle;
}
