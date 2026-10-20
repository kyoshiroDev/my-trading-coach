import { describe, it, expect } from 'vitest';
import {
  START_LABEL,
  chartAriaLabel,
  compactMoney,
  drawdownSeries,
  equitySeries,
  maxDrawdownIndex,
  floorSeries,
  planFloorOf,
  planObjectiveLine,
  spanRange,
  spanDays,
  tickDate,
} from './chart-series.util';
import type { TradingAccount } from '../api/accounts.api';
import { periodStartBalance } from './equity-period.util';

const pt = (date: string, cumulativePnl: number) => ({ date, cumulativePnl });

/** Compte minimal : seuls les champs lus par les repères du plan. */
const account = (metrics: Record<string, unknown>, propFirmPlanId: string | null = 'apex-eod-50k') =>
  ({ id: 'a', propFirmPlanId, metrics: { objective: null, progress: null, drawdown: null, drawdownUnconfirmed: false, ...metrics } }) as unknown as TradingAccount;
const planProgress = (required: number, current: number, kind = 'objective') => ({
  kind,
  requirements: [{ key: 'profit', met: current >= required, current, required, unit: 'usd' }],
});

describe('compactMoney (libellés d\'axes)', () => {
  it('format compact lisible, jamais « 135000$ »', () => {
    expect(compactMoney(135_000, 'USD')).toBe('$135k');
    expect(compactMoney(95_000, 'USD')).toBe('$95k');
    expect(compactMoney(-2_400, 'USD')).toBe('-$2.4k');
    expect(compactMoney(1_250_000, 'USD')).toBe('$1.3M');
    expect(compactMoney(850, 'USD')).toBe('$850');
    expect(compactMoney(0, 'USD')).toBe('$0');
  });

  it('repères voisins jamais identiques : décimales selon l\'écart entre repères', () => {
    expect(compactMoney(100_500, 'USD', false, 500)).toBe('$100.5k');
    expect(compactMoney(101_000, 'USD', false, 500)).toBe('$101k');
    expect(compactMoney(100_250, 'USD', false, 250)).toBe('$100.25k');
    expect(compactMoney(2_000, 'USD', false, 200)).toBe('$2k');
  });

  it('devise du compte : symbole avant, code après, rien si inconnue', () => {
    expect(compactMoney(-4_200, 'EUR')).toBe('-€4.2k');
    expect(compactMoney(12_000, 'USDT')).toBe('12k USDT');
    expect(compactMoney(12_000, null)).toBe('12k');
  });
});

describe('séries', () => {
  it('données vides → seul le point « Départ »', () => {
    const s = equitySeries([], 50_000);
    expect(s.values).toEqual([50_000]);
    expect(s.dates).toEqual([null]);
  });

  it('1 point : départ au capital de base puis le jour tradé', () => {
    const s = equitySeries([pt('2025-01-06T00:00:00.000Z', 300)], 50_000);
    expect(s.values).toEqual([50_000, 50_300]);
    expect(s.dayPnl).toEqual([null, 300]);
  });

  it('équité négative : valeurs sous le capital de base', () => {
    const s = equitySeries([pt('2025-01-06', -200), pt('2025-01-07', -900)], 10_000);
    expect(s.values).toEqual([10_000, 9_800, 9_100]);
    expect(s.dayPnl).toEqual([null, -200, -700]);
  });

  it('drawdown = écart au plus haut du P&L cumulé, max repéré', () => {
    const s = drawdownSeries([pt('2025-01-06', 500), pt('2025-01-07', 100), pt('2025-01-08', 700)]);
    expect(s.values).toEqual([0, 0, -400, 0]);
    expect(maxDrawdownIndex(s.values)).toBe(2);
    expect(maxDrawdownIndex([0, 0])).toBeNull();
  });
});

describe('dates des repères', () => {
  it('jj/mm/aa sur une période courte, mois abrégé au-delà de ~6 mois', () => {
    expect(tickDate('2025-01-06T12:00:00', 30)).toBe('06/01/25');
    expect(tickDate('2025-01-06T12:00:00', 365)).toMatch(/janv\.? 25/);
    expect(tickDate(null, 30)).toBe(START_LABEL);
  });

  it('série longue : écart en jours entre la première et la dernière date', () => {
    const points = Array.from({ length: 400 }, (_, i) =>
      pt(new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString(), i),
    );
    expect(Math.round(spanDays(equitySeries(points, 0).dates))).toBe(399);
  });
});

describe('chartAriaLabel', () => {
  it('résume départ, actuel et période', () => {
    const s = equitySeries([pt('2025-01-06T12:00:00', 300), pt('2025-03-12T12:00:00', 1_200)], 50_000);
    const label = chartAriaLabel('equity', s, 'USD');
    expect(label).toContain('départ $50,000');
    expect(label).toContain('actuel $51,200');
    expect(label).toMatch(/du 6 janv\.? 2025 au 12 mars 2025/);
  });

  it('drawdown : actuel et max', () => {
    const s = drawdownSeries([pt('2025-01-06T12:00:00', 500), pt('2025-01-07T12:00:00', -300)]);
    expect(chartAriaLabel('drawdown', s, 'USD')).toContain('actuel -$800, max -$800');
  });

  it('sans données', () => {
    expect(chartAriaLabel('equity', equitySeries([], 0), 'USD')).toContain('aucune donnée');
  });
});

describe('drawdown d’un compte de 50K, gains avant et pendant la période', () => {
  it('part du sommet d’avant la période', () => {
    const points = [pt('2026-10-01', 300), pt('2026-10-02', -100), pt('2026-10-03', 840)];
    const s = drawdownSeries(points, { pnl: 238, peak: 500 });
    expect(s.values).toEqual([-262, 0, -400, 0]);
    expect(maxDrawdownIndex(s.values)).toBe(2);
  });
});

describe('objectif sur la courbe d’équité', () => {
  const evalAcc = (over: Record<string, unknown> = {}) =>
    account({ startingBalance: 50_000, currentBalance: 51_078, progress: planProgress(3_000, 1_078), ...over });

  it('évaluation : solde de départ + objectif du plan, quelle que soit la période', () => {
    expect(planObjectiveLine(evalAcc(), [pt('2026-10-01', 840)], 'USD')).toEqual({
      value: 53_000, label: 'Objectif du plan +$3,000', pending: [],
    });
    expect(planObjectiveLine(evalAcc(), [pt('2026-10-01', 1_078)], 'USD')?.value).toBe(53_000);
  });

  it('évaluation : jours de trading minimum restants en légende', () => {
    const progress = { kind: 'objective', requirements: [
      { key: 'profit', met: false, current: 1_078, required: 3_000, unit: 'usd' },
      { key: 'trading_days', met: false, current: 4, required: 7, unit: 'days' },
    ] };
    expect(planObjectiveLine(evalAcc({ progress }), [pt('2026-10-01', 100)], 'USD')?.pending).toEqual(['Jours tradés 4 / 7']);
  });

  it('sans plan : objectif saisi sur le compte', () => {
    const acc = account({ startingBalance: 50_000, objective: { current: 500, target: 2_000, pct: 0.25 } }, null);
    expect(planObjectiveLine(acc, [pt('2025-01-06', 500)], 'USD')).toEqual({ value: 52_000, label: 'Objectif +$2,000', pending: [] });
  });

  it('aucun objectif : « Tous les comptes », pas de données, aucun objectif', () => {
    expect(planObjectiveLine(null, [pt('2025-01-06', 100)])).toBeNull();
    expect(planObjectiveLine(evalAcc(), [])).toBeNull();
    expect(planObjectiveLine(account({ progress: null, objective: null }), [pt('2025-01-06', 1)])).toBeNull();
  });
});

describe('compte Funded : prochain payout (même progression que le suivi du compte)', () => {
  const funded = (requirements: unknown[], currentBalance = 49_985.24) =>
    account({ startingBalance: 50_000, currentBalance, progress: { kind: 'payout', requirements } }, 'tradeify-select-flex-50k');

  it('profit du cycle : solde actuel + ce qui manque', () => {
    const line = planObjectiveLine(funded([{ key: 'cycle_profit', met: false, current: 400, required: 1_000, unit: 'usd' }], 50_400), [pt('2026-10-01', 400)], 'USD');
    expect(line).toEqual({ value: 51_000, label: 'Prochain payout $51,000', pending: [] });
  });

  it('solde de retrait : seuil absolu, le plus exigeant des seuils en $ l’emporte', () => {
    const line = planObjectiveLine(funded([
      { key: 'cycle_profit', met: true, current: 1_200, required: 1_000, unit: 'usd' },
      { key: 'safety_net', met: false, current: 51_200, required: 52_100, unit: 'usd' },
    ], 51_200), [pt('2026-10-01', 1_200)], 'USD');
    expect(line?.value).toBe(52_100);
  });

  it('seuil uniquement en jours gagnants (Tradeify) : légende sans ligne', () => {
    const line = planObjectiveLine(funded([{ key: 'winning_days', met: false, current: 0, required: 5, unit: 'days', threshold: 150 }]), [pt('2026-10-01', 41.3)], 'USD');
    expect(line).toEqual({ value: null, label: 'Prochain payout', pending: ['Jours ≥ $150 : 0 / 5'] });
  });
});

describe('Tradeify 50K Funded : P&L total, période, solde et départ cohérents', () => {
  // 15/09 +105.12 et 17/09 -161.18 AVANT la fenêtre de 30 jours, puis +40.60, -8.96, +9.66.
  const period = [pt('2026-09-29', 40.6), pt('2026-10-02', 31.64), pt('2026-10-06', 41.3)];
  const all = [pt('2026-09-15', 105.12), pt('2026-09-17', -56.06), ...period.map((p) => pt(p.date, +(p.cumulativePnl - 56.06).toFixed(2)))];

  it('30 jours : départ = 50 000 − 56.06, fin = solde du compte', () => {
    const start = periodStartBalance(50_000, 49_985.24, 41.3, { pnl: -56.06, peak: 105.12, count: 6 });
    expect(start).toBeCloseTo(49_943.94);
    expect(equitySeries(period, start).values.at(-1)).toBeCloseTo(49_985.24);
  });

  it('« Tout » ou période couvrant le début du compte : départ à la taille du compte', () => {
    expect(periodStartBalance(50_000, 49_985.24, -14.76, { pnl: 0, peak: 0, count: 0 })).toBe(50_000);
    expect(equitySeries(all, 50_000).values.at(-1)).toBeCloseTo(49_985.24);
  });

  it('solde du broker ≠ trades : une période couvrant le début part quand même de la taille du compte', () => {
    expect(periodStartBalance(50_000, 49_900, -14.76, { pnl: 0, peak: 0, count: 0 })).toBe(50_000);
  });

  it('API sans historique (ancienne) : repli sur solde actuel − P&L de la période', () => {
    expect(periodStartBalance(50_000, 49_985.24, 41.3, undefined)).toBeCloseTo(49_943.94);
  });

  it('axe : amplitude minimale de 2 % du solde (quelques dollars restent plats)', () => {
    const r = spanRange([49_943.94, 49_985.24, 49_984.54], 49_943.94);
    expect(r.suggestedMax - r.suggestedMin).toBeCloseTo(998.88, 1);
    expect(r.suggestedMin).toBeLessThan(49_943.94);
    expect(spanRange([48_000, 53_000], 50_000)).toEqual({ suggestedMin: 48_000, suggestedMax: 53_000 });
  });
});

/** Compte de 50K relié à un plan : règle et suivi (`metrics.drawdown`) comme les renvoie l'API. */
const planAccount = (rule: Record<string, unknown>, dd: Record<string, unknown> = {}, planId: string | null = 'apex-eod-50k') =>
  account(
    {
      startingBalance: 50_000,
      drawdown: {
        source: 'plan', maxDrawdown: 2_000, floor: 48_000, margin: 2_000, pct: 1, breached: false,
        rule: { kind: 'trailing_eod', locksAt: null, lockedFloor: null, locked: false, peakBalance: null, ...rule },
        ...dd,
      },
    },
    planId,
  );

describe('drawdown d’un compte relié à un plan : limite du plan + marge', () => {
  /** Dernier point : distance courbe → limite = marge de l'en-tête = marge du suivi du compte. */
  const lastGap = (f: ReturnType<typeof floorSeries>) => f.values[f.values.length - 1] - f.limit;

  it('sans plan relié : pas de limite (drawdown classique depuis le plus haut)', () => {
    expect(planFloorOf(planAccount({}, {}, null))).toBeNull();
    expect(planFloorOf(account({ drawdown: { source: 'manual', maxDrawdown: 2_000 } }))).toBeNull();
    expect(planFloorOf(account({ ...planAccount({}).metrics, drawdownUnconfirmed: true }))).toBeNull();
    expect(planFloorOf(null)).toBeNull();
  });

  it('plan statique : la courbe est le solde, plafonnée au solde initial', () => {
    const plan = planFloorOf(planAccount({ kind: 'static' }, { floor: 48_000, margin: 1_200 }))!;
    const f = floorSeries([pt('2026-10-01', 600), pt('2026-10-02', -800)], 50_000, plan);
    expect(f.limit).toBe(48_000);
    expect(f.top).toBe(50_000);
    expect(f.values).toEqual([50_000, 50_000, 49_200]); // 50 600 plafonné à 50 000
    expect(f.minMarginIdx).toBe(2);
    expect(lastGap(f)).toBe(plan.margin);
  });

  it('suiveur EOD (Apex 50K) : baisse depuis le plus haut, reportée sous 50 000', () => {
    // Plus haut 51 275.47 → plancher 49 275.47 ; solde 51 078.38 → marge 1 802.91 (suivi du compte).
    const plan = planFloorOf(planAccount({ peakBalance: 51_275.47 }, { floor: 49_275.47, margin: 1_802.91 }))!;
    const f = floorSeries([pt('2026-10-01', 1_275.47), pt('2026-10-14', 450), pt('2026-10-20', 1_078.38)], 50_000, plan);
    expect(f.values[0]).toBe(50_000); // « Départ » au solde initial
    expect(f.values[1]).toBeCloseTo(50_000); // nouveau plus haut : marge pleine
    expect(f.values[2]).toBeCloseTo(49_174.53); // 825.47 sous le plus haut
    expect(f.margin[2]).toBeCloseTo(1_174.53);
    expect(f.minMarginIdx).toBe(2);
    expect(lastGap(f)).toBeCloseTo(1_802.91);
  });

  it('la courbe touche la limite exactement quand le solde touche le plancher', () => {
    const plan = planFloorOf(planAccount({ peakBalance: 50_500 }, { floor: 48_500, margin: 0, breached: true }))!;
    const f = floorSeries([pt('2026-10-01', 500), pt('2026-10-02', -1_500)], 50_000, plan);
    expect(f.floor[2]).toBe(48_500);
    expect(f.balance[2]).toBe(48_500);
    expect(f.values[2]).toBe(f.limit);
  });

  it('plancher gelé : figé dès que le solde atteint le seuil, la marge peut dépasser le drawdown', () => {
    const plan = planFloorOf(planAccount({ locksAt: 52_100, lockedFloor: 50_100, locked: true }, { floor: 50_100, margin: 1_900 }))!;
    expect(plan.peakProfit).toBeNull();
    const f = floorSeries([pt('2026-10-01', 1_700), pt('2026-10-02', 2_400), pt('2026-10-03', 2_000)], 50_000, plan);
    expect(f.floor).toEqual([48_000, 49_700, 50_100, 50_100]);
    expect(f.values).toEqual([50_000, 50_000, 50_000, 49_900]); // marge 2 300 plafonnée, puis 1 900
    expect(lastGap(f)).toBe(1_900);
  });

  it('compte Funded (Tradeify 50K) : plancher suiveur depuis le plus haut d’avant la période', () => {
    // 15/09 +105.12 (plus haut), 17/09 -161.18 avant la fenêtre ; solde 49 985.24, plancher 48 105.12.
    const plan = planFloorOf(planAccount({ peakBalance: 50_105.12 }, { floor: 48_105.12, margin: 1_880.12 }, 'tradeify-select-flex-50k'))!;
    const f = floorSeries(
      [pt('2026-09-29', 40.6), pt('2026-10-02', 31.64), pt('2026-10-06', 41.3)],
      49_943.94, plan, { pnl: -56.06, peak: 105.12, count: 6 },
    );
    expect(f.floor.every((v) => Math.abs(v - 48_105.12) < 0.01)).toBe(true);
    expect(f.margin[0]).toBeCloseTo(1_838.82); // début de la fenêtre, déjà sous le plus haut du 15/09
    expect(lastGap(f)).toBeCloseTo(1_880.12);
    expect(f.minMarginIdx).toBe(0);
  });
});
