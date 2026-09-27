import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { PreloadAllModules, provideRouter, withInMemoryScrolling, withPreloading } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { appRoutes } from './app.routes';
import { AUTH_TOKEN_SOURCE, jwtRefreshInterceptor } from '@mtc/front-auth';
import { AdminAuthService } from './core/auth/admin-auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // Préchargement des pages en tâche de fond après le 1er affichage : navigation instantanée.
    // Retour arrière = même position de défilement ; nouvelle page = haut de page.
    provideRouter(
      appRoutes,
      withPreloading(PreloadAllModules),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([jwtRefreshInterceptor])),
    // Source du JWT pour l'intercepteur partagé (@mtc/front-auth).
    { provide: AUTH_TOKEN_SOURCE, useExisting: AdminAuthService },
  ],
};
