import type { JobsOptions } from 'bullmq';

// File des récaps quotidiens (SCA-B5-01) : un job par utilisateur et par jour. Le cron ne fait
// qu'enfiler ; un redémarrage du worker en pleine passe ne prive plus les suivants de leur récap.
export const DAILY_RECAP_QUEUE = 'daily-recap';

export interface DailyRecapJob {
  userId: string;
  /** Instant de la passe du cron (ISO) : le récap porte sur ce jour-là, même traité plus tard. */
  at: string;
}

// Génération = un appel IA par récap : 3 en parallèle suffisent et ménagent le quota Anthropic.
export const DAILY_RECAP_CONCURRENCY = 3;

export const DAILY_RECAP_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  // Gardé 2 jours une fois fini : son jobId reste pris, un cron relancé le même jour n'enfile
  // pas un second récap (pas de doublon d'e-mail).
  removeOnComplete: { age: 2 * 24 * 3600 },
  removeOnFail: { age: 7 * 24 * 3600, count: 1000 }, // échecs gardés 7 j pour diagnostic, pas indéfiniment
};

/** `recap-<userId>-<AAAA-MM-JJ>` (jour de Paris) ; BullMQ refuse les `:` dans un id de job. */
export function dailyRecapJobId(userId: string, at: Date): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(at);
  return `recap-${userId}-${day}`;
}
