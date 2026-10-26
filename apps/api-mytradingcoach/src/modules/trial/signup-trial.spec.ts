import { describe, it, expect } from 'vitest';
import { PREMIUM_SIGNUP_TRIAL_DAYS } from '@mtc/shared';
import { redeleteCutoff, signupTrialData } from './signup-trial';
import { PROFILE } from '../admin/demo-data/reports';

const DAY = 86_400_000;
const NOW = new Date('2026-11-02T10:00:00.000Z');

describe('signupTrialData (#769)', () => {
  it('14 jours de Premium, origine SIGNUP, fin figée identique, trialUsed', () => {
    expect(PREMIUM_SIGNUP_TRIAL_DAYS).toBe(14);
    const end = new Date(NOW.getTime() + 14 * DAY);
    expect(signupTrialData(NOW, false)).toEqual({
      trialUsed: true, trialEndsAt: end, signupTrialEndsAt: end, trialSource: 'SIGNUP',
    });
  });

  it('compte supprimé récemment : pas d’essai, mais trialUsed (pas de 30 j Stripe non plus)', () => {
    expect(signupTrialData(NOW, true)).toEqual({ trialUsed: true });
  });

  it('fenêtre de réinscription = durée de conservation de l’e-mail (90 j)', () => {
    expect(redeleteCutoff(NOW)).toEqual(new Date(NOW.getTime() - 90 * DAY));
  });
});

describe('compte démo (#769)', () => {
  it('le profil du seed démo ne pose aucun essai', () => {
    for (const key of ['trialEndsAt', 'trialSource', 'signupTrialEndsAt']) {
      expect(PROFILE).not.toHaveProperty(key);
    }
  });
});
