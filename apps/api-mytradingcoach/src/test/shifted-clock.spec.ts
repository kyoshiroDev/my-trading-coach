import { describe, expect, it } from 'vitest';

// Témoin de `tools/scripts/shifted-clock.mjs` : sous TEST_NOW, l'horloge des tests est bien décalée
// (sinon une vérification sous une autre date ne prouverait rien).
describe('horloge décalée (TEST_NOW)', () => {
  it.runIf(!!process.env['TEST_NOW'])('Date.now() part de TEST_NOW', () => {
    expect(Math.abs(Date.now() - Date.parse(process.env['TEST_NOW']!))).toBeLessThan(60 * 60_000);
  });
  it.runIf(!process.env['TEST_NOW'])('sans TEST_NOW, Date.now() est l’heure réelle', () => {
    expect(Math.abs(Date.now() - (performance.timeOrigin + performance.now()))).toBeLessThan(5_000);
  });
});
