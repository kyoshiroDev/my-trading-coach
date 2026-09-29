import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { BehaviorSubject, Observable, catchError, filter, switchMap, take, throwError } from 'rxjs';

/** Ce que l'intercepteur attend du service d'authentification de l'app (app ou admin). */
export interface AuthTokenSource {
  getAccessToken(): string | null;
  /** Renouvelle l'access token via le cookie de refresh ; met à jour getAccessToken(). */
  refreshToken(): Observable<unknown>;
  logout(): void;
}

/** À fournir dans app.config : `{ provide: AUTH_TOKEN_SOURCE, useExisting: AuthService }`. */
export const AUTH_TOKEN_SOURCE = new InjectionToken<AuthTokenSource>('AUTH_TOKEN_SOURCE');

/** Renouvellement en cours : partagé par toutes les requêtes qui reçoivent un 401 en même temps. */
@Injectable({ providedIn: 'root' })
export class AuthRefreshState {
  isRefreshing = false;
  readonly token$ = new BehaviorSubject<string | null>(null);
}

/** Routes d'authentification : jamais de token ajouté, jamais de refresh sur leur 401. */
const AUTH_ROUTES = ['/auth/login', '/auth/register', '/auth/logout', '/auth/demo-login'];

/**
 * Ajoute le JWT à chaque requête et, sur un 401, renouvelle le token UNE fois (les requêtes
 * arrivées pendant le renouvellement l'attendent), puis rejoue la requête. Si le refresh échoue,
 * l'utilisateur est déconnecté.
 *
 * Un 401 sur une route d'authentification (mauvais mot de passe) est renvoyé tel quel : il ne
 * déclenche ni refresh ni déconnexion.
 */
export const jwtRefreshInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AUTH_TOKEN_SOURCE);
  const state = inject(AuthRefreshState);
  const isRefreshCall = req.url.includes('/auth/refresh');
  const isAuthCall = AUTH_ROUTES.some((route) => req.url.includes(route));

  const withToken = (token: string | null) =>
    token
      ? req.clone({ withCredentials: true, setHeaders: { Authorization: `Bearer ${token}` } })
      : req.clone({ withCredentials: true });

  const token = auth.getAccessToken();
  return next(isRefreshCall || isAuthCall ? withToken(null) : withToken(token)).pipe(
    catchError((err) => {
      if (err.status !== 401 || isRefreshCall || isAuthCall) return throwError(() => err);

      if (state.isRefreshing) {
        return state.token$.pipe(
          filter((t): t is string => t !== null),
          take(1),
          switchMap((newToken) => next(withToken(newToken))),
        );
      }

      state.isRefreshing = true;
      state.token$.next(null);
      return auth.refreshToken().pipe(
        switchMap(() => {
          state.isRefreshing = false;
          const newToken = auth.getAccessToken() ?? '';
          state.token$.next(newToken);
          return next(withToken(newToken));
        }),
        catchError((refreshErr) => {
          state.isRefreshing = false;
          state.token$.next(null);
          auth.logout();
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
