import { describe, it, expect } from 'vitest';
import type { BehaviorBaselineData } from './behavior-baseline';
import type { EntryContext } from './behavior-detectors';
import type { BehaviorPosition, BehaviorTrade } from './behavior-positions';
import { levelOf, pressureAt } from './behavior-pressure';
import { evaluatePressure } from './behavior-pressure-eval';
import { replay } from './behavior-replay';

const T0 = Date.UTC(2026, 8, 15, 15, 0);
const min = (m: number) => new Date(T0 + m * 60_000);

const baseline = (over: Partial<BehaviorBaselineData> = {}): BehaviorBaselineData => ({
  sessionsUsed: 20,
  throughDay: '2026-09-14',
  medianGapMs: 10 * 60_000,
  gapSamples: 50,
  medianGapAfterLossMs: 12 * 60_000,
  gapAfterLossSamples: 30,
  sizeByAsset: { MNQ: { median: 2, p75: 2, p90: 3, samples: 60 } },
  positionsPerSession: { median: 4, p90: 6 },
  ...over,
});

const pos = (closedMin: number, pnl: number, quantity = 2): BehaviorPosition => ({
  accountId: 'acc', asset: 'MNQ', side: 'LONG', quantity, maxExitQuantity: quantity, pnl,
  firstExitAt: min(closedMin), closedAt: min(closedMin), tradeIds: [], entryPrices: [20_000],
});

const ctx = (over: Partial<EntryContext> = {}): EntryContext => ({
  at: min(30),
  entry: { asset: 'MNQ', side: 'LONG', quantity: 2 },
  open: [{ asset: 'MNQ', side: 'LONG', quantity: 2 }],
  closed: [],
  baseline: baseline(),
  maxContracts: null,
  dailyLoss: null,
  tradesPerDayMax: null,
  ...over,
});

describe('pressureAt', () => {
  it('neutre tant que la référence est en apprentissage, même sur une entrée à risque', () => {
    const r = pressureAt(ctx({ baseline: baseline({ sessionsUsed: 9 }), closed: [pos(0, -50), pos(10, -50), pos(29, -80)], entry: { asset: 'MNQ', side: 'LONG', quantity: 8 } }));
    expect(r).toEqual({ level: 'learning', score: 0, contributions: [], message: null });
    expect(pressureAt(ctx({ baseline: null })).level).toBe('learning');
  });

  it('entrée habituelle : calme, aucun signal', () => {
    const r = pressureAt(ctx({ closed: [pos(0, 30), pos(15, -20)], at: min(30) }));
    expect(r).toMatchObject({ level: 'calm', score: 0, contributions: [], message: null });
  });

  it('ré-entrée rapide en taille après 3 pertes : zone rouge, phrase factuelle', () => {
    const r = pressureAt(ctx({
      closed: [pos(0, -40), pos(8, -40), pos(29, -60)],
      at: min(30),
      entry: { asset: 'MNQ', side: 'LONG', quantity: 5 },
      open: [{ asset: 'MNQ', side: 'LONG', quantity: 5 }],
    }));
    expect(r.level).toBe('red');
    expect(r.contributions.map((c) => c.signal)).toEqual(['fast_reentry', 'size_up', 'loss_streak']);
    expect(r.score).toBe(30 + 25 + 20);
    expect(r.message).toBe("Entrée 60 s après une perte (d'habitude 12 min) ; 5 MNQ juste après une perte (d'habitude 2).");
  });

  it('chaque palier de ré-entrée compte selon le délai médian du trader (12 min)', () => {
    const after = (m: number) => pressureAt(ctx({ closed: [pos(0, -40)], at: min(m) })).contributions.find((c) => c.signal === 'fast_reentry')?.points ?? 0;
    expect([after(3), after(5), after(11), after(13)]).toEqual([30, 20, 10, 0]);
  });

  it('la ré-entrée ne compte qu’après une perte, la taille seule reste faible', () => {
    const r = pressureAt(ctx({ closed: [pos(29, 40)], entry: { asset: 'MNQ', side: 'LONG', quantity: 5 } }));
    expect(r.contributions).toEqual([expect.objectContaining({ signal: 'size_up', points: 15 })]);
    expect(r.level).toBe('calm');
  });

  it('rythme au-delà du p90 de positions par séance, puis au-delà de 1,5 × p90', () => {
    const closed = (n: number) => Array.from({ length: n }, (_, i) => pos(i * 3, 10));
    expect(pressureAt(ctx({ closed: closed(6), at: min(40) })).contributions).toEqual([expect.objectContaining({ signal: 'pace', points: 15 })]);
    expect(pressureAt(ctx({ closed: closed(9), at: min(40) })).contributions).toEqual([expect.objectContaining({ signal: 'pace', points: 25 })]);
  });

  it('perte max du jour consommée à plus de 80 % : vigilance à elle seule', () => {
    const r = pressureAt(ctx({ dailyLoss: { limit: 1000, used: 850 } }));
    expect(r).toMatchObject({ level: 'watch', score: 30 });
    expect(r.message).toBe('85 % de la perte max du jour consommée.');
  });

  it('règles du plan et limite déclarée comptent aussi', () => {
    const r = pressureAt(ctx({
      maxContracts: { minis: null, micros: 3 },
      tradesPerDayMax: 2,
      closed: [pos(0, 10), pos(10, 10)],
      entry: { asset: 'MNQ', side: 'LONG', quantity: 2 },
      open: [{ asset: 'MNQ', side: 'LONG', quantity: 4 }],
    }));
    expect(r.contributions.map((c) => [c.signal, c.points])).toEqual([['over_plan', 30], ['over_limit', 15]]);
    expect(r).toMatchObject({ level: 'watch', score: 45 });
  });

  it('bornes strictes : rang = p90, perte du jour à 50 % pile, 2 pertes seules', () => {
    const wins = Array.from({ length: 5 }, (_, i) => pos(i * 3, 10));
    expect(pressureAt(ctx({ closed: wins, at: min(40) })).contributions).toEqual([]);
    expect(pressureAt(ctx({ dailyLoss: { limit: 1000, used: 500 } })).contributions).toEqual([]);
    expect(pressureAt(ctx({ dailyLoss: { limit: 1000, used: 800 } })).contributions).toEqual([expect.objectContaining({ signal: 'daily_loss_used', points: 15 })]);
    const two = pressureAt(ctx({ closed: [pos(0, -40), pos(5, -40)], at: min(40) }));
    expect(two.contributions).toEqual([expect.objectContaining({ signal: 'loss_streak', points: 10 })]);
  });

  it('ré-entrée datée avant la sortie précédente (positions qui se chevauchent) : pas de signal', () => {
    const r = pressureAt(ctx({ closed: [pos(31, -40)], at: min(30) }));
    expect(r.contributions.find((c) => c.signal === 'fast_reentry')).toBeUndefined();
  });

  it('score plafonné à 100', () => {
    const r = pressureAt(ctx({
      closed: [pos(0, -40), pos(5, -40), pos(10, -40), pos(29, -40), pos(29.5, -40), pos(29.6, -40), pos(29.7, -40), pos(29.8, -40), pos(29.9, -40)],
      entry: { asset: 'MNQ', side: 'LONG', quantity: 6 },
      open: [{ asset: 'MNQ', side: 'LONG', quantity: 6 }],
      dailyLoss: { limit: 400, used: 360 },
    }));
    expect(r.score).toBe(100);
    expect(r.level).toBe('red');
  });

  it('vocabulaire : jamais « émotion », jamais de tiret cadratin', () => {
    const r = pressureAt(ctx({ closed: [pos(0, -40), pos(8, -40), pos(29, -60)], entry: { asset: 'MNQ', side: 'LONG', quantity: 5 }, dailyLoss: { limit: 100, used: 90 } }));
    for (const text of [r.message!, ...r.contributions.map((c) => c.detail)]) {
      expect(text).not.toMatch(/émotion|—/i);
    }
  });

  it('états : bornes 30 et 60', () => {
    expect([levelOf(29), levelOf(30), levelOf(59), levelOf(60)]).toEqual(['calm', 'watch', 'watch', 'red']);
  });
});

// ── Rejeu et évaluation ─────────────────────────────────────────────────────

// Minutes décimales permises (0.1 = 6 s) : Date.UTC les tronquerait.
const at = (day: number, m: number) => new Date(Date.UTC(2026, 8, day, 15) + m * 60_000);
let n = 0;
const t = (day: number, m: number, pnl: number, quantity = 1, side: 'LONG' | 'SHORT' = 'LONG'): BehaviorTrade => ({
  id: String(++n), accountId: 'acc', asset: 'MNQ', side, entry: 20_000 + n, quantity, pnl, commission: 0, tradedAt: at(day, m),
});
const normalDay = (day: number) => Array.from({ length: 6 }, (_, i) => t(day, i * 5, i % 2 ? 20 : -10));
const badDay = (day: number) => [t(day, 0, -50), t(day, 0.1, -80, 4, 'SHORT'), t(day, 0.2, -60), t(day, 0.3, -200, 8, 'SHORT')];
const input = (trades: BehaviorTrade[]) => ({ trades, accounts: new Map(), tradesPerDayMax: null });

describe('replay + pressure', () => {
  const history = [...Array.from({ length: 12 }, (_, i) => normalDay(i + 1)).flat(), ...badDay(15)];

  it('une jauge par position, alignée sur les positions', () => {
    for (const s of replay(input(history))) expect(s.pressure).toHaveLength(s.positions.length);
  });

  it('ajouter des séances futures ne change rien à la jauge passée', () => {
    const before = replay(input(history));
    const after = replay(input([...history, ...badDay(16), ...Array.from({ length: 5 }, (_, i) => normalDay(20 + i)).flat()]));
    for (const s of before) expect(after.find((x) => x.key === s.key)!.pressure).toEqual(s.pressure);
  });

  it('la séance qui part en vrille passe en zone rouge avant son plus bas ; les séances normales restent calmes', () => {
    const sessions = replay(input(history));
    const bad = sessions.find((s) => s.day === '2026-09-15')!;
    expect(bad.pressure.map((r) => r.level)).toContain('red');
    expect(bad.pressure.findIndex((r) => r.level === 'red')).toBeLessThanOrEqual(bad.lowIndex);
    const normal = sessions.filter((s) => s.day !== '2026-09-15').flatMap((s) => s.pressure.map((r) => r.level));
    expect(normal.every((l) => l === 'learning' || l === 'calm')).toBe(true);
  });

  it('évaluation : la pire journée est vue en rouge avant son plus bas', () => {
    const e = evaluatePressure(replay(input(history)));
    expect(e.sessions).toBe(13);
    expect(e.worstDays).toBeGreaterThanOrEqual(1);
    expect(e.worstDaysRedBeforeLow).toBe(e.worstDays);
    expect(e.byLevel.red.positions).toBeGreaterThan(0);
    expect(e.byLevel.red.meanPnl).toBeLessThan(e.byLevel.calm.meanPnl);
  });
});
