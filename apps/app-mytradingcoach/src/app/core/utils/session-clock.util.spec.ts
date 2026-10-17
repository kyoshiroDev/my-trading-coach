import { describe, it, expect } from 'vitest';
import { sessionClock } from './session-clock.util';

describe('sessionClock (#595)', () => {
  const start = '2026-10-17T08:00:00.000Z';

  it('HH:MM:SS sous 24 h', () => {
    expect(sessionClock(start, new Date('2026-10-17T09:02:05.000Z'))).toEqual({ kind: 'timer', label: '01:02:05' });
  });

  it('23:59:59 reste un compteur', () => {
    expect(sessionClock(start, new Date('2026-10-18T07:59:59.000Z'))).toEqual({ kind: 'timer', label: '23:59:59' });
  });

  it('> 24 h → alerte avec la date d’ouverture au lieu de 265:58:47', () => {
    expect(sessionClock('2026-10-06T18:40:26.000Z', new Date('2026-10-17T16:39:13.000Z'))).toEqual({ kind: 'stale', since: '06/10' });
  });

  it('horloge en retard sur startedAt → 00:00:00, jamais négatif', () => {
    expect(sessionClock(start, new Date('2026-10-17T07:59:58.000Z'))).toEqual({ kind: 'timer', label: '00:00:00' });
  });
});
