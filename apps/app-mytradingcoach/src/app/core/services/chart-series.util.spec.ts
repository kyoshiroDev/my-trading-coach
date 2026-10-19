import { describe, it, expect } from 'vitest';
import {
  START_LABEL,
  chartAriaLabel,
  compactMoney,
  drawdownSeries,
  equitySeries,
  maxDrawdownIndex,
  planDrawdownLimit,
  planObjectiveLine,
  spanDays,
  tickDate,
} from './chart-series.util';
import type { TradingAccount } from '../api/accounts.api';

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

describe('repères du plan', () => {
  it('objectif du plan sur « Tout » : niveau = objectif', () => {
    const acc = account({ progress: planProgress(3_000, 1_200) });
    expect(planObjectiveLine(acc, [pt('2025-01-06', 1_200)])).toEqual({ pnl: 3_000, amount: 3_000, source: 'plan' });
  });

  it('période partielle : le gain fait avant la période est retiré du niveau', () => {
    // Gain total 1 200, dont 400 sur la période → 800 faits avant : objectif atteint à +2 200 sur la courbe.
    const acc = account({ progress: planProgress(3_000, 1_200) });
    expect(planObjectiveLine(acc, [pt('2025-01-06', 400)])?.pnl).toBe(2_200);
  });

  it('sans plan : objectif saisi sur le compte', () => {
    const acc = account({ objective: { current: 500, target: 2_000, pct: 0.25 } }, null);
    expect(planObjectiveLine(acc, [pt('2025-01-06', 500)])).toEqual({ pnl: 2_000, amount: 2_000, source: 'manual' });
  });

  it('aucun objectif : « Tous les comptes », funded en cycle de payout, pas de données', () => {
    expect(planObjectiveLine(null, [pt('2025-01-06', 100)])).toBeNull();
    expect(planObjectiveLine(account({ progress: planProgress(1_000, 200, 'payout') }), [pt('2025-01-06', 200)])).toBeNull();
    expect(planObjectiveLine(account({ progress: planProgress(3_000, 0) }), [])).toBeNull();
  });

  it('limite de drawdown seulement pour un plan relié au montant publié', () => {
    const dd = { maxDrawdown: 2_500, source: 'plan' };
    expect(planDrawdownLimit(account({ drawdown: dd }))).toBe(2_500);
    expect(planDrawdownLimit(account({ drawdown: { ...dd, source: 'manual' } }))).toBeNull();
    expect(planDrawdownLimit(account({ drawdown: dd, drawdownUnconfirmed: true }))).toBeNull();
    expect(planDrawdownLimit(account({ drawdown: dd }, null))).toBeNull();
    expect(planDrawdownLimit(null)).toBeNull();
  });
});
