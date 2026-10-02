import { describe, it, expect } from 'vitest';
import { brokerBadge, normalizeBrokerName } from './broker-badge.util';

describe('brokerBadge', () => {
  it('pas de firm → pas de pastille', () => {
    expect(brokerBadge(null)).toBeNull();
    expect(brokerBadge(undefined)).toBeNull();
    expect(brokerBadge('')).toBeNull();
    expect(brokerBadge('   ')).toBeNull();
    expect(brokerBadge('—')).toBeNull();
  });

  it('initiales des mots significatifs, en majuscules', () => {
    expect(brokerBadge('Apex Trader Funding')?.initials).toBe('AP');
    expect(brokerBadge('Lucid Trading')?.initials).toBe('LU');
    expect(brokerBadge('FTMO')?.initials).toBe('FT');
    expect(brokerBadge('Take Profit Trader')?.initials).toBe('TP');
    expect(brokerBadge('My Funded Futures')?.initials).toBe('MF');
    expect(brokerBadge('Topstep')?.initials).toBe('TO');
    expect(brokerBadge('X')?.initials).toBe('X');
  });

  it('nom entièrement générique : on garde ses mots plutôt que rien', () => {
    expect(brokerBadge('Trading Funding')?.initials).toBe('TF');
  });

  it('même firm, saisie différente → même pastille', () => {
    const ref = brokerBadge('Apex Trader Funding');
    expect(brokerBadge('apex trader funding')).toEqual(ref);
    expect(brokerBadge('  APEX   Trader-Funding. ')).toEqual(ref);
    expect(brokerBadge('Lucid Tràding')).toEqual(brokerBadge('Lucid Trading'));
  });

  it('couleur déterministe, prise dans la palette, jamais rouge ni verte', () => {
    const names = ['Apex Trader Funding', 'Lucid Trading', 'FTMO', 'Topstep', 'Tradeify', 'Take Profit Trader', 'Bulenox', 'Alpha Futures'];
    for (const n of names) {
      const b = brokerBadge(n)!;
      expect(brokerBadge(n)!.color).toBe(b.color);
      expect(b.color).toMatch(/^var\(--(blue|purple|cyan|yellow|blue-bright|purple-bright)\)$/);
    }
    // Des firms différentes ne tombent pas toutes sur la même teinte.
    expect(new Set(names.map((n) => brokerBadge(n)!.color)).size).toBeGreaterThan(2);
  });

  it('normalizeBrokerName', () => {
    expect(normalizeBrokerName('  Éval   Prop-Firm!! ')).toBe('eval prop firm');
  });
});
