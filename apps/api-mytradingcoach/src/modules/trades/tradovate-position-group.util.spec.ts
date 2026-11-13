import { describe, it, expect } from 'vitest';
import {
  aggregateGroup,
  groupPositions,
  positionImportKey,
  type FillLeg,
  type GroupableTrade,
  type PairLeg,
} from './tradovate-position-group.util';

// #956 : un trade = toutes les exécutions d'une position, de l'ouverture au retour à plat.

const T0 = Date.UTC(2026, 10, 11, 9, 32, 0); // 11/11 10:32 Paris
const at = (s: number) => new Date(T0 + s * 1000);
let n = 0;
const pair = (buy: string, sell: string, qty: number, buyS: number, sellS: number, contract = 'MGCZ6'): PairLeg => ({
  idx: n++, contract, buyFillId: buy, sellFillId: sell, qty, buyAt: at(buyS), sellAt: at(sellS),
});
const reset = () => { n = 0; };

describe('groupPositions', () => {
  it('issue : short 8 MGC sorti en 5 morceaux (1, 2, 1, 2, 2) → 1 position', () => {
    reset();
    const pairs = [1, 2, 1, 2, 2].map((q, i) => pair(`b${i}`, 's0', q, 60 + i * 10, 0));
    const r = groupPositions(pairs);
    expect(r.groups).toEqual([{ contract: 'MGCZ6', openFillId: 's0', pairIdx: [0, 1, 2, 3, 4], fillIds: ['s0', 'b0', 'b1', 'b2', 'b3', 'b4'] }]);
    expect(r.deferred).toEqual([]);
    expect(r.uncertain).toEqual([]);
  });

  it('issue : long 40 sorti en 10 morceaux → 1 position', () => {
    reset();
    const qs = [3, 1, 23, 1, 1, 3, 1, 1, 3, 3];
    const r = groupPositions(qs.map((q, i) => pair('b0', `s${i}`, q, 0, 30 + i)));
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].openFillId).toBe('b0');
    expect(r.groups[0].pairIdx).toHaveLength(10);
  });

  it('entrées en plusieurs fois (achat 1, achat 1, vente 2) → 1 position ouverte par le 1er achat', () => {
    reset();
    const r = groupPositions([pair('a', 'c', 1, 0, 20), pair('b', 'c', 1, 10, 20)]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].openFillId).toBe('a');
  });

  it('sorties partielles sans exécution commune (A-C, B-D) → 1 position, pas 2', () => {
    reset();
    const r = groupPositions([pair('A', 'C', 1, 0, 20), pair('B', 'D', 1, 10, 30)]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].pairIdx).toEqual([0, 1]);
  });

  it('deux positions séparées par un retour à plat → 2 groupes', () => {
    reset();
    const r = groupPositions([pair('b1', 's1', 2, 0, 10), pair('b2', 's2', 1, 20, 30)]);
    expect(r.groups.map((g) => g.openFillId)).toEqual(['b1', 'b2']);
  });

  it('retournement long 2 → short 1 par une vente de 3 : 2 positions', () => {
    reset();
    // A = achat 2 ; F = vente 3 (clôt A, ouvre un short de 1) ; G = rachat 1.
    const r = groupPositions([pair('A', 'F', 2, 0, 10), pair('G', 'F', 1, 20, 10)]);
    expect(r.groups).toEqual([
      { contract: 'MGCZ6', openFillId: 'A', pairIdx: [0], fillIds: ['A', 'F'] },
      { contract: 'MGCZ6', openFillId: 'F', pairIdx: [1], fillIds: ['F', 'G'] },
    ]);
  });

  it('position pas encore à plat en fin de données : paires différées', () => {
    reset();
    const r = groupPositions([pair('b1', 's1', 1, 0, 10), pair('A', 'B', 1, 20, 30), pair('C', 'D', 1, 25, 40)], {
      fills: [
        { id: 'b1', contract: 'MGCZ6', action: 'Buy', qty: 1, at: at(0) },
        { id: 's1', contract: 'MGCZ6', action: 'Sell', qty: 1, at: at(10) },
        { id: 'A', contract: 'MGCZ6', action: 'Buy', qty: 2, at: at(20) }, // 2 achetés, 1 seul revendu
        { id: 'C', contract: 'MGCZ6', action: 'Buy', qty: 1, at: at(25) },
        { id: 'B', contract: 'MGCZ6', action: 'Sell', qty: 1, at: at(30) },
        { id: 'D', contract: 'MGCZ6', action: 'Sell', qty: 1, at: at(40) },
      ] satisfies FillLeg[],
    });
    expect(r.groups.map((g) => g.openFillId)).toEqual(['b1']);
    expect(r.deferred).toEqual([1, 2]);
  });

  it('exécution non appariée : sans les fills le cumul repasse faussement par 0, avec eux la position reste ouverte', () => {
    reset();
    const pairs = [pair('A', 'C', 1, 0, 20)];
    const fills: FillLeg[] = [
      { id: 'A', contract: 'MGCZ6', action: 'Buy', qty: 1, at: at(0) },
      { id: 'B', contract: 'MGCZ6', action: 'Buy', qty: 1, at: at(10) }, // dans aucune paire
      { id: 'C', contract: 'MGCZ6', action: 'Sell', qty: 1, at: at(20) },
    ];
    expect(groupPositions(pairs, { fills }).deferred).toEqual([0]);
    expect(groupPositions(pairs, { fills }).groups).toEqual([]);
  });

  it('position attendue différente du cumul (netPos) : contrat mis de côté, rien d’inventé', () => {
    reset();
    const r = groupPositions([pair('A', 'C', 1, 0, 20)], { endNet: new Map([['MGCZ6', 1]]) });
    expect(r.uncertain).toEqual([0]);
    expect(r.groups).toEqual([]);
  });

  it('position ouverte avant les données (prevPos ≠ 0) : différée', () => {
    reset();
    const r = groupPositions([pair('A', 'C', 1, 0, 20)], { startNet: new Map([['MGCZ6', 2]]) });
    expect(r.deferred).toEqual([0]);
  });

  it('deux contrats (échéances différentes) : positions indépendantes', () => {
    reset();
    const r = groupPositions([pair('a', 'b', 1, 0, 10, 'MGCZ6'), pair('c', 'd', 1, 5, 15, 'MGCG7')]);
    expect(r.groups.map((g) => g.contract).sort()).toEqual(['MGCG7', 'MGCZ6']);
  });

  it('même seconde : l’id départage', () => {
    reset();
    const r = groupPositions([pair('10', '11', 1, 0, 0), pair('12', '13', 1, 0, 0)]);
    expect(r.groups.map((g) => g.openFillId)).toEqual(['10', '12']);
  });

  it('clé d’import stable', () => {
    expect(positionImportKey('123456')).toBe('tv:123456');
  });
});

describe('aggregateGroup', () => {
  it('moyennes pondérées, P&L et frais additionnés, dernière clôture', () => {
    const t = aggregateGroup<GroupableTrade>([
      { side: 'SHORT', entry: 4000, exit: 3995, quantity: 1, pnl: 50, commission: 1.24, tradedAt: '2026-11-11T09:33:00.000Z' },
      { side: 'SHORT', entry: 4000, exit: 3990, quantity: 3, pnl: 300, commission: 3.72, tradedAt: '2026-11-11T09:40:00.000Z' },
    ]);
    expect(t).toMatchObject({ side: 'SHORT', quantity: 4, entry: 4000, exit: 3991.25, pnl: 350, commission: 4.96, tradedAt: '2026-11-11T09:40:00.000Z' });
    expect(t.session).toBeDefined();
  });

  it('pas de bruit flottant sur les moyennes', () => {
    const t = aggregateGroup([
      { side: 'LONG' as const, entry: 1.1, exit: 1.2, quantity: 1, pnl: 1 },
      { side: 'LONG' as const, entry: 1.2, exit: 1.3, quantity: 2, pnl: 2 },
    ]);
    expect(t.entry).toBe(1.16666667);
    expect(t.exit).toBe(1.26666667);
  });

  it('sens différents dans une position : erreur, jamais un trade incohérent', () => {
    expect(() => aggregateGroup([{ side: 'LONG' }, { side: 'SHORT' }])).toThrow(/sens/);
  });
});
