import { describe, expect, it } from 'vitest';
import { demoOriginFromSearch, demoRegisterParams } from './demo-cta';

describe('demoOriginFromSearch', () => {
  it('garde les UTM et le code parrain de l’arrivée', () => {
    expect(
      demoOriginFromSearch('?utm_source=ninjatrader&utm_medium=newsletter&utm_campaign=newsletter-novembre-2026&ref=ABC-12'),
    ).toEqual({ utm_source: 'ninjatrader', utm_medium: 'newsletter', utm_campaign: 'newsletter-novembre-2026', ref: 'ABC-12' });
  });

  it('ignore un parrain mal formé et les valeurs vides, tronque à 100 caractères', () => {
    const o = demoOriginFromSearch(`?utm_source=${'x'.repeat(150)}&utm_medium=&ref=<script>`);
    expect(o).toEqual({ utm_source: 'x'.repeat(100) });
  });
});

describe('demoRegisterParams', () => {
  it('visite de la newsletter : UTM gardés, source=demo, pas d’utm_source=demo', () => {
    expect(
      demoRegisterParams({ utm_source: 'ninjatrader', utm_medium: 'newsletter', utm_campaign: 'newsletter-novembre-2026', ref: 'ABC' }),
    ).toEqual({
      utm_source: 'ninjatrader',
      utm_medium: 'newsletter',
      utm_campaign: 'newsletter-novembre-2026',
      ref: 'ABC',
      source: 'demo',
    });
  });

  it('visite sans UTM : utm_source=demo pour que l’inscrit apparaisse sous la source demo', () => {
    expect(demoRegisterParams({})).toEqual({ utm_source: 'demo', source: 'demo' });
  });
});
