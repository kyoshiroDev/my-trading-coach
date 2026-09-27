/**
 * Message lisible d'une erreur d'API pour l'utilisateur : le message du back s'il en envoie un
 * (il est déjà rédigé pour l'utilisateur), sinon un repli clair — jamais `undefined`, jamais
 * « Internal server error » (toute erreur 5xx renvoie le repli). Gère `message: string | string[]` (ValidationPipe renvoie un tableau).
 *
 * PUR : lit seulement `err.error.message`, présent sur un `HttpErrorResponse` Angular comme sur
 * tout objet de même forme — utilisable par l'app ET l'admin sans importer Angular.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  // Erreur serveur (5xx) : le message du back est générique, le repli de l'écran dit mieux
  // ce qui a échoué (« Ton débrief n'a pas pu être chargé… »).
  const status = (err as { status?: unknown } | null | undefined)?.status;
  if (typeof status === 'number' && status >= 500) return fallback;

  const body = (err as { error?: unknown } | null | undefined)?.error;
  const msg = (body as { message?: unknown } | null | undefined)?.message;
  if (Array.isArray(msg)) {
    const parts = msg.filter((m): m is string => typeof m === 'string' && m.length > 0);
    return parts.length ? parts.join(' · ') : fallback;
  }
  return typeof msg === 'string' && msg.length > 0 ? msg : fallback;
}
