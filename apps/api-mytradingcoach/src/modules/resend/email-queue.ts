import type { JobsOptions } from 'bullmq';

// File d'envoi des e-mails (SCA-B5-02). Le web l'alimente, le worker la vide à débit plafonné :
// un 429 ou une panne passagère de Resend devient un nouvel essai, plus un e-mail perdu.
export const EMAIL_QUEUE = 'email';

export interface EmailJob {
  to: string;
  subject: string;
  html: string;
}

// 5 essais, 2 s → 4 s → 8 s → 16 s entre eux (~30 s en tout, au-delà d'une fenêtre de 429).
export const EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 24 * 3600, count: 1000 }, // échecs gardés 7 j pour diagnostic, pas indéfiniment
};

// Resend : 10 requêtes/s par équipe, partagées par tous les environnements qui ont la même clé.
export const EMAIL_RATE_LIMIT = { max: 5, duration: 1000 };

// Erreurs passagères : un nouvel essai a des chances de passer. Les autres (adresse invalide,
// quota du jour ou du mois atteint, clé refusée) échoueraient pareil : pas de nouvel essai.
export const RETRYABLE_EMAIL_ERRORS = new Set(['rate_limit_exceeded', 'application_error', 'internal_server_error']);

/** Levée par un envoi depuis la file sur une erreur passagère : BullMQ refait l'essai plus tard. */
export class RetryableEmailError extends Error {
  constructor(readonly resendError: string, message: string) {
    super(`${resendError} : ${message}`);
    this.name = 'RetryableEmailError';
  }
}
