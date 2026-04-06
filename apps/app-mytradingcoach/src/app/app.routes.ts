import { Routes } from '@angular/router';
import { authGuard, premiumGuard } from './core/auth/auth.guard';

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
        canActivate: [premiumGuard],
        loadComponent: () =>
          import('./features/ai-insights/ai-insights.component').then((m) => m.AiInsightsComponent),
      },
      {
        path: 'debrief',
        canActivate: [premiumGuard],
        loadComponent: () =>
          import('./features/weekly-debrief/debrief.component').then((m) => m.DebriefComponent),
      },
      {
        path: 'scoring',
        loadComponent: () =>
          import('./features/scoring/scoring.component').then((m) => m.ScoringComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];