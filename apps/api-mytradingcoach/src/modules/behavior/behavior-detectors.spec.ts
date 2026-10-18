import { describe, it, expect } from 'vitest';
import type { BehaviorBaselineData } from './behavior-baseline';
import type { BehaviorPosition } from './behavior-positions';
import {
  type EntryContext,
  applyAntiSpam,
  detectDailyLossDistance,
  detectEntryDayStarted,
  detectLossStreak,
  detectMartingale,
  detectOverDailyLimit,
  detectRevenge,
  detectSizeOverPlan,
  evaluateEntry,
} from './behavior-detectors';

const T0 = Date.UTC(2026, 8, 1, 15, 0);
const at = (sec: number) => new Date(T0 + sec * 1000);

const pos = (o: Partial<BehaviorPosition> & { pnl: number; closedSec: number }): BehaviorPosition => ({
  accountId: 'acc', asset: 'MNQ', side: 'LONG', quantity: 1, maxExitQuantity: 1,
  firstExitAt: at(o.closedSec), closedAt: at(o.closedSec), tradeIds: ['x'], entryPrices: [1], ...o,
});

/** Référence d'un scalper : 1 contrat, ré-entre 60 s après une perte en médiane. */
const scalper = (over: Partial<BehaviorBaselineData> = {}): BehaviorBaselineData => ({
  sessionsUsed: 20, throughDay: '2026-08-31',
  medianGapMs: 45_000, gapSamples: 400, medianGapAfterLossMs: 60_000, gapAfterLossSamples: 180,
  sizeByAsset: { MNQ: { median: 1, p75: 1, p90: 2, samples: 500 } },
  positionsPerSession: { median: 25, p90: 40 },
  ...over,
});

const ctx = (o: Partial<EntryContext> = {}): EntryContext => ({
  at: at(100),
  entry: { asset: 'MNQ', side: 'LONG', quantity: 1 },
  open: [{ asset: 'MNQ', side: 'LONG', quantity: 1 }],
  closed: [],
  baseline: scalper(),
  maxContracts: null,
  dailyLoss: null,
  tradesPerDayMax: null,
  ...o,
});
const types = (c: EntryContext) => evaluateEntry(c).map((a) => a.type);

describe('B — trade de vengeance (relatif au trader)', () => {
  it('scalper qui enchaîne vite après une perte, SANS autre signal : jamais B', () => {
    // Ré-entrée 5 s après une perte (bien sous 60 s / 3), même taille, même sens, 1re perte.
    const c = ctx({ at: at(105), closed: [pos({ pnl: 30, closedSec: 50 }), pos({ pnl: -12, closedSec: 100 })] });
    expect(detectRevenge(c)).toBeNull();
    // Et sur une séance entière de scalping rapide alternant gains et pertes, aucune alerte B.
    const closed = Array.from({ length: 30 }, (_, i) => pos({ pnl: i % 2 ? 15 : -10, closedSec: i * 10 }));
    expect(types(ctx({ at: at(300), closed }))).not.toContain('B_REVENGE');
  });

  it('perte + ré-entrée rapide + taille au-dessus du p75 : B', () => {
    const c = ctx({
      at: at(110),
      entry: { asset: 'MNQ', side: 'LONG', quantity: 3 },
      closed: [pos({ pnl: 20, closedSec: 0 }), pos({ pnl: -40, closedSec: 100 })],
    });
    const a = detectRevenge(c);
    expect(a?.type).toBe('B_REVENGE');
    expect(a?.severity).toBe('medium');
    expect(a?.context['signals']).toEqual(['fast_reentry', 'size_above_p75']);
    expect(a?.message).toBe("Nouvelle entrée MNQ : 10 s après la perte (d'habitude 60 s), 3 contrats (d'habitude 1).");
  });

  it('retournement + 2e perte d’affilée, sans vitesse ni taille : B ; 3 signaux = haute', () => {
    const closed = [pos({ pnl: -10, closedSec: 0 }), pos({ pnl: -10, closedSec: 100, side: 'SHORT' })];
    const slow = ctx({ at: at(400), closed });
    expect(detectRevenge(slow)?.context['signals']).toEqual(['flip', 'second_loss']);
    expect(detectRevenge({ ...slow, at: at(105) })?.severity).toBe('high');
  });

  it('pas après un gain', () => {
    const c = ctx({ at: at(105), entry: { asset: 'MNQ', side: 'LONG', quantity: 5 }, closed: [pos({ pnl: 10, closedSec: 100 })] });
    expect(detectRevenge(c)).toBeNull();
  });
});

describe('période d’apprentissage', () => {
  const heavy = ctx({
    at: at(105),
    entry: { asset: 'MNQ', side: 'SHORT', quantity: 4 },
    open: [{ asset: 'MNQ', side: 'SHORT', quantity: 4 }],
    closed: [pos({ pnl: -10, closedSec: 60 }), pos({ pnl: -10, closedSec: 80 }), pos({ pnl: -10, closedSec: 100 })],
    maxContracts: { minis: 1, micros: 3 },
    dailyLoss: { limit: 1000, used: 700 },
    tradesPerDayMax: 2,
  });

  it('référence fiable (≥ 10 séances) : tout se déclenche', () => {
    expect(types(heavy).sort()).toEqual(
      ['A1_SIZE_OVER_PLAN', 'A2_DAILY_LOSS_DISTANCE', 'A3_ENTRY_DAY_STARTED', 'B_REVENGE', 'C1_LOSS_STREAK', 'C2_OVER_DAILY_LIMIT', 'C3_MARTINGALE'].sort(),
    );
  });

  it('moins de 10 séances (ou aucune référence) : B, C1, C3 muets ; A et C2 actifs', () => {
    for (const baseline of [scalper({ sessionsUsed: 9 }), null]) {
      expect(types({ ...heavy, baseline }).sort()).toEqual(
        ['A1_SIZE_OVER_PLAN', 'A2_DAILY_LOSS_DISTANCE', 'A3_ENTRY_DAY_STARTED', 'C2_OVER_DAILY_LIMIT'].sort(),
      );
    }
  });
});

describe('anti-spam', () => {
  it('même type au plus une fois par 15 min dans la séance, types indépendants', () => {
    const a = { type: 'C2_OVER_DAILY_LIMIT' as const, severity: 'medium' as const, message: '', context: {} };
    const b = { ...a, type: 'C1_LOSS_STREAK' as const };
    const last = new Map();
    expect(applyAntiSpam([a], last, at(0))).toHaveLength(1);
    expect(applyAntiSpam([a, b], last, at(14 * 60 + 59))).toEqual([b]);
    expect(applyAntiSpam([a], last, at(15 * 60))).toHaveLength(1);
  });
});

describe('A2 — points avant la perte max du jour', () => {
  const remaining = 400; // limite 1000, 600 déjà perdus
  const a2 = (asset: string, quantity: number) =>
    detectDailyLossDistance(ctx({
      entry: { asset, side: 'LONG', quantity },
      open: [{ asset, side: 'LONG', quantity }],
      dailyLoss: { limit: 1000, used: 1000 - remaining },
    }));

  it.each([
    // actif, contrats, $/pt, points attendus
    ['MNQ', 4, 2, 50],
    ['NQ', 1, 20, 20],
    ['MES', 10, 5, 8],
    ['ES', 1, 50, 8],
  ])('%s × %d : %d $/pt', (asset, qty, pv, expected) => {
    const a = a2(asset, qty);
    const points = remaining / (qty * pv);
    expect(points).toBe(expected);
    const threshold = asset.endsWith('NQ') ? 40 : 10;
    if (points >= threshold) expect(a).toBeNull();
    else expect(a?.context['points']).toBe(expected);
  });

  it('message factuel', () => {
    const a = detectDailyLossDistance(ctx({
      entry: { asset: 'MNQ', side: 'LONG', quantity: 4 },
      open: [{ asset: 'MNQ', side: 'LONG', quantity: 4 }],
      dailyLoss: { limit: 1000, used: 728 },
    }));
    expect(a?.message).toBe('Avec 4 MNQ, 34 pts contre toi = perte max du jour atteinte.');
    expect(a?.severity).toBe('medium');
  });

  it('perte max déjà dépassée : 0 pt, haute ; sans règle ou actif sans seuil : rien', () => {
    expect(detectDailyLossDistance(ctx({ dailyLoss: { limit: 500, used: 700 } }))?.context['points']).toBe(0);
    expect(detectDailyLossDistance(ctx({ dailyLoss: { limit: 500, used: 700 } }))?.severity).toBe('high');
    expect(detectDailyLossDistance(ctx())).toBeNull();
    expect(detectDailyLossDistance(ctx({
      entry: { asset: 'MGC', side: 'LONG', quantity: 1 }, open: [{ asset: 'MGC', side: 'LONG', quantity: 1 }],
      dailyLoss: { limit: 500, used: 499 },
    }))).toBeNull();
  });
});

describe('A1 / A3 / C', () => {
  it('A1 : micros seuls comparés aux micros, mélange ramené en minis', () => {
    const plan = { minis: 2, micros: 20 };
    expect(detectSizeOverPlan(ctx({ maxContracts: plan, open: [{ asset: 'MNQ', side: 'LONG', quantity: 20 }] }))).toBeNull();
    expect(detectSizeOverPlan(ctx({ maxContracts: plan, open: [{ asset: 'MNQ', side: 'LONG', quantity: 21 }] }))?.context['unit']).toBe('micros');
    expect(detectSizeOverPlan(ctx({ maxContracts: plan, open: [{ asset: 'NQ', side: 'LONG', quantity: 2 }, { asset: 'MNQ', side: 'LONG', quantity: 1 }] }))?.context['held']).toBe(2.1);
    expect(detectSizeOverPlan(ctx({ maxContracts: null, open: [{ asset: 'NQ', side: 'LONG', quantity: 9 }] }))).toBeNull();
  });

  it('A3 : au-delà de 50 % de la perte max du jour', () => {
    expect(detectEntryDayStarted(ctx({ dailyLoss: { limit: 1000, used: 500 } }))).toBeNull();
    expect(detectEntryDayStarted(ctx({ dailyLoss: { limit: 1000, used: 510 } }))?.message).toBe(
      'Nouvelle entrée avec 51 % de la perte max du jour déjà consommée.',
    );
  });

  it('C1 : 3 pertes consécutives, un gain casse la série', () => {
    const l = (s: number) => pos({ pnl: -5, closedSec: s });
    expect(detectLossStreak(ctx({ closed: [l(1), l(2), l(3)] }))?.context['streak']).toBe(3);
    expect(detectLossStreak(ctx({ closed: [l(1), l(2), pos({ pnl: 1, closedSec: 3 }), l(4), l(5)] }))).toBeNull();
  });

  it('C2 : au-delà de la limite déclarée, rien si non renseignée', () => {
    const closed = [pos({ pnl: 1, closedSec: 1 }), pos({ pnl: 1, closedSec: 2 })];
    expect(detectOverDailyLimit(ctx({ closed, tradesPerDayMax: 3 }))).toBeNull();
    expect(detectOverDailyLimit(ctx({ closed, tradesPerDayMax: 2 }))?.message).toBe('3e position de la séance, ta limite déclarée est de 2 par jour.');
    expect(detectOverDailyLimit(ctx({ closed, tradesPerDayMax: null }))).toBeNull();
  });

  it('C3 : taille ≥ 2× la position perdante précédente sur le même actif', () => {
    const lost = pos({ pnl: -50, closedSec: 1, quantity: 2 });
    expect(detectMartingale(ctx({ closed: [lost], entry: { asset: 'MNQ', side: 'LONG', quantity: 4 } }))?.type).toBe('C3_MARTINGALE');
    expect(detectMartingale(ctx({ closed: [lost], entry: { asset: 'MNQ', side: 'LONG', quantity: 3 } }))).toBeNull();
    expect(detectMartingale(ctx({ closed: [lost], entry: { asset: 'MES', side: 'LONG', quantity: 4 } }))).toBeNull();
    expect(detectMartingale(ctx({ closed: [{ ...lost, pnl: 50 }], entry: { asset: 'MNQ', side: 'LONG', quantity: 4 } }))).toBeNull();
  });
});

describe('messages', () => {
  it('ni tiret cadratin ni demi-cadratin', () => {
    const heavy = ctx({
      at: at(105), entry: { asset: 'MNQ', side: 'SHORT', quantity: 4 }, open: [{ asset: 'MNQ', side: 'SHORT', quantity: 4 }],
      closed: [pos({ pnl: -10, closedSec: 60 }), pos({ pnl: -10, closedSec: 80 }), pos({ pnl: -10, closedSec: 100 })],
      maxContracts: { minis: 1, micros: 3 }, dailyLoss: { limit: 1000, used: 700 }, tradesPerDayMax: 2,
    });
    for (const a of evaluateEntry(heavy)) expect(a.message).not.toMatch(/[–—]/);
  });
});
