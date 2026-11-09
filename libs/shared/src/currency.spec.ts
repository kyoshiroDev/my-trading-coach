import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_CURRENCIES,
  DEFAULT_ACCOUNT_CURRENCY,
  commonCurrency,
  formatMoney,
  isAccountCurrency,
  normalizeCurrencyCode,
} from './currency';

/** Devise = propriété du compte, jamais de conversion. Source unique front + back. */
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

  it('un montant affiché à zéro ne porte jamais de « - »', () => {
    expect(formatMoney(-0.004, 'USD')).toBe('+$0.00');
    expect(formatMoney(-0.004, 'USD', { decimals: 0, sign: false })).toBe('$0.00');
    expect(formatMoney(0, 'USD', { decimals: 0 })).toBe('+$0');
  });

  // Valeurs fractionnaires du compte Lucid (solde réel 49 911,50, -0,80 $ de frais le 9/11).
  it.each([
    // [valeur, 0 décimale avec signe, 0 décimale sans signe, 2 décimales]
    [-0.8, '-$0.80', '-$0.80', '-$0.80'],
    [-0.5, '-$0.50', '-$0.50', '-$0.50'],
    [49911.5, '+$49,912', '$49,912', '+$49,911.50'],
    [49999.2, '+$49,999', '$49,999', '+$49,999.20'],
    [0.49, '+$0.49', '$0.49', '+$0.49'],
    [-0.01, '-$0.01', '-$0.01', '-$0.01'],
  ])('%d : jamais un arrondi qui grossit une perte, centimes sous 1 $', (v, zeroSigned, zeroPlain, two) => {
    expect(formatMoney(v, 'USD', { decimals: 0 })).toBe(zeroSigned);
    expect(formatMoney(v, 'USD', { decimals: 0, sign: false })).toBe(zeroPlain);
    expect(formatMoney(v, 'USD')).toBe(two);
  });

  it('au-delà de 1 $ : arrondi au plus proche, demi vers l\'extérieur (symétrique)', () => {
    expect(formatMoney(-1.5, 'USD', { decimals: 0 })).toBe('-$2');
    expect(formatMoney(1.5, 'USD', { decimals: 0 })).toBe('+$2');
    expect(formatMoney(-1.4, 'USD', { decimals: 0 })).toBe('-$1');
    expect(formatMoney(-0.8, 'USDT', { decimals: 0 })).toBe('-0.80 USDT');
    expect(formatMoney(-0.8, 'USD', { decimals: 0, compact: true, symbol: false })).toBe('-0.80');
  });

  it('options : sans signe, sans symbole', () => {
    expect(formatMoney(12.3, 'USD', { sign: false })).toBe('$12.30');
    expect(formatMoney(24, 'USD', { decimals: 0, symbol: false })).toBe('+24');
  });
});
