import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideAngularModule,
  LayoutDashboard, Users, CreditCard, Activity, Database,
  TrendingUp, Brain, Mail, LogOut, Handshake, Menu, UserX,
} from 'lucide-angular';
import { AdminAuthService } from '../../core/auth/admin-auth.service';

@Component({
  selector: 'mtc-admin-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shell.component.css',
  template: `
    <div class="app" [class.nav-open]="navOpen()">
      <div class="nav-overlay" role="button" tabindex="-1" (click)="navOpen.set(false)" (keydown.escape)="navOpen.set(false)"></div>
      <aside class="sidebar">
        <div class="sidebar-logo">
          <div class="logo-mark">M</div>
          <div class="logo-info">
            <div class="logo-name">MTC Admin</div>
            <div class="logo-sub">prod</div>
          </div>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Overview</div>
          <a class="nav-item" routerLink="/dashboard" routerLinkActive="active" (click)="navOpen.set(false)">
            <lucide-icon [img]="DashboardIcon" [size]="14" /> Dashboard
          </a>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Utilisateurs</div>
          <a class="nav-item" routerLink="/users" routerLinkActive="active" (click)="navOpen.set(false)">
            <lucide-icon [img]="UsersIcon" [size]="14" /> Utilisateurs
          </a>
          <a class="nav-item" routerLink="/subscriptions" routerLinkActive="active" (click)="navOpen.set(false)">
            <lucide-icon [img]="CreditCardIcon" [size]="14" /> Abonnements
          </a>
          <a class="nav-item" routerLink="/deleted" routerLinkActive="active" (click)="navOpen.set(false)">
            <lucide-icon [img]="UserXIcon" [size]="14" /> Comptes supprimés
          </a>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Infrastructure</div>
          <a class="nav-item" routerLink="/surveillance" routerLinkActive="active" (click)="navOpen.set(false)">
            <lucide-icon [img]="ActivityIcon" [size]="14" /> Surveillance
          </a>
          <a class="nav-item" routerLink="/backups" routerLinkActive="active" (click)="navOpen.set(false)">
            <lucide-icon [img]="DatabaseIcon" [size]="14" /> Sauvegardes
          </a>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Business</div>
          <a class="nav-item" routerLink="/revenue" routerLinkActive="active" (click)="navOpen.set(false)">
            <lucide-icon [img]="TrendingUpIcon" [size]="14" /> Revenus
          </a>
          <a class="nav-item" routerLink="/ai-usage" routerLinkActive="active" (click)="navOpen.set(false)">
            <lucide-icon [img]="BrainIcon" [size]="14" /> Usage IA
          </a>
          <a class="nav-item" routerLink="/emails" routerLinkActive="active" (click)="navOpen.set(false)">
            <lucide-icon [img]="MailIcon" [size]="14" /> Emails
          </a>
          <a class="nav-item" routerLink="/ambassadeurs" routerLinkActive="active" (click)="navOpen.set(false)">
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
          <div class="topbar-title">MTC Admin</div>
          <div class="topbar-right">
            <span class="status-dot">api.mytradingcoach.app</span>
            <span class="tb-meta">VPS OVH · Paris</span>
          </div>
          <button class="hamburger" (click)="navOpen.update(v => !v)" aria-label="Ouvrir le menu">
            <lucide-icon [img]="MenuIcon" [size]="18" />
          </button>
        </div>
        <div class="content">
          <router-outlet />
        </div>
      </div>
    </div>
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AdminAuthService);
  protected readonly navOpen = signal(false);

  protected readonly MenuIcon = Menu;
  protected readonly UserXIcon = UserX;
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
