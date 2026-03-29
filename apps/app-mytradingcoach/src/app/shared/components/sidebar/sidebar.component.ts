import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule, RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideAngularModule,
  LayoutDashboard,
  BookOpen,
  BarChart2,
  Sparkles,
  CalendarDays,
  Trophy,
  LogOut,
} from 'lucide-angular';
import { UserStore } from '../../../core/stores/user.store';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'mtc-sidebar',
  standalone: true,
  imports: [RouterModule, RouterLink, RouterLinkActive, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app-layout">
      <!-- ─── SIDEBAR ─── -->
      <aside class="sidebar">
        <!-- Logo -->
        <a routerLink="/dashboard" class="logo">
          <img src="logo-horizontal.svg" alt="MyTradingCoach" height="40" style="display:block;max-width:100%">
        </a>

        <!-- Nav -->
        <nav class="nav">
          <div class="nav-section">TRADING</div>

          <a routerLink="/dashboard" routerLinkActive="active" class="nav-item">
            <span class="nav-icon"><lucide-icon [img]="LayoutDashboardIcon" [size]="14" /></span>
            Dashboard
          </a>

          <a routerLink="/journal" routerLinkActive="active" class="nav-item">
            <span class="nav-icon"><lucide-icon [img]="BookOpenIcon" [size]="14" /></span>
            Journal
          </a>

          <a routerLink="/analytics" routerLinkActive="active" class="nav-item">
            <span class="nav-icon"><lucide-icon [img]="BarChart2Icon" [size]="14" /></span>
            Analytics
          </a>

          <div class="nav-section">PREMIUM</div>

          <a routerLink="/ai-insights" routerLinkActive="active" class="nav-item">
            <span class="nav-icon"><lucide-icon [img]="SparklesIcon" [size]="14" /></span>
            IA Insights
            <span class="badge">AI</span>
          </a>

          <a routerLink="/debrief" routerLinkActive="active" class="nav-item">
            <span class="nav-icon"><lucide-icon [img]="CalendarDaysIcon" [size]="14" /></span>
            Weekly Debrief
            <span class="badge">PRO</span>
          </a>

          <div class="nav-section">ACCOUNT</div>

          <a routerLink="/scoring" routerLinkActive="active" class="nav-item">
            <span class="nav-icon"><lucide-icon [img]="TrophyIcon" [size]="14" /></span>
            Scoring
          </a>

          <div class="nav-item settings-item" (click)="logout()">
            <span class="nav-icon"><lucide-icon [img]="LogOutIcon" [size]="14" /></span>
            Déconnexion
          </div>
        </nav>

        <!-- User card -->
        <div class="sidebar-footer">
          <div class="user-card">
            <div class="avatar">{{ userStore.initials() }}</div>
            <div class="user-info">
              <div class="user-name">{{ userStore.displayName() }}</div>
              <div class="user-plan">
                @if (userStore.isPremium()) { ★ PREMIUM } @else { FREE }
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
  styles: [`
    .app-layout {
      display: flex;
      height: 100vh;
      background: var(--bg);
      overflow: hidden;
    }

    /* ─── SIDEBAR ─── */
    .sidebar {
      width: 240px;
      min-width: 240px;
      background: var(--bg-2);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      position: relative;
      z-index: 10;
      overflow-y: auto;
    }

    .sidebar::after {
      content: '';
      position: absolute;
      top: 0; right: 0;
      width: 1px; height: 100%;
      background: linear-gradient(180deg, transparent, var(--blue) 40%, var(--blue) 60%, transparent);
      opacity: 0.12;
      pointer-events: none;
    }

    /* ─── LOGO ─── */
    .logo {
      display: block;
      padding: 20px 16px 16px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      text-decoration: none;
    }

    .logo img {
      height: 40px;
      width: auto;
    }

    /* ─── NAV ─── */
    .nav {
      flex: 1;
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .nav-section {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 1.1px;
      color: #4a6080;
      text-transform: uppercase;
      padding: 12px 8px 6px;
      margin-top: 4px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13.5px;
      font-weight: 400;
      color: #4a6080;
      transition: all 0.15s;
      position: relative;
      text-decoration: none;
    }

    .nav-item:hover {
      background: var(--blue-glow);
      color: var(--text-2);
    }

    .nav-item.active {
      background: rgba(59, 130, 246, 0.12);
      color: var(--blue-bright);
      font-weight: 500;
    }

    .nav-item.active::before {
      content: '';
      position: absolute;
      left: 0; top: 50%;
      transform: translateY(-50%);
      width: 3px; height: 20px;
      background: #3b82f6;
      border-radius: 0 3px 3px 0;
    }

    .nav-icon {
      width: 16px;
      text-align: center;
      font-size: 14px;
      opacity: 0.8;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .badge {
      margin-left: auto;
      background: linear-gradient(135deg, var(--blue), #8b5cf6);
      color: white;
      font-size: 9px;
      font-family: var(--font-mono);
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 10px;
      letter-spacing: 0.5px;
    }

    .settings-item {
      margin-top: auto;
    }

    /* ─── FOOTER ─── */
    .sidebar-footer {
      padding: 16px 12px;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }

    .user-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .user-card:hover { background: var(--bg-3); }

    .avatar {
      width: 32px; height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px;
      font-weight: 700;
      font-family: var(--font-display);
      color: white;
      flex-shrink: 0;
    }

    .user-info { flex: 1; min-width: 0; }

    .user-name {
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text);
    }

    .user-plan {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--yellow);
      letter-spacing: 0.5px;
    }

    /* ─── MAIN ─── */
    .main-content {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
  `],
})
export class SidebarComponent {
  protected readonly userStore = inject(UserStore);
  private readonly auth = inject(AuthService);

  protected readonly LayoutDashboardIcon = LayoutDashboard;
  protected readonly BookOpenIcon = BookOpen;
  protected readonly BarChart2Icon = BarChart2;
  protected readonly SparklesIcon = Sparkles;
  protected readonly CalendarDaysIcon = CalendarDays;
  protected readonly TrophyIcon = Trophy;
  protected readonly LogOutIcon = LogOut;

  logout() {
    this.auth.logout();
  }
}
