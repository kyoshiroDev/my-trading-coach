import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PnlFormatPipe } from './pnl-format.pipe';
import { MoneyService } from '../../core/services/money.service';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { formatMoney } from '../../core/utils/money';

/** La devise vient du compte affiché (SelectedAccountStore.displayCurrency), jamais d'un taux. */
function makePipe(currency: string | null = 'USD'): PnlFormatPipe {
  TestBed.configureTestingModule({
    providers: [
      PnlFormatPipe,
      MoneyService,
      { provide: SelectedAccountStore, useValue: { displayCurrency: signal(currency) } },
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

describe('PnlFormatPipe — devise native, aucune conversion (PROMPT-213)', () => {
  it('compte en EUR → le montant tel quel avec €, sans taux', () => {
    const pipe = makePipe('EUR');
    expect(pipe.transform(100)).toBe('+€100.00');
    expect(pipe.transform(-100)).toBe('-€100.00');
  });

  it('comptes de devises mêlées (null) → aucun symbole deviné', () => {
    expect(makePipe(null).transform(41.1)).toBe('+41.10');
  });
});

describe('formatMoney', () => {
  it('compact, sans symbole, autres codes', () => {
    expect(formatMoney(-1234, 'USD', { decimals: 0, compact: true })).toBe('-$1.2k');
    expect(formatMoney(24, 'USD', { decimals: 0, symbol: false })).toBe('+24');
    expect(formatMoney(12.3, 'USD', { sign: false })).toBe('$12.30');
    expect(formatMoney(10, 'chf')).toBe('+CHF 10.00');
  });
});
