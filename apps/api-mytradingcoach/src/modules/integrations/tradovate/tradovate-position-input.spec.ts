import { describe, it, expect } from 'vitest';
import { sessionPositionInput } from './tradovate-position-input';
import type { TradovateContract, TradovateFill, TradovateFillPair, TradovatePosition } from './tradovate.types';

// #956 : données de séance du regroupement par position (Trade API).
const ACC = 777;
const contracts = new Map<number, TradovateContract>([
  [1, { id: 1, name: 'MGCZ6', contractMaturityId: 9 } as TradovateContract],
  [2, { id: 2, name: 'MNQZ6', contractMaturityId: 8 } as TradovateContract],
]);
const fill = (id: number, orderId: number, contractId: number, action: 'Buy' | 'Sell', ts: string, active = true): TradovateFill =>
  ({ id, orderId, contractId, action, qty: 1, price: 1, timestamp: ts, active });
const pair = (positionId: number, buyFillId: number, sellFillId: number): TradovateFillPair =>
  ({ positionId, buyFillId, sellFillId, qty: 1, buyPrice: 1, sellPrice: 1, active: true });
const pos = (id: number, contractId: number, netPos: number, prevPos?: number): TradovatePosition =>
  ({ id, accountId: ACC, contractId, netPos, prevPos });

describe('sessionPositionInput', () => {
  const orders = [
    { id: 101, accountId: ACC }, { id: 102, accountId: ACC }, { id: 103, accountId: ACC },
    { id: 104, accountId: ACC }, { id: 900, accountId: 999 },
  ];
  const sessionFills = [
    fill(1, 101, 1, 'Buy', '2026-11-11T09:00:00.000Z'),
    fill(2, 102, 1, 'Sell', '2026-11-11T09:05:00.000Z'),
    fill(3, 103, 1, 'Buy', '2026-11-11T09:10:00.000Z'), // position encore ouverte : non appariée
    fill(4, 900, 1, 'Buy', '2026-11-11T09:11:00.000Z'), // autre compte du login
    fill(5, 104, 1, 'Buy', '2026-11-11T09:12:00.000Z', false), // annulée
    fill(6, 104, 1, 'Sell', '2026-11-10T09:00:00.000Z'), // séance précédente
  ];

  it('contrat à position unique : clé = contrat, exécutions du compte retenues, prevPos/netPos repris', () => {
    const r = sessionPositionInput({
      accountPositions: [pos(9, 1, 1, 0)], pairs: [pair(9, 1, 2)], sessionFills, orders, externalAccountId: ACC, contracts,
    });
    expect(r.keyOf(pair(9, 1, 2), 'MGCZ6')).toBe('MGCZ6');
    expect(r.fills.map((f) => f.id)).toEqual(['1', '2', '3']);
    expect(r.startNet.get('MGCZ6')).toBe(0);
    expect(r.endNet.get('MGCZ6')).toBe(1);
  });

  it('deux positions sur le même contrat (deux séances listées) : clé par position, aucune exécution devinée', () => {
    const r = sessionPositionInput({
      accountPositions: [pos(9, 1, 0), pos(11, 1, 1)], pairs: [pair(9, 1, 2)], sessionFills, orders, externalAccountId: ACC, contracts,
    });
    expect(r.keyOf(pair(9, 1, 2), 'MGCZ6')).toBe('MGCZ6#9');
    expect(r.fills).toEqual([]);
    expect(r.endNet.get('MGCZ6#9')).toBe(0);
    expect(r.endNet.get('MGCZ6#11')).toBe(1);
  });

  it('ordres illisibles : aucune exécution non appariée (le contrôle netPos met le contrat de côté)', () => {
    const r = sessionPositionInput({
      accountPositions: [pos(9, 1, 1)], pairs: [pair(9, 1, 2)], sessionFills, orders: null, externalAccountId: ACC, contracts,
    });
    expect(r.fills).toEqual([]);
    expect(r.endNet.get('MGCZ6')).toBe(1);
  });
});
