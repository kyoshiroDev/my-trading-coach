import { HttpErrorResponse } from '@angular/common/http';

/**
 * Message lisible d'une erreur d'API pour un toast : le message du back s'il en envoie un
 * (il est déjà rédigé pour l'utilisateur), sinon un repli clair — jamais `undefined`, jamais
 * « Internal server error » (règle angular.md). Gère `message: string | string[]`
 * (ValidationPipe renvoie un tableau).
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const body = err instanceof HttpErrorResponse ? err.error : (err as { error?: unknown } | null)?.error;
  const msg = (body as { message?: unknown } | null | undefined)?.message;
  if (Array.isArray(msg)) {
    const parts = msg.filter((m): m is string => typeof m === 'string' && m.length > 0);
    return parts.length ? parts.join(' · ') : fallback;
  }
  return typeof msg === 'string' && msg.length > 0 ? msg : fallback;
}
