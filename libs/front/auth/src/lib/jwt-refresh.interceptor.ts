import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, catchError, finalize, map, shareReplay, switchMap, take, tap, throwError } from 'rxjs';

/** Ce que l'intercepteur attend du service d'authentification de l'app (app ou admin). */
export interface AuthTokenSource {
  getAccessToken(): string | null;
  /** Renouvelle l'access token via le cookie de refresh ; met à jour getAccessToken(). */
  refreshToken(): Observable<unknown>;
  logout(): void;
}

/** À fournir dans app.config : `{ provide: AUTH_TOKEN_SOURCE, useExisting: AuthService }`. */
export const AUTH_TOKEN_SOURCE = new InjectionToken<AuthTokenSource>('AUTH_TOKEN_SOURCE');

/**
 * Renouvellement partagé (#1065, #1103) : toutes les requêtes qui reçoivent un 401 pendant qu'il est
 * en vol attendent le même, et il ne dépend d'aucune d'elles. Une requête annulée (écran quitté) se
 * désabonne seule : le refresh va au bout, le nouveau jeton est gardé, et le cookie de refresh n'est
 * jamais présenté deux fois. Un refus d'authentification déconnecte une seule fois, qu'il reste des
 * requêtes ou non ; une erreur passagère (5xx, 429, réseau) fait seulement échouer les requêtes en
 * attente, sans déconnecter (#1145) : le 401 suivant relancera un refresh.
 */
@Injectable({ providedIn: 'root' })
export class AuthRefreshState {
  private current: Observable<string> | null = null;

  /** Le refresh en cours, ou un nouveau s'il n'y en a pas ; émet le nouveau jeton. */
  refresh(auth: AuthTokenSource): Observable<string> {
    if (this.current) return this.current;
    const run: Observable<string> = auth.refreshToken().pipe(
      take(1),
      map(() => auth.getAccessToken() ?? ''),
      tap({ error: (err: unknown) => { if (isAuthRefusal(err)) auth.logout(); } }),
      // Terminé (succès ou échec) : le 401 suivant en relance un nouveau.
      finalize(() => {
        if (this.current === run) this.current = null;
      }),
      // `refCount: false` : le refresh continue même si toutes les requêtes se sont désabonnées.
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.current = run;
    return run;
  }
}

/**
 * Refus d'authentification du refresh : 401 (cookie absent, expiré, révoqué ou rejoué) ou 403 (refus
 * de rôle de l'admin). Le reste (5xx, 429, réseau = statut 0) est passager et ne déconnecte pas (#1145).
 */
const isAuthRefusal = (err: unknown): boolean => {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
};

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
 * arrivées pendant le renouvellement l'attendent), puis rejoue la requête. Si le refresh est refusé
 * (401, ou 403 du refus de rôle admin), l'utilisateur est déconnecté ; une erreur passagère (5xx,
 * 429, réseau) fait seulement échouer la requête (#1145).
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

      // Seule l'erreur du refresh déconnecte (dans `AuthRefreshState`) : une erreur de la requête
      // rejouée revient à son appelant sans toucher aux autres.
      return state.refresh(auth).pipe(switchMap((newToken) => next(withToken(newToken))));
    }),
  );
};
