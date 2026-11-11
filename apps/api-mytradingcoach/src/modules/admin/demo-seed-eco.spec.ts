import { describe, it, expect } from 'vitest';
import { fakePastReleaseAnalyses } from './demo-seed';
import { pickReleaseAnalyses } from '../eco-calendar/eco-release-analysis';
import { findForbiddenTerms } from '../../common/ai-text-guard/ai-text-guard';

// Mêmes chiffres que le faux vendredi de `seedFakePastRelease`.
const events = [
  { name: 'Nonfarm Payrolls', actual: 254, estimate: 180 },
  { name: 'Unemployment Rate', actual: 4.1, estimate: 4.2 },
  { name: 'ISM Services PMI', actual: 54.9, estimate: 53.6 },
];

describe('seed démo · analyses du faux vendredi', () => {
  const analyses = fakePastReleaseAnalyses(events);

  it('format du produit : interprétation + écart calculé en code, aucun sentiment', () => {
    expect(Object.fromEntries(Object.entries(analyses).map(([k, a]) => [k, a.gap]))).toEqual({
      'Nonfarm Payrolls': 'above',
      'Unemployment Rate': 'below',
      'ISM Services PMI': 'above',
    });
    for (const a of Object.values(analyses)) expect(Object.keys(a).sort()).toEqual(['gap', 'interpretation']);
  });

  it('textes factuels : ni direction de marché ni conseil', () => {
    for (const { interpretation } of Object.values(analyses)) {
      expect(findForbiddenTerms(interpretation)).toEqual([]);
      expect(interpretation).not.toMatch(/hauss|baiss|monte|recul|achat|vente|achète|vends|bull|bear|rendement|indices actions/i);
    }
  });

  it('lues telles quelles par le calendrier des jours passés', () => {
    const rows = Object.entries(analyses).map(([eventName, a]) => ({
      eventName, assetsKey: 'NQ', analysisJson: JSON.stringify(a), createdAt: new Date('2026-11-06T15:00:00Z'),
    }));
    expect(pickReleaseAnalyses(rows, ['NQ'])).toEqual(analyses);
  });
});
