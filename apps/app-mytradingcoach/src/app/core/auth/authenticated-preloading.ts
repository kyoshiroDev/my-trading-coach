import { Injectable, inject } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';

/** Repli de `requestIdleCallback` (absent de Safari) : délai après le premier affichage. */
const IDLE_FALLBACK_MS = 1500;

/** Émet une fois quand le navigateur est inactif (ou après `IDLE_FALLBACK_MS`). */
export function whenIdle(win: Window = window): Observable<void> {
  return new Observable<void>((sub) => {
    const done = () => {
      sub.next();
      sub.complete();
    };
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(done, { timeout: 5000 });
      return () => win.cancelIdleCallback(id);
    }
    const timer = win.setTimeout(done, IDLE_FALLBACK_MS);
    return () => win.clearTimeout(timer);
  });
}

/**
 * Préchargement des pages (remplace `PreloadAllModules`) : seulement pour un utilisateur
 * connecté, et une fois le navigateur inactif. Un visiteur anonyme sur /register ou /login ne
 * télécharge pas les pages du tableau de bord (≈ 270 Kio en concurrence avec les polices et le
 * formulaire). Le routeur rappelle la stratégie à chaque fin de navigation : après la connexion,
 * la première navigation précharge le reste.
 */
@Injectable({ providedIn: 'root' })
export class AuthenticatedPreloading implements PreloadingStrategy {
  private readonly auth = inject(AuthService);

  preload(_route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (!this.auth.isAuthenticated()) return of(null);
    return whenIdle().pipe(switchMap(() => load()));
  }
}
