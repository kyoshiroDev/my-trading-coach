import { describe, expect, it } from 'vitest';
import { attemptNumber, newerAttempt } from './attempt-label';

describe('tentative plus récente du même compte (B3)', () => {
  const accounts = [
    { id: 'a1', label: 'Apex 50K #1' },
    { id: 'a2', label: 'apex 50k #2 ' },
    { id: 't1', label: 'Topstep 150K #4' },
  ];

  it('numéro du libellé, 1 sans suffixe', () => {
    expect(attemptNumber('Apex 50K #3')).toBe(3);
    expect(attemptNumber('Apex 50K')).toBe(1);
  });

  it('#1 avec un #2 existant : le #2 (sans casse ni espaces de bord)', () => {
    expect(newerAttempt('Apex 50K #1', accounts)?.id).toBe('a2');
    expect(newerAttempt('Apex 50K', accounts)?.id).toBe('a2');
  });

  it('dernière tentative, ou autre compte : rien', () => {
    expect(newerAttempt('Apex 50K #2', accounts)).toBeNull();
    expect(newerAttempt('Topstep 150K #4', accounts)).toBeNull();
    expect(newerAttempt('FTMO 100K', accounts)).toBeNull();
  });

  it('plusieurs tentatives plus récentes : la plus récente', () => {
    expect(newerAttempt('Apex 50K #1', [...accounts, { id: 'a3', label: 'Apex 50K #3' }])?.id).toBe('a3');
  });
});
