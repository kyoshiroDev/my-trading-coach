import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { parrainageGuard, ambassadorPageGuard } from './core/auth/referral-gating.guard';
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
          'Connecte-toi à MyTradingCoach pour accéder à ton journal de trading intelligent.',
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
          "Crée ton compte MyTradingCoach gratuitement et commence à analyser tes trades avec l'IA.",
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
        data: { seo: { title: 'Session du jour', noindex: true } },
        loadComponent: () =>
          import('./features/session-day/session-day.component').then(
            (m) => m.SessionDayComponent,
          ),
      },
      {
        path: 'dashboard',
        data: { seo: { title: 'Tableau de bord', noindex: true } },
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
      },
      {
        path: 'accounts',
        // Pas de premiumGuard : upsell inline intentionnel (preview + UX conversion).
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
        data: { seo: { title: 'Historique des sessions', noindex: true } },
        loadComponent: () =>
          import('./features/sessions/sessions.component').then(
            (m) => m.SessionsComponent,
          ),
      },
      {
        path: 'analytics',
        data: { seo: { title: 'Statistiques', noindex: true } },
        loadComponent: () =>
          import('./features/analytics/analytics.component').then(
            (m) => m.AnalyticsComponent,
          ),
      },
      {
        path: 'ai-insights',
        // Pas de premiumGuard : paywall inline intentionnel (preview + UX conversion)
        data: { seo: { title: 'Insights IA', noindex: true } },
        loadComponent: () =>
          import('./features/ai-insights/ai-insights.component').then(
            (m) => m.AiInsightsComponent,
          ),
      },
      {
        path: 'debrief',
        // Pas de premiumGuard : paywall inline intentionnel (preview + UX conversion)
        data: { seo: { title: 'Débrief hebdo', noindex: true } },
        loadComponent: () =>
          import('./features/weekly-debrief/debrief.component').then(
            (m) => m.DebriefComponent,
          ),
      },
      {
        path: 'scoring',
        // Pas de premiumGuard : paywall inline intentionnel (preview + UX conversion)
        data: { seo: { title: 'Score trader', noindex: true } },
        loadComponent: () =>
          import('./features/scoring/scoring.component').then(
            (m) => m.ScoringComponent,
          ),
      },
      {
        path: 'eco-calendar',
        // Calendrier économique (affichage + analyse IA) = IA mutualisée → FREE.
        data: {
          seo: {
            title: 'Calendrier économique',
            description: 'Suis les événements économiques majeurs et épingle tes favoris.',
            noindex: true,
          },
        },
        loadComponent: () =>
          import('./features/eco-calendar/eco-calendar.component').then(
            (m) => m.EcoCalendarComponent,
          ),
      },
      {
        path: 'profil',
        data: { seo: { title: 'Profil', noindex: true } },
        loadComponent: () =>
          import('./features/settings/settings.component').then(
            (m) => m.SettingsComponent,
          ),
      },
      // Compat : anciens liens /settings (bookmarks, emails, retours Stripe ?checkout=…).
      // redirectTo préserve les query params et le fragment par défaut.
      { path: 'settings', redirectTo: 'profil', pathMatch: 'full' },
      {
        path: 'ambassador',
        canActivate: [authGuard, ambassadorPageGuard],
        data: { seo: { title: 'Ambassadeur', noindex: true } },
        loadComponent: () =>
          import('./features/ambassador/ambassador.component').then(
            (m) => m.AmbassadorComponent,
          ),
      },
      {
        path: 'parrainage',
        canActivate: [authGuard, parrainageGuard],
        data: { seo: { title: 'Parrainage', noindex: true } },
        loadComponent: () =>
          import('./features/referral/referral.component').then(
            (m) => m.ReferralComponent,
          ),
      },
      {
        path: 'devenir-ambassadeur',
        canActivate: [authGuard, parrainageGuard],
        data: { seo: { title: 'Devenir ambassadeur', noindex: true } },
        loadComponent: () =>
          import('./features/become-ambassador/become-ambassador.component').then(
            (m) => m.BecomeAmbassadorComponent,
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
