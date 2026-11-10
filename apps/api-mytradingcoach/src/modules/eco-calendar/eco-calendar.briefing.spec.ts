import { describe, it, expect } from 'vitest';
import type { EcoEvent } from '@mtc/shared';
import { assetCurrencies, buildBriefing } from './eco-calendar.briefing';
import { findForbiddenTerms } from '../../common/ai-text-guard/ai-text-guard';

const ev = (p: Partial<EcoEvent>): EcoEvent => ({
  time: '14:30', name: 'Non Farm Payrolls', impact: 'high', country: 'US', currency: 'USD',
  actual: null, estimate: 180, previous: 150, isReleased: false, unit: 'K', status: 'upcoming', ...p,
});

describe('eco-calendar.briefing', () => {
  it.each([
    ['NQ', ['USD']],
    ['MNQZ6', ['USD']],
    ['MNQ 12-26', ['USD']],
    ['EUR/USD', ['EUR', 'USD']],
    ['XAUUSD', ['USD']],
    ['BTC/USDT', ['USD']],
    ['6E', ['EUR', 'USD']],
    ['GER40', ['EUR']],
    ['AAPL', []],
  ])('assetCurrencies(%s) = %j', (asset, ccy) => {
    expect(assetCurrencies(asset)).toEqual(ccy);
  });

  it('une ligne factuelle par annonce forte, par heure ; actifs concernés pour CE trader', () => {
    const lines = buildBriefing(
      [
        ev({ time: '16:00', name: 'ISM Services PMI', impact: 'medium' }),
        ev({}),
        ev({ time: '10:00', name: 'CPI YoY', currency: 'EUR', country: 'EU', estimate: null, previous: 2.1, unit: '%' }),
      ],
      ['NQ', 'EUR/USD', 'AAPL'],
    );
    expect(lines.map((l) => l.text)).toEqual([
      '10:00 · CPI YoY (EUR) · pas de consensus publié · précédent 2,1% · concerne EUR/USD.',
      '14:30 · Non Farm Payrolls (USD) · prévision 180K · précédent 150K · concerne NQ, EUR/USD.',
    ]);
  });

  it('intervention sans chiffre, et aucun actif concerné', () => {
    const [line] = buildBriefing(
      [ev({ name: 'BoJ Press Conference', currency: 'JPY', hasResult: false, estimate: null, previous: null })],
      ['NQ'],
    );
    expect(line.text).toBe(
      '14:30 · BoJ Press Conference (JPY) · intervention, pas de chiffre attendu · aucun de tes actifs récents dans cette devise.',
    );
    expect(line.assets).toEqual([]);
  });

  it('aucune direction ni conseil : le garde-fou de conformité ne détecte rien', () => {
    const lines = buildBriefing([ev({}), ev({ name: 'Fed Interest Rate Decision', time: '20:00' })], ['NQ', 'ES']);
    for (const l of lines) {
      expect(findForbiddenTerms(l.text)).toEqual([]);
      expect(l.text).not.toMatch(/hauss|baiss|achat|vente|achète|vends|bull|bear/i);
    }
  });
});
