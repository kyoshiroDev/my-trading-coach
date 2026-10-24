import { describe, it, expect } from 'vitest';
import { inQuietHours, minutesOfDay } from './quiet-hours';

/** Heures silencieuses : heure de Paris, plage à cheval sur minuit, heure d'été et d'hiver. */

const H = (h: number, m = 0) => h * 60 + m;

describe('minutesOfDay', () => {
  it('heure de Paris, été (UTC+2) et hiver (UTC+1)', () => {
    expect(minutesOfDay(new Date('2026-07-01T20:30:00Z'))).toBe(H(22, 30));
    expect(minutesOfDay(new Date('2026-12-01T20:30:00Z'))).toBe(H(21, 30));
  });

  it('autre fuseau si on le donne', () => {
    expect(minutesOfDay(new Date('2026-07-01T20:30:00Z'), 'America/New_York')).toBe(H(16, 30));
  });
});

describe('inQuietHours', () => {
  it('plage à cheval sur minuit (22:00 à 07:00)', () => {
    const q = (iso: string) => inQuietHours(new Date(iso), H(22), H(7));
    expect(q('2026-07-01T19:59:00Z')).toBe(false); // 21:59 Paris
    expect(q('2026-07-01T20:00:00Z')).toBe(true); // 22:00
    expect(q('2026-07-01T23:30:00Z')).toBe(true); // 01:30
    expect(q('2026-07-02T04:59:00Z')).toBe(true); // 06:59
    expect(q('2026-07-02T05:00:00Z')).toBe(false); // 07:00, fin exclue
  });

  it('plage dans la journée (12:00 à 14:00)', () => {
    expect(inQuietHours(new Date('2026-12-01T11:30:00Z'), H(12), H(14))).toBe(true); // 12:30 hiver
    expect(inQuietHours(new Date('2026-12-01T13:00:00Z'), H(12), H(14))).toBe(false); // 14:00
  });

  it('pas de plage : null, ou début égal à la fin', () => {
    const now = new Date('2026-07-01T20:30:00Z');
    expect(inQuietHours(now, null, null)).toBe(false);
    expect(inQuietHours(now, H(22), null)).toBe(false);
    expect(inQuietHours(now, H(22), H(22))).toBe(false);
  });
});
