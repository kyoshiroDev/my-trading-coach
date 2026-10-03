import { describe, it, expect } from 'vitest';
import { appRole, runsCrons, runsQueueProcessors } from './app-role';

describe('appRole', () => {
  it('absent ou vide → all (comportement historique)', () => {
    expect(appRole({})).toBe('all');
    expect(appRole({ APP_ROLE: '  ' })).toBe('all');
  });

  it('lit web / worker / all', () => {
    expect(appRole({ APP_ROLE: 'web' })).toBe('web');
    expect(appRole({ APP_ROLE: 'worker' })).toBe('worker');
    expect(appRole({ APP_ROLE: 'all' })).toBe('all');
  });

  it('valeur inconnue → erreur, jamais de rôle deviné', () => {
    expect(() => appRole({ APP_ROLE: 'Web' })).toThrow(/APP_ROLE invalide/);
    expect(() => appRole({ APP_ROLE: 'cron' })).toThrow(/APP_ROLE invalide/);
  });
});

describe('runsCrons', () => {
  it('seulement sur le worker cron, et jamais en rôle web', () => {
    expect(runsCrons({ IS_CRON_WORKER: 'true' })).toBe(true);
    expect(runsCrons({ APP_ROLE: 'worker', IS_CRON_WORKER: 'true' })).toBe(true);
    expect(runsCrons({ APP_ROLE: 'web', IS_CRON_WORKER: 'true' })).toBe(false);
    expect(runsCrons({ APP_ROLE: 'worker' })).toBe(false);
    expect(runsCrons({ IS_CRON_WORKER: 'false' })).toBe(false);
  });
});

describe('runsQueueProcessors', () => {
  it('partout sauf en rôle web', () => {
    expect(runsQueueProcessors({})).toBe(true);
    expect(runsQueueProcessors({ APP_ROLE: 'worker' })).toBe(true);
    expect(runsQueueProcessors({ APP_ROLE: 'web' })).toBe(false);
  });
});
