import { HttpException } from '@nestjs/common';

/**
 * Raison d'échec affichable (admin, e-mail, journal) : nos propres messages (refus métier), sinon le
 * seul code de l'erreur. Jamais le message brut d'une erreur Stripe ou Prisma (« No such customer:
 * 'cus_…' », requête recopiée), règle « ne jamais exposer ».
 */
export function safePrizeError(err: unknown): string {
  if (err instanceof HttpException) return err.message;
  const e = err as { type?: unknown; code?: unknown; name?: unknown };
  if (typeof e?.type === 'string' && e.type.startsWith('Stripe')) {
    return `Stripe : ${typeof e.code === 'string' ? e.code : e.type}`;
  }
  return `Erreur interne (${typeof e?.name === 'string' ? e.name : 'inconnue'})`;
}
