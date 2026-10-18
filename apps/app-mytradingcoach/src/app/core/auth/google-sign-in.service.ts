import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, map } from 'rxjs';
import { AuthService, type GoogleAuthStatus } from './auth.service';
import { PostSignupService } from './post-signup.service';
import { storedAcquisition, storedReferralCode } from './signup-context';
import { ToastService } from '../services/toast.service';

/** Message affiché sous le bouton Google pour une erreur de `POST /auth/google`. */
export function googleAuthErrorMessage(err: unknown): string {
  const status = err instanceof HttpErrorResponse ? err.status : undefined;
  const code = err instanceof HttpErrorResponse ? (err.error as { code?: string } | null)?.code : undefined;
  if (status === 0) return 'Connexion impossible : vérifie ton réseau et réessaie';
  if (code === 'GOOGLE_EMAIL_NOT_VERIFIED')
    return "Ton adresse Google n'est pas vérifiée : vérifie-la chez Google, ou inscris-toi avec ton email";
  if (status === 401) return 'La connexion Google a expiré, réessaie';
  if (status === 403) return "La connexion Google n'est pas disponible pour ce compte";
  if (status === 409) return 'Ce compte est déjà relié à un autre compte Google';
  if (status === 404) return 'La connexion Google est momentanément indisponible';
  if (status === 429) return 'Trop de tentatives, attends une minute avant de réessayer';
  return 'Une erreur est survenue, réessaie dans un instant';
}

/** Route de l'écran de finalisation d'une inscription Google. */
export const GOOGLE_FINALIZE_PATH = '/inscription/finaliser';

/**
 * Suite d'une connexion Google, commune à /login et /register : compte créé → écran de
 * finalisation (opt-in marketing) ; compte e-mail relié → message au 1er passage ; sinon même
 * navigation qu'une connexion classique.
 */
@Injectable({ providedIn: 'root' })
export class GoogleSignInService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly postSignup = inject(PostSignupService);
  private readonly toast = inject(ToastService);

  signIn(credential: string, opts: { premium: boolean }): Observable<GoogleAuthStatus> {
    return this.auth.googleAuth(credential, storedReferralCode(), storedAcquisition()).pipe(
      map(({ data }) => {
        if (data.user.needsSignupFinalization) {
          void this.router.navigate([GOOGLE_FINALIZE_PATH], {
            queryParams: opts.premium ? { plan: 'premium' } : {},
          });
        } else {
          if (data.googleStatus === 'linked') {
            this.toast.success(
              data.passwordCleared
                ? 'Ton compte Google est maintenant relié. Pour sécuriser ton compte, ton ancien mot de passe a été retiré : tu peux en définir un depuis ton profil.'
                : 'Ton compte Google est maintenant relié',
              { duration: 8000 },
            );
          }
          this.postSignup.afterLogin();
        }
        return data.googleStatus;
      }),
    );
  }
}
