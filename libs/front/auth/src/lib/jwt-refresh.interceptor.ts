import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, Subject, catchError, finalize, switchMap, take, throwError } from 'rxjs';

/** Ce que l'intercepteur attend du service d'authentification de l'app (app ou admin). */
export interface AuthTokenSource {
  getAccessToken(): string | null;
  /** Renouvelle l'access token via le cookie de refresh ; met à jour getAccessToken(). */
  refreshToken(): Observable<unknown>;
  logout(): void;
}

/** À fournir dans app.config : `{ provide: AUTH_TOKEN_SOURCE, useExisting: AuthService }`. */
export const AUTH_TOKEN_SOURCE = new InjectionToken<AuthTokenSource>('AUTH_TOKEN_SOURCE');

/** Issue d'un renouvellement : le nouveau jeton, ou l'erreur du refresh. */
export type RefreshOutcome = { ok: true; token: string } | { ok: false; error: unknown };

/**
 * Renouvellement en cours : partagé par toutes les requêtes qui reçoivent un 401 en même temps.
 * `outcome$` émet l'issue du refresh, succès COMME échec : une requête en attente ne reste jamais
 * en suspens (#1065).
 */
@Injectable({ providedIn: 'root' })
export class AuthRefreshState {
  isRefreshing = false;
  readonly outcome$ = new Subject<RefreshOutcome>();
}

/** Routes d'authentification : jamais de token ajouté, jamais de refresh sur leur 401. */
const AUTH_ROUTES = ['/auth/login', '/auth/register', '/auth/logout', '/auth/demo-login'];

/**
 * Connexion Google (#618) : seul le POST sur `/auth/google` exact est une route d'auth. Les routes
 * `/auth/google/finalize` et `DELETE /auth/google` sont faites connecté et gardent le jeton.
 */
const isGoogleSignIn = (method: string, url: string) =>
  method === 'POST' && url.split('?')[0].endsWith('/auth/google');

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
  const isAuthCall =
    AUTH_ROUTES.some((route) => req.url.includes(route)) || isGoogleSignIn(req.method, req.url);

  const withToken = (token: string | null) =>
    token
      ? req.clone({ withCredentials: true, setHeaders: { Authorization: `Bearer ${token}` } })
      : req.clone({ withCredentials: true });

  const token = auth.getAccessToken();
  return next(isRefreshCall || isAuthCall ? withToken(null) : withToken(token)).pipe(
    catchError((err) => {
      if (err.status !== 401 || isRefreshCall || isAuthCall) return throwError(() => err);

      if (state.isRefreshing) {
        return state.outcome$.pipe(
          take(1),
          switchMap((o) => (o.ok ? next(withToken(o.token)) : throwError(() => o.error))),
        );
      }

      state.isRefreshing = true;
      return auth.refreshToken().pipe(
        take(1),
        switchMap(() => {
          state.isRefreshing = false;
          const newToken = auth.getAccessToken() ?? '';
          state.outcome$.next({ ok: true, token: newToken });
          return next(withToken(newToken));
        }),
        catchError((refreshErr) => {
          // Une erreur de la requête REJOUÉE passe aussi ici : seul l'échec du refresh déconnecte.
          if (!state.isRefreshing) return throwError(() => refreshErr);
          state.isRefreshing = false;
          state.outcome$.next({ ok: false, error: refreshErr });
          auth.logout();
          return throwError(() => refreshErr);
        }),
        // Requête à l'origine du refresh annulée en route (écran quitté) : le refresh est coupé avec
        // elle. Sans ce filet, `isRefreshing` resterait vrai et tous les 401 suivants attendraient
        // pour toujours. Les requêtes en attente reçoivent l'erreur d'origine, sans déconnexion.
        finalize(() => {
          if (!state.isRefreshing) return;
          state.isRefreshing = false;
          state.outcome$.next({ ok: false, error: err });
        }),
      );
    }),
  );
};
