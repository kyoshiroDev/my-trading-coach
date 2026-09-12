import { describe, it, expect } from 'vitest';
import { describeTradovateSnapshot } from './tradovate-sync-diagnostics';
import type { TradovateFillPair, TradovatePosition } from './tradovate.types';

const acc = (id: number) => ({ id, name: `ACC-${id}`, userId: 1 });
const pos = (id: number, accountId: number, date?: string, netPos = 0): TradovatePosition => {
  const [year, month, dayOfMonth] = (date ?? '').split('-').map(Number);
  return { id, accountId, contractId: 1, netPos, ...(date ? { tradeDate: { year, month, day: dayOfMonth } } : {}) };
};
const pair = (positionId: number): TradovateFillPair =>
  ({ positionId, buyFillId: 1, sellFillId: 2, qty: 1, buyPrice: 1, sellPrice: 2, active: true });

describe('Diagnostic de synchro Tradovate (PROMPT-212)', () => {
  it('Tradovate ne renvoie RIEN : le log le dit explicitement (≠ données écartées)', () => {
    const line = describeTradovateSnapshot({
      accounts: [acc(1), acc(2), acc(3)], positions: [], pairs: [], externalAccountId: 1, fillsFetched: 0,
    });
    expect(line).toBe(
      'Tradovate a renvoyé 3 compte(s) · 0 position(s) : 0 sur ce compte (séances —, 0 ouverte(s)), ' +
        '0 sur les autres comptes du login · 0 paire(s) : 0 rattachée(s) à ce compte, 0 sans position connue · ' +
        '0 fill(s) lu(s).',
    );
  });

  it('trades sur un AUTRE compte du login : visibles dans le log (piste « mauvais compte choisi »)', () => {
    const line = describeTradovateSnapshot({
      accounts: [acc(1), acc(2)],
      positions: [pos(10, 2, '2026-09-10'), pos(11, 2, '2026-09-11')],
      pairs: [pair(10), pair(11)],
      externalAccountId: 1,
      fillsFetched: 0,
    });
    expect(line).toContain('2 position(s) : 0 sur ce compte');
    expect(line).toContain('2 sur les autres comptes du login');
    expect(line).toContain('2 paire(s) : 0 rattachée(s) à ce compte');
  });

  it('séances couvertes par ce compte, positions ouvertes, paires sans position connue', () => {
    const line = describeTradovateSnapshot({
      accounts: [acc(1)],
      positions: [pos(10, 1, '2026-09-11'), pos(11, 1, '2026-09-09', 1), pos(12, 1)],
      pairs: [pair(10), pair(11), pair(99)],
      externalAccountId: 1,
      fillsFetched: 4,
    });
    expect(line).toContain('3 sur ce compte (séances 2026-09-09 → 2026-09-11, 1 ouverte(s))');
    expect(line).toContain('3 paire(s) : 2 rattachée(s) à ce compte, 1 sans position connue');
    expect(line).toContain('4 fill(s) lu(s).');
  });

  it('aucun prix ni P&L dans le log', () => {
    const line = describeTradovateSnapshot({
      accounts: [acc(1)], positions: [pos(10, 1, '2026-09-11')],
      pairs: [{ ...pair(10), buyPrice: 29903.5, sellPrice: 29915.75 }], externalAccountId: 1, fillsFetched: 2,
    });
    expect(line).not.toMatch(/29903|29915/);
  });
});
