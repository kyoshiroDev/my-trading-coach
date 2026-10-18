import { describe, it, expect } from 'vitest';
import type { BehaviorTrade } from './behavior-positions';
import { replay } from './behavior-replay';

// 15:00 UTC = 10:00 CT : la journée CME est la date du jour.
const at = (day: number, min: number) => new Date(Date.UTC(2026, 8, day, 15, min));
let n = 0;
const t = (day: number, min: number, pnl: number, quantity = 1, side: 'LONG' | 'SHORT' = 'LONG'): BehaviorTrade => ({
  id: String(++n), accountId: 'acc', asset: 'MNQ', side, entry: 20_000 + n, quantity, pnl, commission: 0, tradedAt: at(day, min),
});

/** Séance « normale » d'un scalper : 6 positions de 1 contrat, une perte sur deux, 5 min d'écart. */
const normalDay = (day: number) => Array.from({ length: 6 }, (_, i) => t(day, i * 5, i % 2 ? 20 : -10));
/** Séance qui part en vrille : perte, retournement immédiat en 4 contrats, etc. */
const badDay = (day: number) => [t(day, 0, -50), t(day, 0.1, -80, 4, 'SHORT'), t(day, 0.2, -60), t(day, 0.3, -200, 8, 'SHORT')];

const input = (trades: BehaviorTrade[]) => ({ trades, accounts: new Map(), tradesPerDayMax: null });

describe('replay', () => {
  const history = [...Array.from({ length: 12 }, (_, i) => normalDay(i + 1)).flat(), ...badDay(15)];

  it('la référence d’une séance ne contient jamais cette séance ni les suivantes', () => {
    for (const s of replay(input(history))) {
      if (s.baseline.throughDay) expect(s.baseline.throughDay < s.day).toBe(true);
    }
  });

  it('ajouter des séances futures ne change rien aux alertes passées', () => {
    const before = replay(input(history));
    const future = [...normalDay(16), ...badDay(17), ...Array.from({ length: 5 }, (_, i) => normalDay(20 + i)).flat()];
    const after = replay(input([...history, ...future]));
    for (const s of before) {
      const same = after.find((x) => x.key === s.key)!;
      expect(same.alerts).toEqual(s.alerts);
      expect(same.baseline).toEqual(s.baseline);
    }
  });

  it('apprentissage : la séance qui part en vrille n’alerte en B/C qu’une fois 10 séances passées', () => {
    const early = replay(input([...normalDay(1), ...badDay(2)])).find((s) => s.day === '2026-09-02')!;
    expect(early.alerts).toEqual([]);
    const late = replay(input(history)).find((s) => s.day === '2026-09-15')!;
    expect(late.alerts.map((a) => a.type)).toEqual(expect.arrayContaining(['B_REVENGE', 'C1_LOSS_STREAK', 'C3_MARTINGALE']));
    expect(late.low).toBe(-390);
  });

  it('les séances normales d’un scalper n’alertent pas', () => {
    const normal = replay(input(history)).filter((s) => s.day !== '2026-09-15');
    expect(normal.flatMap((s) => s.alerts)).toEqual([]);
  });
});
