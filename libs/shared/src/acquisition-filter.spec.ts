import { describe, expect, it } from 'vitest';
import { acquisitionLabel, acquisitionQueryParams, UTM_NONE } from './acquisition-filter';

describe('acquisition-filter', () => {
  it('triplet complet : null devient le marqueur « non renseigné »', () => {
    expect(acquisitionQueryParams({ source: 'instagram', medium: 'bio', campaign: null }))
      .toEqual({ source: 'instagram', medium: 'bio', campaign: UTM_NONE });
  });

  it('libellé court', () => {
    expect(acquisitionLabel({ source: 'instagram', medium: 'dm', campaign: 'louis' })).toBe('instagram · dm · louis');
    expect(acquisitionLabel({ source: null, medium: null, campaign: null })).toBe('- · - · -');
  });
});
