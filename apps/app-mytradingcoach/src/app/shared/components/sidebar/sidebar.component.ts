import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule, RouterLink, RouterLinkActive } from '@angular/router';
import { UserStore } from '../../../core/stores/user.store';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'mtc-sidebar',
  standalone: true,
  imports: [RouterModule, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app-layout">
      <aside class="sidebar">
        <div class="sidebar-header">
          <div>
            <span class="logo">MyTradingCoach</span>
            <span class="logo-sub">Journal de trading intelligent</span>
          </div>
          @if (userStore.isPremium()) {
            <span class="premium-badge">✦ PREMIUM</span>
          }
        </div>
        <nav class="sidebar-nav">
          <a routerLink="/dashboard" routerLinkActive="active" class="nav-item">
            📊 Dashboard
          </a>
          <a routerLink="/journal" routerLinkActive="active" class="nav-item">
            📓 Journal
          </a>
          @if (userStore.isPremium()) {
            <a routerLink="/analytics" routerLinkActive="active" class="nav-item">
              📈 Analytics
            </a>
            <a routerLink="/ai-insights" routerLinkActive="active" class="nav-item">
              🤖 IA Insights
            </a>
            <a routerLink="/debrief" routerLinkActive="active" class="nav-item">
              📋 Debrief
            </a>
          }
          <a routerLink="/scoring" routerLinkActive="active" class="nav-item">
            🏆 Score
          </a>
        </nav>
        <div class="sidebar-footer">
          <div class="user-info">
            <span class="user-label">Connecté en tant que</span>
            <span class="user-name">{{ userStore.displayName() }}</span>
          </div>
          <button class="logout-btn" (click)="logout()">Déconnexion</button>
        </div>
      </aside>
      <main class="main-content">
        <router-outlet />
      </main>
    </div>
  `,
  styles: [`
    .app-layout { display: flex; min-height: 100vh; background: var(--bg-primary); }
    .sidebar {
      width: 240px; min-height: 100vh;
      background: linear-gradient(180deg, #080d18 0%, #05080f 100%);
      border-right: 1px solid rgba(56,139,255,0.1);
      display: flex; flex-direction: column; padding: 1.5rem 1rem;
      position: relative;
    }
    .sidebar::after {
      content: ''; position: absolute; top: 0; right: 0; width: 1px; height: 100%;
      background: linear-gradient(180deg, rgba(56,139,255,0.3) 0%, rgba(56,139,255,0.05) 50%, transparent 100%);
    }
    .sidebar-header { display: flex; flex-direction: column; gap: 0.625rem; margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid rgba(56,139,255,0.08); }
    .logo {
      font-size: 1rem; font-weight: 800;
      background: linear-gradient(135deg, #3b82f6, #22d3ee);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .logo-sub { font-size: 0.7rem; color: var(--text3); font-weight: 400; -webkit-text-fill-color: var(--text3); }
    .premium-badge {
      font-size: 0.65rem; background: linear-gradient(135deg, #3b82f6, #9333ea);
      color: white; padding: 2px 10px; border-radius: 9999px; width: fit-content;
      box-shadow: 0 2px 12px rgba(59,130,246,0.3); font-weight: 700; letter-spacing: 0.04em;
    }
    .sidebar-nav { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; }
    .nav-item {
      padding: 0.625rem 0.875rem; border-radius: 0.5rem; color: var(--text2);
      font-size: 0.875rem; transition: all 0.15s; text-decoration: none;
      display: flex; align-items: center; gap: 0.5rem;
    }
    .nav-item:hover { background: rgba(56,139,255,0.08); color: var(--text); }
    .nav-item.active {
      background: rgba(59,130,246,0.12);
      color: #60a5fa;
      border: 1px solid rgba(59,130,246,0.2);
    }
    .sidebar-footer { display: flex; flex-direction: column; gap: 0.5rem; margin-top: auto; padding-top: 1rem; border-top: 1px solid rgba(56,139,255,0.08); }
    .user-info { display: flex; flex-direction: column; gap: 0.125rem; }
    .user-label { font-size: 0.68rem; color: var(--text3); text-transform: uppercase; letter-spacing: 0.05em; }
    .user-name { font-size: 0.8rem; color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .logout-btn {
      background: none; border: 1px solid rgba(56,139,255,0.12); color: var(--text2);
      border-radius: 0.5rem; padding: 0.4rem 0.75rem; font-size: 0.8rem; cursor: pointer;
      transition: all 0.15s;
    }
    .logout-btn:hover { border-color: var(--color-loss); color: var(--color-loss); background: rgba(244,63,94,0.05); }
    .main-content { flex: 1; overflow: auto; }
  `],
})
export class SidebarComponent {
  protected readonly userStore = inject(UserStore);
  private readonly auth = inject(AuthService);

  logout() {
    this.auth.logout();
  }
}