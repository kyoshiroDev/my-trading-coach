import { Routes } from '@angular/router';
import { authGuard, adminGuard } from './core/auth/auth.guard';
import { NotFoundComponent } from './shared/components/not-found/not-found.component';

export const appRoutes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./features/auth/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./features/auth/forgot-password.component').then((m) => m.ForgotPasswordComponent),
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password.component').then((m) => m.ResetPasswordComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shared/components/sidebar/sidebar.component').then((m) => m.SidebarComponent),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'journal',
        loadComponent: () =>
          import('./features/journal/journal.component').then((m) => m.JournalComponent),
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./features/analytics/analytics.component').then((m) => m.AnalyticsComponent),
      },
      {
        path: 'ai-insights',
        loadComponent: () =>
          import('./features/ai-insights/ai-insights.component').then((m) => m.AiInsightsComponent),
      },
      {
        path: 'debrief',
        loadComponent: () =>
          import('./features/weekly-debrief/debrief.component').then((m) => m.DebriefComponent),
      },
      {
        path: 'scoring',
        loadComponent: () =>
          import('./features/scoring/scoring.component').then((m) => m.ScoringComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/admin/admin-users.component').then((m) => m.AdminUsersComponent),
      },
    ],
  },
  { path: '**', component: NotFoundComponent },
];