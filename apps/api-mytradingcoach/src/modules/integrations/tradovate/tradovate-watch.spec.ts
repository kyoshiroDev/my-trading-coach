import { describe, it, expect } from 'vitest';
import { WATCH_MAX_MS, type WatchCandidate, watchEnd, watchVerdict } from './tradovate-watch';
import { resolveWatchMax } from '../../../config/tradovate-watch-config';

/** Veille serveur (#770) : fin de veille et éligibilité, sans Redis ni base. */

const candidate = (over: Partial<WatchCandidate> = {}): WatchCandidate => ({
  isDemo: false, plan: 'PREMIUM', role: 'USER', trialEndsAt: null,
  devices: 1, connections: 1, hasActiveSession: true, preference: null, ...over,
});

// 27/10/2026 : heure d'été à Chicago (UTC-5), la journée de trading CME bascule à 22:00 UTC.
const MATIN = new Date('2026-10-27T08:00:00Z'); // 09:00 Paris
const SOIR = new Date('2026-10-27T20:00:00Z'); // 21:00 Paris

describe('watchEnd', () => {
  it('séance du matin → 10 h plus tard', () => {
    expect(watchEnd(MATIN)).toBe(MATIN.getTime() + WATCH_MAX_MS);
  });

  it('séance du soir → coupée à la fin de la journée de trading (17:00 Chicago)', () => {
    expect(new Date(watchEnd(SOIR)).toISOString()).toBe('2026-10-27T22:00:00.000Z');
  });
});

describe('watchVerdict', () => {
  it('Premium, appareil, connexion et séance ouverte → veille', () => {
    expect(watchVerdict(candidate(), MATIN)).toBe('watch');
  });

  it('essai en cours ou bêta-testeur → veille (même accès que les alertes en direct)', () => {
    expect(watchVerdict(candidate({ plan: 'FREE', trialEndsAt: new Date(Date.now() + 86_400_000) }), MATIN)).toBe('watch');
    expect(watchVerdict(candidate({ plan: 'FREE', role: 'BETA_TESTER' }), MATIN)).toBe('watch');
  });

  it.each([
    ['user introuvable', undefined],
    ['compte démo', candidate({ isDemo: true })],
    ['palier Gratuit', candidate({ plan: 'FREE' })],
    ['aucun appareil abonné', candidate({ devices: 0 })],
    ['aucune connexion Tradovate suivable', candidate({ connections: 0 })],
    ['pas de séance ouverte', candidate({ hasActiveSession: false })],
    ['règles et comportement coupés', candidate({ preference: { mutedTypes: ['PROP_RULES', 'BEHAVIOR'], quietStart: null, quietEnd: null } })],
  ])('%s → fin de veille', (_label, c) => {
    expect(watchVerdict(c, MATIN)).toBe('stop');
  });

  it('un seul des deux types coupé → veille quand même', () => {
    expect(watchVerdict(candidate({ preference: { mutedTypes: ['BEHAVIOR', 'RECAP'], quietStart: null, quietEnd: null } }), MATIN)).toBe('watch');
  });

  it('heures silencieuses à cheval sur minuit → en pause dedans, veille dehors', () => {
    const preference = { mutedTypes: [], quietStart: 22 * 60, quietEnd: 7 * 60 };
    expect(watchVerdict(candidate({ preference }), new Date('2026-10-27T22:30:00Z'))).toBe('paused'); // 23:30 Paris
    expect(watchVerdict(candidate({ preference }), new Date('2026-10-28T04:00:00Z'))).toBe('paused'); // 05:00 Paris
    expect(watchVerdict(candidate({ preference }), MATIN)).toBe('watch');
  });

  it('fin de veille prioritaire sur la pause', () => {
    const preference = { mutedTypes: [], quietStart: 0, quietEnd: 23 * 60 };
    expect(watchVerdict(candidate({ preference, hasActiveSession: false }), MATIN)).toBe('stop');
  });
});

describe('resolveWatchMax (TRADOVATE_WATCH_MAX)', () => {
  it.each([
    [undefined, 0],
    ['', 0],
    ['abc', 0],
    ['-3', 0],
    ['0', 0],
    [' 500 ', 500],
  ])('%s → %s (absent ou invalide : veille éteinte)', (raw, expected) => {
    expect(resolveWatchMax({ TRADOVATE_WATCH_MAX: raw })).toBe(expected);
  });
});
