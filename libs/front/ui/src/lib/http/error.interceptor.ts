import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { apiErrorMessage } from '@mtc/shared';
import { catchError, throwError } from 'rxjs';
import { ERROR_NOTIFIER } from './error-notifier';
import { SILENT_ERRORS } from './silent-errors';

/**
 * Notifie l'utilisateur des pannes qu'aucun écran ne sait expliquer : serveur en erreur, débit
 * limité, réseau injoignable.
 *
 * Pourquoi seulement celles-là. Un 4xx métier est déjà traité là où il se produit — un formulaire
 * invalide affiche ses erreurs de champ, un 404 affiche « introuvable » — et un toast par-dessus
 * ne dirait rien de plus. À l'inverse, un 500 ou un réseau coupé ne remonte nulle part : l'écran
 * reste figé et l'utilisateur ne sait pas si c'est lui, sa connexion, ou nous. C'est le « aucune
 * erreur API silencieuse » du cahier des charges.
 *
 * L'erreur est TOUJOURS relancée : notifier n'est pas traiter, et les appelants qui gèrent le cas
 * doivent continuer à le recevoir.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifier = inject(ERROR_NOTIFIER, { optional: true });
  return next(req).pipe(
    catchError((err: unknown) => {
      if (notifier && !req.context.get(SILENT_ERRORS)) {
        const message = notifiableMessage(err);
        if (message) notifier.error(message);
      }
      return throwError(() => err);
    }),
  );
};

/** Message à afficher, ou `null` si cette erreur ne relève pas de l'intercepteur. */
function notifiableMessage(err: unknown): string | null {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  if (typeof status !== 'number') return null;

  // 0 = la requête n'a jamais abouti (hors ligne, DNS, serveur éteint, CORS). Le back n'a envoyé
  // aucun message, donc on parle de la connexion et pas du serveur.
  if (status === 0) {
    return 'Connexion au serveur impossible. Vérifie ta connexion et réessaie.';
  }
  if (status === 429) {
    return apiErrorMessage(err, 'Trop de requêtes d’un coup. Patiente une minute et réessaie.');
  }
  if (status >= 500) {
    // `apiErrorMessage` remplace déjà le message d'un 500 par le repli : « Internal server error »
    // ne doit jamais atteindre l'utilisateur. Un 503 garde le sien, rédigé pour lui.
    return apiErrorMessage(err, 'Le serveur a rencontré un problème. Réessaie dans un instant.');
  }
  return null;
}
