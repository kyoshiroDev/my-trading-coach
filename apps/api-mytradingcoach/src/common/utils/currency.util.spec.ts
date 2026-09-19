import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_CURRENCIES,
  DEFAULT_ACCOUNT_CURRENCY,
  commonCurrency,
  formatMoney,
  isAccountCurrency,
  normalizeCurrencyCode,
} from '@mtc/shared';

/** Devise = propriété du compte, jamais de conversion (PROMPT-214). Source unique front + back. */
describe('devises de compte (@mtc/shared)', () => {
  it('liste unique USD / USDT / EUR, USD par défaut', () => {
    expect(ACCOUNT_CURRENCIES).toEqual(['USD', 'USDT', 'EUR']);
    expect(DEFAULT_ACCOUNT_CURRENCY).toBe('USD');
    expect(isAccountCurrency('USDT')).toBe(true);
    expect(isAccountCurrency('GBP')).toBe(false);
  });

  it('normalise la saisie', () => {
    expect(normalizeCurrencyCode(' usdt ')).toBe('USDT');
    expect(normalizeCurrencyCode('')).toBeNull();
    expect(normalizeCurrencyCode(42)).toBeNull();
  });

  it('devise commune : unique, null si mêlées, USD si aucun compte ou devise vide', () => {
    expect(commonCurrency(['USD', 'usd'])).toBe('USD');
    expect(commonCurrency(['USD', 'EUR'])).toBeNull();
    expect(commonCurrency([])).toBe('USD');
    expect(commonCurrency(['', null, 'USD'])).toBe('USD');
  });
});

describe('formatMoney : montant tel quel, jamais converti', () => {
  it('USD et EUR : symbole avant le montant', () => {
    expect(formatMoney(-41.1, 'USD')).toBe('-$41.10');
    expect(formatMoney(100, 'EUR')).toBe('+€100.00');
  });

  it('USDT (et tout autre code) : code après le montant', () => {
    expect(formatMoney(10, 'USDT')).toBe('+10.00 USDT');
    expect(formatMoney(-1234, 'USDT', { decimals: 0, compact: true })).toBe('-1.2k USDT');
  });

  it('devise inconnue ou mêlée (null) : aucun symbole deviné', () => {
    expect(formatMoney(24, null, { decimals: 0 })).toBe('+24');
  });

  it('options : sans signe, sans symbole', () => {
    expect(formatMoney(12.3, 'USD', { sign: false })).toBe('$12.30');
    expect(formatMoney(24, 'USD', { decimals: 0, symbol: false })).toBe('+24');
  });
});
