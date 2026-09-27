import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PnlFormatPipe } from './pnl-format.pipe';
import { MoneyService } from '../../core/services/money.service';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';

/**
 * La devise vient du COMPTE (SelectedAccountStore), jamais d'un taux.
 * `accounts` : devise par id de compte, pour les lignes de trades.
 */
function makePipe(currency: string | null = 'USD', accounts: Record<string, string> = {}): PnlFormatPipe {
  TestBed.configureTestingModule({
    providers: [
      PnlFormatPipe,
      MoneyService,
      {
        provide: SelectedAccountStore,
        useValue: {
          displayCurrency: signal(currency),
          selectedAccountId: signal('all'),
          currencyOf: (id: string) => accounts[id],
        },
      },
    ],
  });
  return TestBed.inject(PnlFormatPipe);
}

describe('PnlFormatPipe — compte en USD', () => {
  it('pnl > 0 → +$X,XXX.XX', () => {
    expect(makePipe().transform(5000)).toBe('+$5,000.00');
  });

  it('pnl < 0 → -$X.XX', () => {
    expect(makePipe().transform(-340)).toBe('-$340.00');
  });

  it('pnl = 0 → +$0.00', () => {
    expect(makePipe().transform(0)).toBe('+$0.00');
  });

  it('pnl = null / undefined → -', () => {
    const pipe = makePipe();
    expect(pipe.transform(null)).toBe('-');
    expect(pipe.transform(undefined)).toBe('-');
  });

  it('avec entry → affiche le pourcentage', () => {
    const result = makePipe().transform(-340, 4080);
    expect(result).toContain('-$340.00');
    expect(result).toContain('%');
  });
});

describe('PnlFormatPipe — devise native du compte, aucune conversion', () => {
  it('compte en EUR → le montant tel quel avec €', () => {
    const pipe = makePipe('EUR');
    expect(pipe.transform(100)).toBe('+€100.00');
    expect(pipe.transform(-100)).toBe('-€100.00');
  });

  it('compte en USDT → code après le montant', () => {
    expect(makePipe('USDT').transform(10)).toBe('+10.00 USDT');
  });

  it('comptes de devises mêlées (null) → aucun symbole deviné', () => {
    expect(makePipe(null).transform(41.1)).toBe('+41.10');
  });

  it('ligne de trade → devise de SON compte, même quand l’écran est en devises mêlées', () => {
    const pipe = makePipe(null, { eur: 'EUR', usdt: 'USDT' });
    expect(pipe.transform(12, null, 'eur')).toBe('+€12.00');
    expect(pipe.transform(-3, null, 'usdt')).toBe('-3.00 USDT');
  });
});
