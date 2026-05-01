import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterModule, RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideAngularModule,
  LayoutDashboard,
  BookOpen,
  BarChart2,
  Sparkles,
  CalendarDays,
  Trophy,
  Settings,
  LogOut,
  ShieldCheck,
} from 'lucide-angular';
import { UserStore } from '../../../core/stores/user.store';
import { AuthService } from '../../../core/auth/auth.service';
import { OnboardingComponent } from '../../../features/onboarding/onboarding.component';

@Component({
  selector: 'mtc-sidebar',
  standalone: true,
  imports: [RouterModule, RouterLink, RouterLinkActive, LucideAngularModule, OnboardingComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sidebar.component.css',
  template: `
    @if (showOnboarding()) {
      <mtc-onboarding (completed)="onOnboardingCompleted()" />
    }

    <button class="burger" (click)="toggleSidebar()" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>

    <button class="sidebar-overlay"
            [class.open]="sidebarOpen()"
            (click)="closeSidebar()"
            aria-label="Fermer le menu"
            tabindex="-1">
    </button>

    <div class="app-layout">
      <!-- ─── SIDEBAR ─── -->
      <aside class="sidebar" [class.open]="sidebarOpen()">
        <!-- Logo -->
        <a routerLink="/dashboard" class="logo">
          <img src="icon/logo-horizontal.svg" alt="MyTradingCoach" height="40" style="display:block;max-width:100%">
        </a>

        <!-- Nav -->
        <nav class="nav">
          <div class="nav-section">OVERVIEW</div>

          <a routerLink="/dashboard" routerLinkActive="active" class="nav-item" data-testid="nav-dashboard" (click)="closeSidebar()">
            <span class="nav-icon"><lucide-icon [img]="LayoutDashboardIcon" [size]="14" /></span>
            Dashboard
          </a>

          <a routerLink="/journal" routerLinkActive="active" class="nav-item" data-testid="nav-journal" (click)="closeSidebar()">
            <span class="nav-icon"><lucide-icon [img]="BookOpenIcon" [size]="14" /></span>
            Journal
          </a>

          <a routerLink="/analytics" routerLinkActive="active" class="nav-item" data-testid="nav-analytics" (click)="closeSidebar()">
            <span class="nav-icon"><lucide-icon [img]="BarChart2Icon" [size]="14" /></span>
            Analytics
          </a>

          <div class="nav-section">PREMIUM</div>

          <a routerLink="/ai-insights" routerLinkActive="active" class="nav-item" data-testid="nav-ai-insights" (click)="closeSidebar()">
            <span class="nav-icon"><lucide-icon [img]="SparklesIcon" [size]="14" /></span>
            IA Insights
            <span class="badge">AI</span>
          </a>

          <a routerLink="/debrief" routerLinkActive="active" class="nav-item" data-testid="nav-debrief" (click)="closeSidebar()">
            <span class="nav-icon"><lucide-icon [img]="CalendarDaysIcon" [size]="14" /></span>
            Weekly Debrief
            <span class="badge">PRO</span>
          </a>

          <div class="nav-section">ACCOUNT</div>

          <a routerLink="/scoring" routerLinkActive="active" class="nav-item" data-testid="nav-scoring" (click)="closeSidebar()">
            <span class="nav-icon"><lucide-icon [img]="TrophyIcon" [size]="14" /></span>
            Scoring
          </a>

          <a routerLink="/settings" routerLinkActive="active" class="nav-item" data-testid="nav-settings" (click)="closeSidebar()">
            <span class="nav-icon"><lucide-icon [img]="SettingsIcon" [size]="14" /></span>
            Paramètres
          </a>

          @if (userStore.isAdmin()) {
            <div class="nav-section admin-section">ADMIN</div>
            <a routerLink="/admin" routerLinkActive="active" class="nav-item admin-item" (click)="closeSidebar()">
              <span class="nav-icon"><lucide-icon [img]="ShieldCheckIcon" [size]="14" /></span>
              Utilisateurs
            </a>
          }

          <button class="nav-item settings-item" data-testid="logout-btn" (click)="closeSidebar(); logout()">
            <span class="nav-icon"><lucide-icon [img]="LogOutIcon" [size]="14" /></span>
            Déconnexion
          </button>
        </nav>

        <!-- User card -->
        <div class="sidebar-footer">
          <div class="user-card">
            <div class="avatar">{{ userStore.initials() }}</div>
            <div class="user-info">
              <div class="user-name">{{ userStore.displayName() }}</div>
              <div class="user-plan">
                @if (userStore.isAdmin()) { ⚡ ADMIN }
                @else if (userStore.isPremium()) { ★ PREMIUM }
                @else { FREE }
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
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly sidebarOpen = signal(false);

  protected toggleSidebar(): void { this.sidebarOpen.update(v => !v); }
  protected closeSidebar(): void  { this.sidebarOpen.set(false); }

  protected readonly showOnboarding = computed(() => {
    const user = this.userStore.user();
    return !!user && user.onboardingCompleted === false;
  });

  protected readonly LayoutDashboardIcon = LayoutDashboard;
  protected readonly BookOpenIcon = BookOpen;
  protected readonly BarChart2Icon = BarChart2;
  protected readonly SparklesIcon = Sparkles;
  protected readonly CalendarDaysIcon = CalendarDays;
  protected readonly TrophyIcon = Trophy;
  protected readonly SettingsIcon = Settings;
  protected readonly LogOutIcon = LogOut;
  protected readonly ShieldCheckIcon = ShieldCheck;

  constructor() {
    const onFocus = () => {
      if (!this.auth.isAuthenticated()) return;
      this.auth.fetchMe().subscribe({ error: () => { /* silently ignore */ } });
    };
    window.addEventListener('focus', onFocus);
    this.destroyRef.onDestroy(() => window.removeEventListener('focus', onFocus));
  }

  onOnboardingCompleted() {
    const user = this.userStore.user();
    if (user) {
      this.auth.currentUser.set({ ...user, onboardingCompleted: true });
    }
  }

  logout() {
    this.auth.logout();
  }
}
