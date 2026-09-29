import { describe, expect, it } from 'vitest';
import { isoWeek, presetRange } from './journal.grouping';

describe('journal.grouping', () => {
  it('une semaine ISO va du lundi au dimanche', () => {
    expect(isoWeek('2026-07-12')).toEqual({
      key: 'week-2026-07-06',
      label: 'Semaine du 06/07/2026 au 12/07/2026',
    });
    expect(isoWeek('2026-07-13').key).toBe('week-2026-07-13');
  });

  it('période personnalisée : fin incluse jusqu’à 23:59:59, sans début pas de borne', () => {
    const now = new Date(2026, 6, 15, 10);
    expect(presetRange('custom', '', '2026-07-10', now)).toEqual({});
    const r = presetRange('custom', '2026-07-01', '2026-07-10', now);
    expect(r.dateTo).toBe(new Date('2026-07-10T23:59:59').toISOString());
    expect(presetRange('all', '', '', now)).toEqual({});
  });

  it('le mois courant démarre le 1er', () => {
    const now = new Date(2026, 6, 15, 10);
    expect(presetRange('month', '', '', now).dateFrom).toBe(new Date(2026, 6, 1).toISOString());
  });
});
