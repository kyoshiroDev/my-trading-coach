import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { UserStore } from '../stores/user.store';

/** Une relecture du compte au plus par fenêtre : un écran envoie souvent plusieurs requêtes Premium. */
const PREMIUM_REFRESH_WINDOW_MS = 10_000;

@Injectable({ providedIn: 'root' })
class PremiumRefreshGate {
  private last = 0;
  /** Vrai si une relecture peut partir maintenant (et la note). */
  take(): boolean {
    const now = Date.now();
    if (now - this.last < PREMIUM_REFRESH_WINDOW_MS) return false;
    this.last = now;
    return true;
  }
}

/**
 * 403 `PREMIUM_REQUIRED` (PremiumGuard) : l'app croyait le compte Premium (cache : essai fini,
 * abonnement terminé depuis le dernier /auth/me). Relit le compte, et les écrans gatés repassent au
 * cadenas au lieu d'une erreur générique (B17 #1013). L'erreur est toujours relancée à l'appelant.
 */
export const premiumInterceptor: HttpInterceptorFn = (req, next) => {
  const userStore = inject(UserStore);
  const gate = inject(PremiumRefreshGate);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (
        err instanceof HttpErrorResponse &&
        err.status === 403 &&
        (err.error as { code?: unknown } | null)?.code === 'PREMIUM_REQUIRED' &&
        gate.take()
      ) {
        userStore.refreshUser();
      }
      return throwError(() => err);
    }),
  );
};
