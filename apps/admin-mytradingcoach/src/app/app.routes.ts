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
      { path: 'users/:id',     loadComponent: () => import('./features/user-detail/user-detail.component').then(m => m.UserDetailComponent) },
      { path: 'subscriptions', loadComponent: () => import('./features/subscriptions/subscriptions.component').then(m => m.SubscriptionsComponent) },
      { path: 'deleted',       loadComponent: () => import('./features/deleted/deleted.component').then(m => m.DeletedComponent) },
      { path: 'surveillance',  loadComponent: () => import('./features/surveillance/surveillance.component').then(m => m.SurveillanceComponent) },
      { path: 'vps',           redirectTo: 'surveillance', pathMatch: 'full' },
      { path: 'containers',    redirectTo: 'surveillance', pathMatch: 'full' },
      { path: 'logs',          redirectTo: 'surveillance', pathMatch: 'full' },
      { path: 'backups',       loadComponent: () => import('./features/backups/backups.component').then(m => m.BackupsComponent) },
      { path: 'revenue',       loadComponent: () => import('./features/revenue/revenue.component').then(m => m.RevenueComponent) },
      { path: 'ai-usage',      loadComponent: () => import('./features/ai-usage/ai-usage.component').then(m => m.AiUsageComponent) },
      { path: 'emails',          loadComponent: () => import('./features/emails/emails.component').then(m => m.EmailsComponent) },
      { path: 'ambassadeurs',   loadComponent: () => import('./features/ambassadeurs/ambassadeurs.component').then(m => m.AmbassadeursComponent) },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
