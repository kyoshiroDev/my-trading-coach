import { describe, it, expect } from 'vitest';
import {
  buildCoachInsights,
  buildEmotionsDonut,
  buildEquityGlow,
  buildPlBuckets,
  emotionShares,
  plGranularityFor,
  setupsDonutFromTrades,
  sparkPath,
  topAssetBars,
} from './dashboard-charts.util';
import { AnalyticsSummary } from '../../core/api/analytics.api';

const summary = (over: Partial<AnalyticsSummary> = {}): AnalyticsSummary =>
  ({ winRate: 60, totalPnl: 100, totalTrades: 10, maxDrawdown: 0, profitFactor: 2, streak: 0,
     topSession: '', topSessionWinRate: 0, topHour: '', ...over }) as AnalyticsSummary;

describe('sparkPath / buildEquityGlow', () => {
  it('moins de 2 points → rien à tracer', () => {
    expect(sparkPath([5]).line).toBe('');
    expect(buildEquityGlow([5], true)).toBeNull();
  });

  it('2 points → trait du bas-gauche au haut-droite, point final au bout', () => {
    const p = sparkPath([0, 10]);
    expect(p.line).toBe('M0.0,40.0 L72.0,2.0');
    expect([p.cx, p.cy]).toEqual([72, 2]);
  });

  it('couleur de la courbe selon le signe du P&L', () => {
    expect(buildEquityGlow([0, 1], true)?.color).toBe('var(--green)');
    expect(buildEquityGlow([0, 1], false)?.color).toBe('var(--red)');
  });
});

describe('P&L par période', () => {
  it('granularité pilotée par la durée : jour ≤ 31 j, semaine ≤ ~31 sem., mois au-delà', () => {
    const to = new Date('2026-06-30T12:00:00');
    const back = (d: number) => new Date(to.getTime() - d * 86_400_000);
    expect(plGranularityFor({ from: back(30), to })).toBe('day');
    expect(plGranularityFor({ from: back(90), to })).toBe('week');
    expect(plGranularityFor({ from: null, to })).toBe('month');
  });

  it('semaines ISO : jours d une même semaine additionnés, semaines vides à plat', () => {
    const buckets = buildPlBuckets(
      [{ date: '2026-03-03', pnl: 100 }, { date: '2026-03-05', pnl: -40 }],
      'week',
      { from: new Date('2026-03-02T00:00:00'), to: new Date('2026-03-15T18:00:00') },
    );
    expect(buckets.map((b) => b.key)).toEqual(['2026-03-02', '2026-03-09']);
    expect(buckets[0]).toMatchObject({ pnl: 60, traded: true, pos: true, label: '+60', barPct: 47 });
    expect(buckets[1]).toMatchObject({ pnl: 0, traded: false, barPct: 0, label: '' });
  });
});

describe('donuts', () => {
  it('répartition FREE par setup : centre = setup dominant', () => {
    const t = (setupId: string, title: string) => ({ setupId, setup: { title, color: '#fff' } });
    const d = setupsDonutFromTrades([t('a', 'Breakout'), t('a', 'Breakout'), t('a', 'Breakout'), t('b', 'Range')]);
    expect(d).toMatchObject({ centerValue: '75%', centerLabel: 'Breakout' });
    expect(d?.legend.map((l) => l.pct)).toEqual([75, 25]);
  });

  it('émotion effective prioritaire, émotions absentes exclues, top 4', () => {
    const shares = emotionShares([
      { effectiveEmotion: 'FOCUSED', emotion: 'REVENGE' },
      { emotion: 'FOCUSED' },
      { emotion: 'FEAR' },
      { emotion: null },
    ]);
    expect(shares).toEqual([{ emotion: 'FOCUSED', pct: 67 }, { emotion: 'FEAR', pct: 33 }]);
    expect(buildEmotionsDonut(shares)?.centerValue).toBe('67%');
    expect(buildEmotionsDonut([])).toBeNull();
  });
});

describe('topAssetBars', () => {
  it('5 actifs max, barre proportionnelle au plus gros P&L absolu', () => {
    const mk = (asset: string, pnl: number) => ({ asset, pnl, winRate: 50, count: 1 });
    const bars = topAssetBars([mk('NQ', 200), mk('ES', -100), mk('A', 1), mk('B', 1), mk('C', 1), mk('D', 1)]);
    expect(bars).toHaveLength(5);
    expect(bars[0].barPct).toBe(100);
    expect(bars[1].barPct).toBe(50);
  });
});

describe('buildCoachInsights', () => {
  it('aucun trade → aucun insight', () => {
    expect(buildCoachInsights(summary({ totalTrades: 0 }), [], [])).toEqual([]);
    expect(buildCoachInsights(null, [], [])).toEqual([]);
  });

  it('tons dérivés des vraies données, 5 insights maximum', () => {
    const out = buildCoachInsights(
      summary({ winRate: 40, profitFactor: 0.8, streak: -4 }),
      [{ emotion: 'FOCUSED', winRate: 70, avgRR: 1.2, count: 5 }, { emotion: 'REVENGE', winRate: 10, avgRR: -0.9, count: 3 }],
      [{ setupId: 's', title: 'Breakout', color: '#fff', winRate: 60, avgRR: 1, count: 4, pnl: 10 }],
    );
    expect(out.map((i) => i.tone)).toEqual(['warn', 'bad', 'bad', 'good', 'bad']);
    expect(out).toHaveLength(5);
  });
});
