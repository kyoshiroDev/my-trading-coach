import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideAngularModule,
  LayoutDashboard, Users, CreditCard, Activity, Database,
  TrendingUp, Brain, Mail, LogOut, Handshake,
} from 'lucide-angular';
import { AdminAuthService } from '../../core/auth/admin-auth.service';

@Component({
  selector: 'mtc-admin-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shell.component.css',
  template: `
    <div class="app">
      <div class="sidebar-overlay" role="button" tabindex="-1" [class.open]="sidebarOpen()" (click)="sidebarOpen.set(false)" (keydown.escape)="sidebarOpen.set(false)"></div>
      <aside class="sidebar" [class.open]="sidebarOpen()">
        <div class="sidebar-logo">
          <div class="logo-mark">M</div>
          <div class="logo-info">
            <div class="logo-name">MTC Admin</div>
            <div class="logo-sub">prod</div>
          </div>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Overview</div>
          <a class="nav-item" routerLink="/dashboard" routerLinkActive="active" (click)="sidebarOpen.set(false)">
            <lucide-icon [img]="DashboardIcon" [size]="14" /> Dashboard
          </a>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Utilisateurs</div>
          <a class="nav-item" routerLink="/users" routerLinkActive="active" (click)="sidebarOpen.set(false)">
            <lucide-icon [img]="UsersIcon" [size]="14" /> Utilisateurs
          </a>
          <a class="nav-item" routerLink="/subscriptions" routerLinkActive="active" (click)="sidebarOpen.set(false)">
            <lucide-icon [img]="CreditCardIcon" [size]="14" /> Abonnements
          </a>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Infrastructure</div>
          <a class="nav-item" routerLink="/surveillance" routerLinkActive="active" (click)="sidebarOpen.set(false)">
            <lucide-icon [img]="ActivityIcon" [size]="14" /> Surveillance
          </a>
          <a class="nav-item" routerLink="/backups" routerLinkActive="active" (click)="sidebarOpen.set(false)">
            <lucide-icon [img]="DatabaseIcon" [size]="14" /> Sauvegardes
          </a>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Business</div>
          <a class="nav-item" routerLink="/revenue" routerLinkActive="active" (click)="sidebarOpen.set(false)">
            <lucide-icon [img]="TrendingUpIcon" [size]="14" /> Revenus
          </a>
          <a class="nav-item" routerLink="/ai-usage" routerLinkActive="active" (click)="sidebarOpen.set(false)">
            <lucide-icon [img]="BrainIcon" [size]="14" /> Usage IA
          </a>
          <a class="nav-item" routerLink="/emails" routerLinkActive="active" (click)="sidebarOpen.set(false)">
            <lucide-icon [img]="MailIcon" [size]="14" /> Emails
          </a>
          <a class="nav-item" routerLink="/ambassadeurs" routerLinkActive="active" (click)="sidebarOpen.set(false)">
            <lucide-icon [img]="HandshakeIcon" [size]="14" /> Ambassadeurs
          </a>
        </div>

        <div class="sidebar-footer">
          <div class="admin-avatar">
            <div class="avatar-dot">{{ auth.currentUser()?.name?.[0]?.toUpperCase() ?? 'A' }}</div>
            <div class="avatar-info">
              <div class="avatar-name">{{ auth.currentUser()?.name ?? auth.currentUser()?.email }}</div>
              <div class="avatar-role">super admin</div>
            </div>
            <button class="logout-btn" (click)="auth.logout()" title="Déconnexion">
              <lucide-icon [img]="LogOutIcon" [size]="12" />
            </button>
          </div>
        </div>
      </aside>

      <div class="main">
        <div class="topbar">
          <button class="burger-btn" (click)="sidebarOpen.update(v => !v)" aria-label="Menu">
            <span></span><span></span><span></span>
          </button>
          <div class="topbar-title">MTC Admin</div>
          <span class="status-dot">api.mytradingcoach.app</span>
          <div class="topbar-meta">VPS OVH · Paris</div>
        </div>
        <div class="content-wrapper">
          <router-outlet />
        </div>
      </div>
    </div>
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AdminAuthService);
  protected readonly sidebarOpen = signal(false);

  protected readonly DashboardIcon = LayoutDashboard;
  protected readonly UsersIcon = Users;
  protected readonly CreditCardIcon = CreditCard;
  protected readonly ActivityIcon = Activity;
  protected readonly DatabaseIcon = Database;
  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly BrainIcon = Brain;
  protected readonly MailIcon      = Mail;
  protected readonly LogOutIcon    = LogOut;
  protected readonly HandshakeIcon = Handshake;
}
