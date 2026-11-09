import { describe, it, expect } from 'vitest';
import {
  buildCoachInsights,
  buildEmotionsDonut,
  buildPlBuckets,
  buildTradeRows,
  emotionShares,
  plGranularityFor,
  setupsDonutFromStats,
  setupsDonutFromTrades,
  sparkPath,
  tradeCountBars,
  topAssetBars,
} from './dashboard-charts.util';
import { AnalyticsSummary } from '../../core/api/analytics.api';
import { Trade } from '../../core/stores/trades.store';

const summary = (over: Partial<AnalyticsSummary> = {}): AnalyticsSummary =>
  ({ winRate: 60, totalPnl: 100, totalTrades: 10, maxDrawdown: 0, profitFactor: 2, streak: 0,
     topSession: '', topSessionWinRate: 0, topHour: '', ...over }) as AnalyticsSummary;

describe('sparkPath', () => {
  it('moins de 2 points → rien à tracer', () => {
    expect(sparkPath([5]).line).toBe('');
  });

  it('2 points → trait du bas-gauche au haut-droite, point final au bout', () => {
    const p = sparkPath([0, 10]);
    expect(p.line).toBe('M0.0,40.0 L72.0,2.0');
    expect([p.cx, p.cy]).toEqual([72, 2]);
  });

  it('drawdown (sous l’eau) : 0 en haut, creux en bas, aire remplie depuis le haut', () => {
    // Cas réel : 0 ; −268 ; −535,5 ; −88,5 → la ligne DESCEND jusqu'au creux puis remonte.
    const p = sparkPath([0, -268, -535.5, -88.5], 72, 42, true);
    expect(p.line).toBe('M0.0,2.0 L24.0,21.0 L48.0,40.0 L72.0,8.3');
    expect(p.area.endsWith('L72,0 L0,0 Z')).toBe(true);
  });

  it('drawdown resté à 0 : ligne plate en haut (pas en bas)', () => {
    expect(sparkPath([0, 0, 0], 72, 42, true).line).toBe('M0.0,2.0 L36.0,2.0 L72.0,2.0');
  });
});

describe('tradeCountBars', () => {
  it('trades par jour tradé, ordre chronologique, hauteur relative au plus gros jour', () => {
    const bars = tradeCountBars([
      { date: '2026-11-09', tradesCount: 2 },
      { date: '2026-11-06', tradesCount: 3 },
      { date: '2026-11-03', tradesCount: 1 },
      { date: '2026-11-04', tradesCount: 0 },
    ]);
    expect(bars).toEqual([
      { date: '2026-11-03', count: 1, pct: 33, label: '3 nov. : 1 trade' },
      { date: '2026-11-06', count: 3, pct: 100, label: '6 nov. : 3 trades' },
      { date: '2026-11-09', count: 2, pct: 67, label: '9 nov. : 2 trades' },
    ]);
  });

  it('garde les derniers jours seulement, aucune donnée → aucune barre', () => {
    const days = Array.from({ length: 20 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, tradesCount: 1 }));
    expect(tradeCountBars(days).map((b) => b.date)).toEqual(days.slice(-14).map((d) => d.date));
    expect(tradeCountBars([])).toEqual([]);
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
    // Centre = part du setup dominant, comme la légende : pas de libellé « Win rate ».
    expect(d?.centerKicker).toBeUndefined();
    expect(d?.legend.map((l) => l.pct)).toEqual([75, 25]);
  });

  it('répartition Premium : centre annoncé « Win rate » (40 % de réussite, 100 % des trades en légende)', () => {
    const d = setupsDonutFromStats([
      { setupId: 's', title: 'Sans setup', color: '#888', winRate: 40, avgRR: null, count: 5, pnl: 1064.4 },
    ]);
    expect(d).toMatchObject({ centerKicker: 'Win rate', centerValue: '40%', centerLabel: 'Sans setup' });
    expect(d?.legend).toEqual([{ label: 'Sans setup', color: '#888', pct: 100 }]);
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

describe('buildTradeRows (historique des trades, #655)', () => {
  const trade = (pnl: number | null, commission: number | null = null): Trade =>
    ({ id: String(pnl), pnl, commission, exit: pnl === null ? null : 1 }) as Trade;

  it('trade ouvert : ni WIN ni LOSS, pas de P&L %', () => {
    const [row] = buildTradeRows([trade(null)], 50_000);
    expect(row.outcome).toBe('open');
    expect(row.pnl).toBeNull();
    expect(row.pct).toBeNull();
  });

  it('break-even : net exactement nul', () => {
    const [row] = buildTradeRows([trade(2, 2)], 50_000);
    expect(row.outcome).toBe('breakeven');
    expect(row.pct).toBe(0);
  });

  it('gagnant : classé sur le net, P&L % sur le capital', () => {
    const [row] = buildTradeRows([trade(100, 0)], 50_000);
    expect(row.outcome).toBe('win');
    expect(row.pnl).toBe(100);
    expect(row.pct).toBeCloseTo(0.2);
  });

  it('perdant : un brut positif mangé par les frais est une perte', () => {
    const [row] = buildTradeRows([trade(1, 1.9)], 50_000);
    expect(row.outcome).toBe('loss');
    expect(row.pnl).toBe(-0.9);
  });

  it('capital inconnu : pas de P&L %, le classement reste', () => {
    const [row] = buildTradeRows([trade(100)], 0);
    expect(row.outcome).toBe('win');
    expect(row.pct).toBeNull();
  });
});
