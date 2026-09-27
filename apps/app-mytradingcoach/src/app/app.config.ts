import {
  ApplicationConfig,
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
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
    provideRouter(appRoutes),
    provideHttpClient(withFetch(), withInterceptors([jwtRefreshInterceptor, demoInterceptor])),
    // Source du JWT pour l'intercepteur partagé (@mtc/front-auth).
    { provide: AUTH_TOKEN_SOURCE, useExisting: AuthService },
    { provide: LOCALE_ID, useValue: 'fr-FR' },
  ],
};
