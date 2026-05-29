import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterModule, RouterLink, RouterLinkActive } from '@angular/router';
import { UserStore } from '../../../core/stores/user.store';
import { TradesStore } from '../../../core/stores/trades.store';
import { AuthService } from '../../../core/auth/auth.service';
import { AmbassadorNotifService } from '../../../core/services/ambassador-notif.service';
import { OnboardingComponent } from '../../../features/onboarding/onboarding.component';
import { PlanModalComponent } from '../plan-modal/plan-modal.component';

@Component({
  selector: 'mtc-sidebar',
  standalone: true,
  imports: [
    RouterModule,
    RouterLink,
    RouterLinkActive,
    OnboardingComponent,
    PlanModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sidebar.component.css',
  template: `
    @if (showOnboarding()) {
      <mtc-onboarding (completed)="onOnboardingCompleted()" />
    }

    <button class="burger" (click)="toggleSidebar()" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>

    <button
      class="sidebar-overlay"
      [class.open]="sidebarOpen()"
      (click)="closeSidebar()"
      aria-label="Fermer le menu"
      tabindex="-1"
    ></button>

    <div class="app-layout">
      <!-- ─── SIDEBAR ─── -->
      <aside class="sidebar" [class.open]="sidebarOpen()">
        <!-- Logo -->
        <a routerLink="/dashboard" class="logo">
          <img
            src="icon/logo-horizontal.svg"
            alt="MyTradingCoach"
            height="40"
            style="display:block;max-width:100%"
          />
        </a>

        <!-- Nav -->
        <nav class="nav">
          <div class="nav-section">OVERVIEW</div>

          <a
            routerLink="/dashboard"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-dashboard"
            (click)="closeSidebar()"
          >
            <span class="nav-icon">📊</span>
            Dashboard
          </a>

          <a
            routerLink="/journal"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-journal"
            (click)="closeSidebar()"
          >
            <span class="nav-icon">📖</span>
            Journal
          </a>

          <a
            routerLink="/sessions"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-sessions"
            (click)="closeSidebar()"
          >
            <span class="nav-icon">📋</span>
            Mes sessions
          </a>

          <a
            routerLink="/analytics"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-analytics"
            (click)="closeSidebar()"
          >
            <span class="nav-icon">📈</span>
            Analytics
          </a>

          <div class="nav-section">PREMIUM</div>

          <a
            routerLink="/ai-insights"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-ai-insights"
            (click)="closeSidebar()"
          >
            <span class="nav-icon">✨</span>
            IA Insights
            <span class="badge">AI</span>
          </a>

          <a
            routerLink="/debrief"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-debrief"
            (click)="closeSidebar()"
          >
            <span class="nav-icon">📅</span>
            Weekly Debrief
            <span class="badge">PRO</span>
          </a>

          <a
            routerLink="/eco-calendar"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-eco-calendar"
            (click)="closeSidebar()"
          >
            <span class="nav-icon">🗓️</span>
            Calendrier éco
            <span class="badge">PRO</span>
          </a>

          @if (userStore.isAmbassador()) {
            <a
              routerLink="/ambassador"
              routerLinkActive="active"
              class="nav-item"
              data-testid="nav-ambassador"
              (click)="closeSidebar()"
            >
              <span class="nav-icon">🤝</span>
              Ambassadeur
              @if (ambassadorNotif.newReferrals() > 0) {
                <span class="nav-badge-notif">{{ ambassadorNotif.newReferrals() }}</span>
              }
            </a>
          }

          <div class="nav-section">ACCOUNT</div>

          <a
            routerLink="/scoring"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-scoring"
            (click)="closeSidebar()"
          >
            <span class="nav-icon">🏆</span>
            Scoring
          </a>

          <a
            routerLink="/settings"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-settings"
            (click)="closeSidebar()"
          >
            <span class="nav-icon">⚙️</span>
            Paramètres
          </a>

          <button
            class="nav-item settings-item"
            data-testid="logout-btn"
            (click)="closeSidebar(); logout()"
          >
            <span class="nav-icon">🚪</span>
            Déconnexion
          </button>
        </nav>

        <!-- User card -->
        <div class="sidebar-footer">
          @if (!userStore.isPremium() && tradesStore.monthlyLoaded()) {
            <div class="monthly-counter"
              [class.near]="tradesStore.nearLimit()"
              [class.reached]="tradesStore.limitReached()">
              <div class="mc-header">
                <span class="mc-label">Trades ce mois</span>
                <span class="mc-count">{{ tradesStore.monthlyCount() }}<span class="mc-sep">/</span>{{ tradesStore.monthlyLimit() }}</span>
              </div>
              <div class="mc-track">
                <div class="mc-fill" [style.width.%]="tradesStore.monthlyPercent()"></div>
              </div>
              @if (tradesStore.limitReached()) {
                <button class="mc-upgrade reached" (click)="showPlanModal.set(true)" (keydown.enter)="showPlanModal.set(true)">
                  ⚡ Limite atteinte — Upgrade
                </button>
              } @else if (tradesStore.nearLimit()) {
                <button class="mc-upgrade near" (click)="showPlanModal.set(true)" (keydown.enter)="showPlanModal.set(true)">
                  Presque à la limite · Upgrade
                </button>
              }
            </div>
          }
          @if (showPlanModal()) {
            <mtc-plan-modal (closed)="showPlanModal.set(false)" />
          }
          <a href="https://discord.gg/TDK2npvkSN" target="_blank" rel="noopener"
            class="discord-sidebar-btn" title="Rejoindre la communauté Discord">
            <svg width="14" height="14" viewBox="0 0 127.14 96.36" fill="currentColor">
              <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z"/>
            </svg>
            <span>Communauté Discord</span>
            <span class="discord-sidebar-arrow">↗</span>
          </a>
          <div class="user-card">
            <div class="avatar">{{ userStore.initials() }}</div>
            <div class="user-info">
              <div class="user-name">{{ userStore.displayName() }}</div>
              <div class="user-plan"
                [class.premium]="userStore.isPremium()"
                [class.free]="!userStore.isPremium()">
                @if (userStore.isPremium()) {
                  ★ PREMIUM
                } @else {
                  FREE
                }
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- ─── MAIN ─── -->
      <main class="main-content">
        <router-outlet />
      </main>
    </div>
  `,
})
export class SidebarComponent {
  protected readonly userStore = inject(UserStore);
  protected readonly tradesStore = inject(TradesStore);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly ambassadorNotif = inject(AmbassadorNotifService);

  protected readonly sidebarOpen   = signal(false);
  protected readonly showPlanModal  = signal(false);

  protected toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }
  protected closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  // Signal local — une fois mis à true, le wizard ne peut plus revenir dans la session
  // même si fetchMe() renvoie onboardingCompleted: false (race condition réseau)
  private readonly onboardingDismissed = signal(false);

  protected readonly showOnboarding = computed(() => {
    if (this.onboardingDismissed()) return false;
    const user = this.userStore.user();
    return !!user && user.onboardingCompleted === false;
  });

  constructor() {
    this.tradesStore.loadMonthlyCount();

    const onFocus = () => {
      if (!this.auth.isAuthenticated()) return;
      this.auth.fetchMe().subscribe({
        error: () => {
          /* silently ignore */
        },
      });
    };
    window.addEventListener('focus', onFocus);
    this.destroyRef.onDestroy(() =>
      window.removeEventListener('focus', onFocus),
    );
  }

  onOnboardingCompleted() {
    this.onboardingDismissed.set(true);
    const user = this.userStore.user();
    if (user) {
      // setCurrentUser (et non currentUser.set) pour persister dans le localStorage
      this.auth.setCurrentUser({ ...user, onboardingCompleted: true });
    }
  }

  logout() {
    this.auth.logout();
  }
}
