import { describe, it, expect } from 'vitest';
import { DataAgent, TradeSummaryInput } from './data.agent';

const base = (over: Partial<TradeSummaryInput> = {}): TradeSummaryInput => ({
  asset: 'NQ',
  side: 'LONG',
  pnl: 100,
  emotion: 'CONFIDENT',
  setup: 'BREAKOUT',
  session: 'NEW_YORK',
  tradedAt: new Date('2026-01-01T10:00:00Z'),
  riskReward: 2,
  timeframe: '5m',
  notes: null,
  ...over,
});

describe('DataAgent.buildTradesSummary', () => {
  const agent = new DataAgent();

  it('calcule le R:R moyen global', () => {
    const out = agent.buildTradesSummary([
      base({ riskReward: 1 }),
      base({ riskReward: 3 }),
    ]);
    expect(out).toContain('R:R moyen: 2.00');
  });

  it("affiche n/a si aucun riskReward (incite à renseigner SL/TP)", () => {
    const out = agent.buildTradesSummary([
      base({ riskReward: null }),
      base({ riskReward: null }),
    ]);
    expect(out).toContain("R:R moyen: n/a (renseigne SL/TP pour l'activer)");
  });

  it('calcule le R:R moyen par setup', () => {
    const out = agent.buildTradesSummary([
      base({ setup: 'BREAKOUT', riskReward: 2 }),
      base({ setup: 'BREAKOUT', riskReward: 1 }), // moyenne 1.5
      base({ setup: 'RANGE', riskReward: 0.8 }),
    ]);
    expect(out).toContain('BREAKOUT:1.5');
    expect(out).toContain('RANGE:0.8');
  });

  it('calcule les stats par timeframe (W/L)', () => {
    const out = agent.buildTradesSummary([
      base({ timeframe: '1m', pnl: -50 }),
      base({ timeframe: '1m', pnl: -20 }),
      base({ timeframe: '15m', pnl: 80 }),
    ]);
    expect(out).toContain('Par timeframe:');
    expect(out).toContain('1m:0W/2L');
    expect(out).toContain('15m:1W/0L');
  });

  it('inclut la note du trade significatif, tronquée à 120 caractères', () => {
    const longNote = 'x'.repeat(200);
    const out = agent.buildTradesSummary([base({ pnl: 500, notes: longNote })]);
    expect(out).toContain('« ' + 'x'.repeat(120) + ' »');
    expect(out).not.toContain('x'.repeat(121));
  });

  it('ne plante pas sans note ni R:R et produit des lignes propres', () => {
    const out = agent.buildTradesSummary([
      base({ riskReward: null, timeframe: null, notes: null, pnl: 100 }),
    ]);
    expect(out).toContain('RÉSUMÉ TRADES');
    expect(out).toContain('R:R moyen: n/a');
    expect(out).toContain('Par timeframe: n/a');
    expect(out).toMatch(
      /Top 5 trades significatifs:\nNQ LONG BREAKOUT CONFIDENT \+100\$/,
    );
  });
});
