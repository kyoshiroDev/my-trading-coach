import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { appRoutes } from './app.routes';
import { AUTH_TOKEN_SOURCE, jwtRefreshInterceptor } from '@mtc/front-auth';
import { AdminAuthService } from './core/auth/admin-auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(appRoutes),
    provideHttpClient(withFetch(), withInterceptors([jwtRefreshInterceptor])),
    // Source du JWT pour l'intercepteur partagé (@mtc/front-auth).
    { provide: AUTH_TOKEN_SOURCE, useExisting: AdminAuthService },
  ],
};
