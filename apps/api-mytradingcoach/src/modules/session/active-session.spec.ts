import { describe, it, expect } from 'vitest';
import { activeSessionWhere, previousTradingDayStart, tradingDayStart } from './active-session';

describe('tradingDayStart (#595)', () => {
  it('heure d’été US : la journée commence à 17:00 Chicago la veille (22:00 UTC)', () => {
    // 2026-10-17 16:39 UTC = 11:39 Chicago → journée du 17, ouverte le 16 à 17:00 CDT
    expect(tradingDayStart(new Date('2026-10-17T16:39:00Z')).toISOString()).toBe('2026-10-16T22:00:00.000Z');
  });

  it('heure d’hiver US : 17:00 Chicago = 23:00 UTC', () => {
    expect(tradingDayStart(new Date('2026-12-10T15:00:00Z')).toISOString()).toBe('2026-12-09T23:00:00.000Z');
  });

  it('après 17:00 Chicago, la journée suivante a commencé', () => {
    // 2026-10-17 22:30 UTC = 17:30 CDT → journée du 18
    expect(tradingDayStart(new Date('2026-10-17T22:30:00Z')).toISOString()).toBe('2026-10-17T22:00:00.000Z');
  });

  it('semaine où seule l’Europe a changé d’heure : toujours 17:00 Chicago', () => {
    // 2026-10-28 : Paris en UTC+1, Chicago encore en CDT (UTC-5)
    expect(tradingDayStart(new Date('2026-10-28T12:00:00Z')).toISOString()).toBe('2026-10-27T22:00:00.000Z');
  });

  it('journée précédente : 24 h avant hors changement d’heure', () => {
    expect(previousTradingDayStart(new Date('2026-10-17T16:39:00Z')).toISOString()).toBe('2026-10-15T22:00:00.000Z');
  });
});

describe('activeSessionWhere (#595)', () => {
  it('ACTIVE ET ouverte pendant la journée de trading en cours', () => {
    expect(activeSessionWhere('u1', new Date('2026-10-17T16:39:00Z'))).toEqual({
      userId: 'u1',
      status: 'ACTIVE',
      startedAt: { gte: new Date('2026-10-16T22:00:00.000Z') },
    });
  });

  it('la session ouverte le 06/10 n’est plus active le 17/10', () => {
    const where = activeSessionWhere('u1', new Date('2026-10-17T16:39:00Z'));
    const gte = (where.startedAt as { gte: Date }).gte;
    expect(new Date('2026-10-06T18:40:26Z') >= gte).toBe(false);
  });
});
