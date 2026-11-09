import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { compactMoney } from './chart-series.util';
import { distanceMoney, signedMoney } from '@app/features/accounts/autopsy/autopsy.util';
import { amount } from '@app/features/accounts/prop-firm-rules/prop-firm-rules.util';
import { AccountSelectorComponent } from '@app/shared/components/account-selector/account-selector.component';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import type { TradingAccount } from '@app/core/api/accounts.api';

/**
 * Montants fractionnaires sur les écrans qui affichent l'argent sans décimale (compte Lucid :
 * solde réel 49 911,50, -0,80 $ de frais). Règle : arrondi au plus proche (demi vers l'extérieur),
 * centimes sous 1 $, jamais un arrondi qui grossit une perte (-0,80 n'est pas « -$1 »).
 */
const CASES: [number, string, string][] = [
  // [valeur, signé, non signé]
  [-0.8, '-$0.80', '-$0.80'],
  [-0.5, '-$0.50', '-$0.50'],
  [49911.5, '+$49,912', '$49,912'],
  [49999.2, '+$49,999', '$49,999'],
  [0.49, '+$0.49', '$0.49'],
  [-0.01, '-$0.01', '-$0.01'],
];

describe('montants fractionnaires : écrans à 0 décimale', () => {
  it.each(CASES)('autopsie du compte (%d)', (v, signedStr, plain) => {
    expect(signedMoney(v, 'USD')).toBe(signedStr);
    expect(distanceMoney(v, 'USD')).toBe(plain);
  });

  it.each(CASES)('règles prop firm (%d) : montant exact, centimes compris', (v) => {
    const expected = { [-0.8]: '-$0.80', [-0.5]: '-$0.50', 49911.5: '$49,911.50', 49999.2: '$49,999.20', 0.49: '$0.49', [-0.01]: '-$0.01' };
    expect(amount(v, 'USD')).toBe(expected[v as keyof typeof expected]);
  });

  it('axes des graphiques (compactMoney)', () => {
    expect(compactMoney(-0.8, 'USD')).toBe('-$0.80');
    expect(compactMoney(-0.5, 'USD')).toBe('-$0.50');
    expect(compactMoney(0.49, 'USD')).toBe('$0.49');
    expect(compactMoney(-0.01, 'USD', true)).toBe('-$0.01');
    expect(compactMoney(49911.5, 'USD')).toBe('$49.9k');
    expect(compactMoney(49999.2, 'USD')).toBe('$50k');
    expect(compactMoney(-1.5, 'USD')).toBe('-$2');
  });

  describe('sélecteur de compte (solde)', () => {
    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [{
          provide: SelectedAccountStore,
          useValue: {
            accounts: signal<TradingAccount[]>([]),
            selectedAccountId: signal<string | 'all'>('all'),
            selected: signal<TradingAccount | null>(null),
            isLoading: signal(false),
            loaded: signal(true),
            select: () => undefined,
            load: () => undefined,
          },
        }],
      });
      TestBed.overrideComponent(AccountSelectorComponent, {
        set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
      });
    });

    it.each(CASES)('%d', (v, _signed, plain) => {
      const cmp = TestBed.createComponent(AccountSelectorComponent).componentInstance as unknown as {
        balanceFor(a: TradingAccount): string;
      };
      const account = { currency: 'USD', metrics: { currentBalance: v } } as unknown as TradingAccount;
      expect(cmp.balanceFor(account)).toBe(plain);
    });
  });
});
