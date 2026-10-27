import { TrialSource } from '@prisma/client';
import { PREMIUM_SIGNUP_TRIAL_DAYS } from '@mtc/shared';
import { ANONYMIZE_AFTER_DAYS } from '../admin/deleted-account.service';

const DAY_MS = 86_400_000;

export interface SignupTrialData {
  trialUsed: true;
  trialEndsAt?: Date;
  signupTrialEndsAt?: Date;
  trialSource?: TrialSource;
}

/**
 * Essai Premium posé à la création du compte (#769). `trialUsed` passe toujours à vrai : qui a eu
 * l'essai d'inscription, ou s'est réinscrit après une suppression récente, n'a pas l'essai Stripe de
 * 30 jours en plus.
 */
export function signupTrialData(now: Date, recentlyDeleted: boolean): SignupTrialData {
  if (recentlyDeleted) return { trialUsed: true };
  const end = new Date(now.getTime() + PREMIUM_SIGNUP_TRIAL_DAYS * DAY_MS);
  return { trialUsed: true, trialEndsAt: end, signupTrialEndsAt: end, trialSource: TrialSource.SIGNUP };
}

/**
 * Borne basse de `DeletedAccount.deletedAt` pour refuser l'essai d'une réinscription : la durée de
 * conservation de l'e-mail, anonymisé ensuite (aucun hash gardé, décision du 26/10).
 */
export function redeleteCutoff(now: Date): Date {
  return new Date(now.getTime() - ANONYMIZE_AFTER_DAYS * DAY_MS);
}
