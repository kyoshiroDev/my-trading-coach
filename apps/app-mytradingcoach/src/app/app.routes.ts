import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { NotFoundComponent } from './shared/components/not-found/not-found.component';

export const appRoutes: Routes = [
  {
    path: 'demo',
    data: { seo: { title: 'Démo', noindex: true } },
    loadComponent: () =>
      import('./features/auth/demo-entry.component').then((m) => m.DemoEntryComponent),
  },
  {
    path: 'login',
    data: {
      seo: {
        title: 'Connexion',
        description:
          'Connectez-vous à MyTradingCoach pour accéder à votre journal de trading intelligent.',
        noindex: false,
      },
    },
    loadComponent: () =>
      import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    data: {
      seo: {
        title: 'Créer un compte',
        description:
          "Créez votre compte MyTradingCoach gratuitement et commencez à analyser vos trades avec l'IA.",
        noindex: false,
      },
    },
    loadComponent: () =>
      import('./features/auth/register.component').then(
        (m) => m.RegisterComponent,
      ),
  },
  {
    path: 'forgot-password',
    data: { seo: { title: 'Mot de passe oublié', noindex: true } },
    loadComponent: () =>
      import('./features/auth/forgot-password.component').then(
        (m) => m.ForgotPasswordComponent,
      ),
  },
  {
    path: 'reset-password',
    data: { seo: { title: 'Réinitialisation du mot de passe', noindex: true } },
    loadComponent: () =>
      import('./features/auth/reset-password.component').then(
        (m) => m.ResetPasswordComponent,
      ),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shared/components/sidebar/sidebar.component').then(
        (m) => m.SidebarComponent,
      ),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'session',
        data: { seo: { title: 'Ma session', noindex: true } },
        loadComponent: () =>
          import('./features/session-day/session-day.component').then(
            (m) => m.SessionDayComponent,
          ),
      },
      {
        path: 'dashboard',
        data: { seo: { title: 'Dashboard', noindex: true } },
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
      },
      {
        path: 'accounts',
        // Pas de premiumGuard — upsell inline intentionnel (preview + UX conversion).
        data: { seo: { title: 'Mes comptes', noindex: true } },
        loadComponent: () =>
          import('./features/accounts/accounts.component').then(
            (m) => m.AccountsComponent,
          ),
      },
      {
        path: 'journal',
        data: { seo: { title: 'Journal', noindex: true } },
        loadComponent: () =>
          import('./features/journal/journal.component').then(
            (m) => m.JournalComponent,
          ),
      },
      {
        path: 'sessions',
        data: { seo: { title: 'Mes sessions', noindex: true } },
        loadComponent: () =>
          import('./features/sessions/sessions.component').then(
            (m) => m.SessionsComponent,
          ),
      },
      {
        path: 'analytics',
        data: { seo: { title: 'Analytics', noindex: true } },
        loadComponent: () =>
          import('./features/analytics/analytics.component').then(
            (m) => m.AnalyticsComponent,
          ),
      },
      {
        path: 'ai-insights',
        // Pas de premiumGuard — paywall inline intentionnel (preview + UX conversion)
        data: { seo: { title: 'AI Insights', noindex: true } },
        loadComponent: () =>
          import('./features/ai-insights/ai-insights.component').then(
            (m) => m.AiInsightsComponent,
          ),
      },
      {
        path: 'debrief',
        // Pas de premiumGuard — paywall inline intentionnel (preview + UX conversion)
        data: { seo: { title: 'Weekly Debrief', noindex: true } },
        loadComponent: () =>
          import('./features/weekly-debrief/debrief.component').then(
            (m) => m.DebriefComponent,
          ),
      },
      {
        path: 'scoring',
        // Pas de premiumGuard — paywall inline intentionnel (preview + UX conversion)
        data: { seo: { title: 'Scoring', noindex: true } },
        loadComponent: () =>
          import('./features/scoring/scoring.component').then(
            (m) => m.ScoringComponent,
          ),
      },
      {
        path: 'eco-calendar',
        // Affichage du calendrier accessible à tous (FREE) — l'analyse IA reste premium côté API.
        data: {
          seo: {
            title: 'Calendrier économique',
            description: 'Suivez les événements économiques majeurs et épinglez vos favoris.',
            noindex: true,
          },
        },
        loadComponent: () =>
          import('./features/eco-calendar/eco-calendar.component').then(
            (m) => m.EcoCalendarComponent,
          ),
      },
      {
        path: 'settings',
        data: { seo: { title: 'Paramètres', noindex: true } },
        loadComponent: () =>
          import('./features/settings/settings.component').then(
            (m) => m.SettingsComponent,
          ),
      },
      {
        path: 'ambassador',
        canActivate: [authGuard],
        data: { seo: { title: 'Ambassadeur', noindex: true } },
        loadComponent: () =>
          import('./features/ambassador/ambassador.component').then(
            (m) => m.AmbassadorComponent,
          ),
      },
    ],
  },
  {
    path: '**',
    data: { seo: { title: 'Page introuvable', noindex: true } },
    component: NotFoundComponent,
  },
];
