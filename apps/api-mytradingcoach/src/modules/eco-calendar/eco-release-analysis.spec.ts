import { describe, it, expect } from 'vitest';
import { assetsSignature, pickReleaseAnalyses, stripPeriod, withDisplayNames } from './eco-release-analysis';

const row = (eventName: string, assetsKey: string, interpretation: string, at = '2026-11-06T14:00:00Z') => ({
  eventName, assetsKey, createdAt: new Date(at),
  analysisJson: JSON.stringify({
    interpretation,
    assetSentiments: [
      { asset: 'MNQ', sentiment: 'bear', shortReason: 'a' },
      { asset: 'EURUSD', sentiment: 'bull', shortReason: 'b' },
    ],
  }),
});

describe('analyses des annonces publiées (jour passé)', () => {
  it('nom sans suffixe de période et signature d’actifs normalisée', () => {
    expect(stripPeriod('Nonfarm Payrolls (Oct)')).toBe('Nonfarm Payrolls');
    expect(assetsSignature([' mnq', 'ES'])).toBe('ES,MNQ');
    expect(assetsSignature([])).toBe('none');
  });

  it('la signature de l’utilisateur d’abord, telle quelle', () => {
    const out = pickReleaseAnalyses([row('NFP', 'EURUSD', 'autre'), row('NFP', 'ES,MNQ', 'la mienne')], ['MNQ', 'ES']);
    expect(out['NFP'].interpretation).toBe('la mienne');
    expect(out['NFP'].assetSentiments).toHaveLength(2);
  });

  it('sinon la plus récente d’une autre signature, réduite aux actifs qu’il trade', () => {
    const out = pickReleaseAnalyses(
      [row('NFP', 'A', 'ancienne', '2026-11-06T13:00:00Z'), row('NFP', 'B', 'récente', '2026-11-06T15:00:00Z')],
      ['MNQ'],
    );
    expect(out['NFP'].interpretation).toBe('récente');
    expect(out['NFP'].assetSentiments.map((s) => s.asset)).toEqual(['MNQ']);
  });

  it('JSON illisible → annonce absente', () => {
    expect(pickReleaseAnalyses([{ eventName: 'X', assetsKey: 'none', analysisJson: '{', createdAt: new Date() }], [])).toEqual({});
  });

  it('l’analyse est aussi rendue sous le libellé français affiché (sans suffixe de période)', () => {
    const a = { interpretation: 'i', assetSentiments: [] };
    const out = withDisplayNames({ 'Nonfarm Payrolls': a }, [{ name: 'Nonfarm Payrolls (Oct)', nameFr: 'Créations d’emplois non agricoles (NFP)' }, { name: 'X', nameFr: null }]);
    expect(out['Créations d’emplois non agricoles']).toBe(a);
    expect(out['Nonfarm Payrolls']).toBe(a);
  });
});
