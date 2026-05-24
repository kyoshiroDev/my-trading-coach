import { Routes } from '@angular/router';
import { adminGuard } from './core/auth/admin.guard';

export const appRoutes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: '',
    loadComponent: () => import('./layout/shell/shell.component').then(m => m.ShellComponent),
    canActivate: [adminGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard',     loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent) },
      { path: 'users',         loadComponent: () => import('./features/users/users.component').then(m => m.UsersComponent) },
      { path: 'subscriptions', loadComponent: () => import('./features/subscriptions/subscriptions.component').then(m => m.SubscriptionsComponent) },
      { path: 'vps',           loadComponent: () => import('./features/vps/vps.component').then(m => m.VpsComponent) },
      { path: 'containers',    loadComponent: () => import('./features/containers/containers.component').then(m => m.ContainersComponent) },
      { path: 'backups',       loadComponent: () => import('./features/backups/backups.component').then(m => m.BackupsComponent) },
      { path: 'logs',          loadComponent: () => import('./features/logs/logs.component').then(m => m.LogsComponent) },
      { path: 'revenue',       loadComponent: () => import('./features/revenue/revenue.component').then(m => m.RevenueComponent) },
      { path: 'ai-usage',      loadComponent: () => import('./features/ai-usage/ai-usage.component').then(m => m.AiUsageComponent) },
      { path: 'emails',        loadComponent: () => import('./features/emails/emails.component').then(m => m.EmailsComponent) },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
