import { describe, it, expect } from 'vitest';
import { type BehaviorTrade, groupPositions, groupSessions } from './behavior-positions';
import { computeBaseline, quantile } from './behavior-baseline';

// 15:00 UTC = 10:00 CT : en pleine séance, la journée CME est la date du jour.
const at = (day: number, min: number, sec = 0) => new Date(Date.UTC(2026, 8, day, 15, min, sec));
let n = 0;
const t = (o: Partial<BehaviorTrade> & { tradedAt: Date; pnl: number }): BehaviorTrade => ({
  id: String(++n), accountId: 'acc', asset: 'MNQ', side: 'LONG', entry: 20_000 + n, quantity: 1, commission: 0, ...o,
});

describe('groupPositions', () => {
  it('une sortie remplie en plusieurs fills (même seconde) = une position', () => {
    const p = groupPositions([
      t({ tradedAt: at(1, 0, 0), pnl: -10, entry: 100 }),
      t({ tradedAt: at(1, 0, 1), pnl: -5, entry: 101, quantity: 3 }),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ quantity: 4, maxExitQuantity: 4, pnl: -15 });
  });

  it('sortie partielle de la même entrée = la même position, sa plus grosse sortie est la borne basse', () => {
    const p = groupPositions([
      t({ tradedAt: at(1, 0), pnl: 20, entry: 100, quantity: 2 }),
      t({ tradedAt: at(1, 3), pnl: 30, entry: 100, quantity: 1 }),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ quantity: 3, maxExitQuantity: 2 });
  });

  it('autre entrée, autre sens, autre actif ou autre compte = nouvelle position', () => {
    expect(groupPositions([t({ tradedAt: at(1, 0), pnl: 1, entry: 100 }), t({ tradedAt: at(1, 2), pnl: 1, entry: 105 })])).toHaveLength(2);
    expect(groupPositions([t({ tradedAt: at(1, 0), pnl: 1, entry: 100 }), t({ tradedAt: at(1, 0), pnl: 1, entry: 100, side: 'SHORT' })])).toHaveLength(2);
    expect(groupPositions([t({ tradedAt: at(1, 0), pnl: 1, entry: 100 }), t({ tradedAt: at(1, 0), pnl: 1, entry: 100, asset: 'MES' })])).toHaveLength(2);
    expect(groupPositions([t({ tradedAt: at(1, 0), pnl: 1, entry: 100 }), t({ tradedAt: at(1, 0), pnl: 1, entry: 100, accountId: 'b' })])).toHaveLength(2);
  });

  it('P&L net (frais déduits), lignes ouvertes ignorées', () => {
    const p = groupPositions([
      t({ tradedAt: at(1, 0), pnl: 10, commission: 1.24 }),
      { ...t({ tradedAt: at(1, 5), pnl: 0 }), pnl: null },
    ]);
    expect(p).toHaveLength(1);
    expect(p[0].pnl).toBe(8.76);
  });
});

describe('groupSessions', () => {
  it('séance = compte × journée CME : 16:59 CT et 17:01 CT tombent sur deux journées', () => {
    const before = new Date(Date.UTC(2026, 8, 1, 21, 59)); // 16:59 CT
    const after = new Date(Date.UTC(2026, 8, 1, 22, 1)); // 17:01 CT → journée du 2
    const s = groupSessions(groupPositions([t({ tradedAt: before, pnl: 1 }), t({ tradedAt: after, pnl: 1 })]));
    expect(s.map((x) => x.day)).toEqual(['2026-09-01', '2026-09-02']);
  });
});

describe('computeBaseline', () => {
  /** Une séance par jour : `count` positions espacées de `gapMin`, une perte sur deux. */
  const sessionsOf = (days: number[], count = 4, gapMin = 10, size = 1) =>
    groupSessions(
      groupPositions(
        days.flatMap((d) =>
          Array.from({ length: count }, (_, i) => t({ tradedAt: at(d, i * gapMin), pnl: i % 2 === 0 ? -10 : 20, quantity: size })),
        ),
      ),
    );

  it('délais, taille par actif et positions par séance', () => {
    const b = computeBaseline(sessionsOf([1, 2, 3], 4, 10, 2));
    expect(b.sessionsUsed).toBe(3);
    expect(b.medianGapMs).toBe(10 * 60_000);
    expect(b.medianGapAfterLossMs).toBe(10 * 60_000);
    expect(b.sizeByAsset['MNQ']).toMatchObject({ median: 2, p75: 2, samples: 12 });
    expect(b.positionsPerSession).toEqual({ median: 4, p90: 4 });
    expect(b.throughDay).toBe('2026-09-03');
  });

  it('20 dernières séances seulement', () => {
    const days = Array.from({ length: 25 }, (_, i) => i + 1);
    const b = computeBaseline(sessionsOf(days));
    expect(b.sessionsUsed).toBe(20);
    expect(b.throughDay).toBe('2026-09-25');
  });

  it('sans triche : la séance du jour et les suivantes ne comptent jamais', () => {
    const past = sessionsOf([1, 2, 3], 4, 10, 1);
    const future = sessionsOf([4, 5], 4, 1, 9);
    const b = computeBaseline([...past, ...future], '2026-09-04');
    expect(b).toEqual(computeBaseline(past));
    expect(b.throughDay).toBe('2026-09-03');
    expect(b.sizeByAsset['MNQ'].median).toBe(1);
  });

  it('quantité aberrante (fill cassé) hors référence', () => {
    const s = sessionsOf([1, 2, 3], 4, 10, 1);
    s[0].positions[0] = { ...s[0].positions[0], quantity: 145 };
    expect(computeBaseline(s).sizeByAsset['MNQ'].samples).toBe(11);
  });

  it('trop peu de mesures : pas de valeur (jamais un chiffre inventé)', () => {
    const b = computeBaseline(sessionsOf([1], 2));
    expect(b.medianGapMs).toBeNull();
    expect(b.sizeByAsset).toEqual({});
  });

  it('quantile linéaire', () => {
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(quantile([5], 0.9)).toBe(5);
  });
});
