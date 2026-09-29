import { describe, it, expect } from 'vitest';
import { parisDayRange, toParisDateStr } from './paris-date';

describe('parisDayRange — bornes d\'une journée calendaire Paris', () => {
  it('couvre exactement 24 h en heure d\'été (UTC+2)', () => {
    const { start, end } = parisDayRange('2026-08-07');

    // Minuit à Paris le 07/08 = 22h00 UTC le 06/08.
    expect(start.toISOString()).toBe('2026-08-06T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-07T22:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
  });

  it('couvre exactement 24 h en heure d\'hiver (UTC+1)', () => {
    const { start, end } = parisDayRange('2026-01-15');

    expect(start.toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-15T23:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
  });

  it('gère le passage à l\'heure d\'été : la journée ne fait que 23 h', () => {
    // Nuit du 28 au 29 mars 2026 : 02h00 → 03h00, le 29 mars ne dure que 23 h.
    const { start, end } = parisDayRange('2026-03-29');
    expect(end.getTime() - start.getTime()).toBe(23 * 3_600_000);
  });

  it('gère le retour à l\'heure d\'hiver : la journée dure 25 h', () => {
    // Nuit du 24 au 25 octobre 2026 : 03h00 → 02h00, le 25 octobre dure 25 h.
    const { start, end } = parisDayRange('2026-10-25');
    expect(end.getTime() - start.getTime()).toBe(25 * 3_600_000);
  });

  it('une inscription à 20h51 le 07/08 tombe bien dans la journée du 07/08', () => {
    // Le cas réel qui a révélé le bug de semaine.
    const signup = new Date('2026-08-07T18:51:00.000Z'); // 20h51 Paris
    const { start, end } = parisDayRange('2026-08-07');

    expect(signup >= start && signup < end).toBe(true);
    expect(toParisDateStr(signup)).toBe('2026-08-07');

    // Et surtout : elle ne tombe PAS dans la journée du 08/08.
    const next = parisDayRange('2026-08-08');
    expect(signup >= next.start && signup < next.end).toBe(false);
  });

  it('les journées consécutives s\'enchaînent sans trou ni recouvrement', () => {
    const a = parisDayRange('2026-08-07');
    const b = parisDayRange('2026-08-08');
    expect(a.end.getTime()).toBe(b.start.getTime());
  });
});
