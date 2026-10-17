import {
  ApplicationConfig,
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling, withPreloading } from '@angular/router';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { appRoutes } from './app.routes';
import { AUTH_TOKEN_SOURCE, jwtRefreshInterceptor } from '@mtc/front-auth';
import { ERROR_NOTIFIER, errorInterceptor } from '@mtc/front-ui';
import { AuthService } from './core/auth/auth.service';
import { AuthenticatedPreloading } from './core/auth/authenticated-preloading';
import { demoInterceptor } from './core/auth/demo.interceptor';
import { ToastService } from './core/services/toast.service';

// Locale française pour tous les DatePipe/DecimalPipe (dates en français)
registerLocaleData(localeFr, 'fr-FR');

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // Préchargement des pages en tâche de fond, pour un utilisateur connecté et une fois le
    // navigateur inactif (AuthenticatedPreloading) : navigation instantanée sans ralentir
    // l'arrivée d'un visiteur sur /register.
    // Défilement : effectif pour la fenêtre (pages publiques) ; le shell connecté défile dans
    // <main>, géré par ScrollMemoryDirective.
    provideRouter(
      appRoutes,
      withPreloading(AuthenticatedPreloading),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    // `errorInterceptor` en DERNIER : il ne doit voir que les erreurs que les intercepteurs
    // précédents n'ont pas rattrapées — un 401 suivi d'un refresh réussi n'est pas une panne.
    provideHttpClient(
      withFetch(),
      withInterceptors([jwtRefreshInterceptor, demoInterceptor, errorInterceptor]),
    ),
    // Source du JWT pour l'intercepteur partagé (@mtc/front-auth).
    { provide: AUTH_TOKEN_SOURCE, useExisting: AuthService },
    // Qui affiche les pannes que l'écran ne sait pas expliquer (500, 429, réseau coupé).
    { provide: ERROR_NOTIFIER, useExisting: ToastService },
    { provide: LOCALE_ID, useValue: 'fr-FR' },
  ],
};
