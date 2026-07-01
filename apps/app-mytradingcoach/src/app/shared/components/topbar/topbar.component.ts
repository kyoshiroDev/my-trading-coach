import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Plus, Bell, MessageCircle } from 'lucide-angular';
import { AccountSelectorComponent } from '../account-selector/account-selector.component';
import { PlanModalComponent } from '../plan-modal/plan-modal.component';
import { UserStore } from '../../../core/stores/user.store';
import { TradesStore } from '../../../core/stores/trades.store';

@Component({
  selector: 'mtc-topbar',
  standalone: true,
  imports: [LucideAngularModule, AccountSelectorComponent, PlanModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './topbar.component.css',
  host: { '[attr.title]': 'null' },
  template: `
    <header class="topbar">
      <div class="topbar-title-wrap">
        <h1 class="page-title">{{ title() }}</h1>
        @if (period()) {
          <span class="topbar-period">· {{ period() }}</span>
        }
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

        <!-- Quota mensuel (FREE) — déplacé depuis la sidebar (design chrome.jsx).
             Cliquable → modale des forfaits. -->
        @if (!userStore.isStarterOrAbove() && tradesStore.monthlyLoaded()) {
          <div class="tb-quota-wrap">
            <button
              class="tb-quota"
              [class.near]="tradesStore.nearLimit()"
              [class.reached]="tradesStore.limitReached()"
              (click)="showPlanModal.set(true)"
              title="Trades utilisés ce mois"
            >
              <div class="tb-quota-head">
                <span class="tb-quota-lab">Trades ce mois</span>
                <span class="tb-quota-count">{{ tradesStore.monthlyCount() }}<span class="tb-quota-sep">/{{ tradesStore.monthlyLimit() }}</span></span>
              </div>
              <div class="tb-quota-track">
                <div class="tb-quota-fill" [style.width.%]="tradesStore.monthlyPercent()"></div>
              </div>
            </button>
            @if (tradesStore.nearLimit() || tradesStore.limitReached()) {
              <button class="tb-quota-cta" (click)="showPlanModal.set(true)">Augmenter →</button>
            }
          </div>
        }

        <a
          href="https://discord.gg/TDK2npvkSN"
          target="_blank"
          rel="noopener"
          class="tb-discord"
          title="Rejoindre la communauté Discord"
        >
          <lucide-icon [img]="DiscordIcon" [size]="15" class="tb-discord-ic" />
          <span class="tb-discord-label">Discord</span>
        </a>

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

    @if (showPlanModal()) {
      <mtc-plan-modal (closed)="showPlanModal.set(false)" />
    }
  `,
})
export class TopbarComponent {
  title = input('');
  /** Période affichée à côté du titre (ex. « juin 2026 ») — design chrome.jsx. */
  period = input('');
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
  protected readonly tradesStore = inject(TradesStore);
  protected readonly showPlanModal = signal(false);
  protected readonly PlusIcon = Plus;
  protected readonly BellIcon = Bell;
  protected readonly DiscordIcon = MessageCircle;
}
