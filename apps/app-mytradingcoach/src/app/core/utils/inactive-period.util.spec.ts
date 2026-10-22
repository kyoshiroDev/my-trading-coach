import { describe, expect, it } from 'vitest';
import { NO_AUTO_PERIOD, periodChosenByUser, periodOnSelection, type AutoPeriodState } from './inactive-period.util';

type P = '1M' | 'ALL';
const failed = { id: 'f', status: 'FAILED' };
const archived = { id: 'x', status: 'ARCHIVED' };
const active = { id: 'a', status: 'ACTIVE' };

describe('periodOnSelection (période par défaut d\'un compte échoué ou archivé)', () => {
  it('compte échoué ou archivé choisi → « Tout », en gardant la période d\'avant', () => {
    const r = periodOnSelection<P>(NO_AUTO_PERIOD, failed, '1M', 'ALL');
    expect(r).toEqual({ period: 'ALL', state: { auto: { accountId: 'f', previous: '1M' } } });
    expect(periodOnSelection<P>(NO_AUTO_PERIOD, archived, '1M', 'ALL').period).toBe('ALL');
  });

  it('retour sur un compte actif ou « Tous les comptes » → la période d\'avant revient', () => {
    const state: AutoPeriodState<P> = { auto: { accountId: 'f', previous: '1M' } };
    expect(periodOnSelection<P>(state, active, 'ALL', 'ALL')).toEqual({ period: '1M', state: { auto: null } });
    expect(periodOnSelection<P>(state, null, 'ALL', 'ALL').period).toBe('1M');
  });

  it('d\'un compte perdu à un autre : la période d\'origine reste celle à rendre', () => {
    const state: AutoPeriodState<P> = { auto: { accountId: 'f', previous: '1M' } };
    expect(periodOnSelection<P>(state, archived, 'ALL', 'ALL').state).toEqual({ auto: { accountId: 'x', previous: '1M' } });
  });

  it('choix de l\'utilisateur respecté : plus de retour automatique', () => {
    let state: AutoPeriodState<P> = periodOnSelection<P>(NO_AUTO_PERIOD, failed, '1M', 'ALL').state;
    state = periodChosenByUser<P>(); // il remet « 1M » lui-même
    expect(periodOnSelection<P>(state, active, '1M', 'ALL').period).toBeNull();
    // Même compte resélectionné après son choix : rien ne change (son choix prime).
    const same = periodOnSelection<P>({ auto: { accountId: 'f', previous: '1M' } }, failed, '1M', 'ALL');
    expect(same.period).toBeNull();
  });

  it('comptes actifs : aucun changement', () => {
    expect(periodOnSelection<P>(NO_AUTO_PERIOD, active, '1M', 'ALL')).toEqual({ period: null, state: NO_AUTO_PERIOD });
    expect(periodOnSelection<P>(NO_AUTO_PERIOD, { id: 'p', status: 'PASSED' }, '1M', 'ALL').period).toBeNull();
  });

  it('déjà sur « Tout » : rien à changer, mais la période d\'avant est notée', () => {
    expect(periodOnSelection<P>(NO_AUTO_PERIOD, failed, 'ALL', 'ALL'))
      .toEqual({ period: null, state: { auto: { accountId: 'f', previous: 'ALL' } } });
  });
});
