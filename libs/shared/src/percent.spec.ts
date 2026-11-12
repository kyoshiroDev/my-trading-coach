import { describe, it, expect } from 'vitest';
import { formatPercent } from './percent';

describe('formatPercent — un seul format de pourcentage (#947)', () => {
  it('entier arrondi, « % » collé', () => {
    expect(formatPercent(62.5)).toBe('63%');
    expect(formatPercent(66.66666666666667)).toBe('67%');
    expect(formatPercent(100)).toBe('100%');
  });
  it('0 → « 0% », inconnu → « — », jamais « -0% »', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(NaN)).toBe('—');
    expect(formatPercent(Infinity)).toBe('—');
    expect(formatPercent(-0.3)).toBe('0%');
    expect(formatPercent(-0.03, { decimals: 1, sign: true })).toBe('0.0%');
  });
  it('variation : décimales et signe', () => {
    expect(formatPercent(0.42, { decimals: 1, sign: true })).toBe('+0.4%');
    expect(formatPercent(-1.25, { decimals: 1, sign: true })).toBe('-1.3%');
  });
});
