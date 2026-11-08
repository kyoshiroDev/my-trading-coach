import { TradovateObservationOutcome } from '@prisma/client';
import { TradovateApiError, TradovateException, TradovatePenaltyError } from './tradovate.errors';
import type { TradovateAccount } from './tradovate.types';

/**
 * Journal d'observation Tradovate (#684, phase 2) : fonctions pures. Le cron qui les utilise est
 * `tradovate-observation.cron.ts`.
 */

/** Durée de conservation des observations. */
export const OBSERVATION_RETENTION_DAYS = 90;

/** Jour calendaire de Paris, à minuit UTC (colonne `@db.Date`). */
export function observationDay(now: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

/** Ce que la liste dit du compte : présence et champs bruts, jamais le nom ni le solde. */
export function readListedAccount(list: unknown, externalAccountId: string | null): {
  listed: boolean;
  active: boolean | null;
  closed: boolean | null;
  restricted: boolean | null;
} {
  const accounts = Array.isArray(list) ? (list as TradovateAccount[]) : [];
  const account = accounts.find((a) => String(a?.id) === externalAccountId);
  if (!account) return { listed: false, active: null, closed: null, restricted: null };
  const flag = (v: unknown) => (typeof v === 'boolean' ? v : null);
  return { listed: true, active: flag(account.active), closed: flag(account.closed), restricted: flag(account.restricted) };
}

/** Échec de la lecture traduit en issue + code HTTP (null quand aucune réponse n'a été reçue). */
export function classifyFailure(err: unknown): { outcome: TradovateObservationOutcome; httpStatus: number | null } {
  if (err instanceof TradovatePenaltyError) return { outcome: 'PENALIZED', httpStatus: err.status || null };
  if (err instanceof TradovateApiError) {
    const outcome: Record<TradovateApiError['kind'], TradovateObservationOutcome> = {
      unauthorized: 'UNAUTHORIZED',
      forbidden: 'FORBIDDEN',
      rate_limited: 'RATE_LIMITED',
      not_found: 'NOT_FOUND',
      unavailable: 'UNAVAILABLE',
    };
    return { outcome: outcome[err.kind], httpStatus: err.status || null };
  }
  if (err instanceof TradovateException) {
    // Levées avant tout appel de la liste : jeton ou pause de pénalité en cours.
    switch (err.code) {
      case 'TRADOVATE_PENALIZED':
      case 'TRADOVATE_CAPTCHA_REQUIRED':
        return { outcome: 'PENALIZED', httpStatus: null };
      case 'TRADOVATE_RECONNECT_REQUIRED':
        return { outcome: 'TOKEN_REFUSED', httpStatus: null };
      case 'TRADOVATE_REFRESH_DEFERRED':
        return { outcome: 'TOKEN_DEFERRED', httpStatus: null };
      default:
        return { outcome: 'ERROR', httpStatus: null };
    }
  }
  return { outcome: 'ERROR', httpStatus: null };
}
