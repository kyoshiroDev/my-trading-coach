import { describe, it, expect } from 'vitest';
import { activeTrial } from './trial.util';

const NOW = Date.parse('2026-10-29T21:00:00.000Z');
const FUTURE = '2026-11-12T21:00:00.000Z';
const PAST = '2026-10-01T00:00:00.000Z';

describe('activeTrial (#769)', () => {
  it.each([
    ['essai d’inscription', { plan: 'FREE', trialEndsAt: FUTURE, trialSource: 'SIGNUP' }, { until: FUTURE, origin: 'inscription' }],
    ['essai prolongé par l’admin', { plan: 'FREE', trialEndsAt: FUTURE, trialSource: 'ADMIN' }, { until: FUTURE, origin: 'admin' }],
    ['Premium offert (ancien, sans origine)', { plan: 'FREE', trialEndsAt: FUTURE, trialSource: null }, { until: FUTURE, origin: 'admin' }],
    ['gratuit', { plan: 'FREE', trialEndsAt: null, trialSource: null }, null],
    ['essai expiré', { plan: 'FREE', trialEndsAt: PAST, trialSource: 'SIGNUP' }, null],
    ['fin exactement maintenant', { plan: 'FREE', trialEndsAt: new Date(NOW).toISOString(), trialSource: 'SIGNUP' }, null],
    ['Premium Stripe (essai Stripe compris)', { plan: 'PREMIUM', trialEndsAt: FUTURE, trialSource: null }, null],
  ] as const)('%s', (_l, user, expected) => {
    expect(activeTrial(user, NOW)).toEqual(expected);
  });
});
