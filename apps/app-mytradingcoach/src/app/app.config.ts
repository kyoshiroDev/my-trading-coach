import {
  ApplicationConfig,
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { PreloadAllModules, provideRouter, withInMemoryScrolling, withPreloading } from '@angular/router';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { appRoutes } from './app.routes';
import { AUTH_TOKEN_SOURCE, jwtRefreshInterceptor } from '@mtc/front-auth';
import { AuthService } from './core/auth/auth.service';
import { demoInterceptor } from './core/auth/demo.interceptor';

// Locale française pour tous les DatePipe/DecimalPipe (dates en français)
registerLocaleData(localeFr, 'fr-FR');

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // Préchargement des pages en tâche de fond après le 1er affichage : navigation instantanée.
    // Défilement : effectif pour la fenêtre (pages publiques) ; le shell connecté défile dans
    // <main>, géré par ScrollMemoryDirective.
    provideRouter(
      appRoutes,
      withPreloading(PreloadAllModules),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([jwtRefreshInterceptor, demoInterceptor])),
    // Source du JWT pour l'intercepteur partagé (@mtc/front-auth).
    { provide: AUTH_TOKEN_SOURCE, useExisting: AuthService },
    { provide: LOCALE_ID, useValue: 'fr-FR' },
  ],
};
