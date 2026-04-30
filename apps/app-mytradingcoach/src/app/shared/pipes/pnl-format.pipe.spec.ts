import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PnlFormatPipe } from './pnl-format.pipe';
import { UserStore } from '../../core/stores/user.store';
import { AuthService } from '../../core/auth/auth.service';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

const mockUser = (currency = 'USD', currencyRate = 1) => ({
  id: 'u1', email: 'test@test.com', name: 'Test', plan: 'FREE' as const,
  currency, currencyRate, trialEndsAt: null,
});

function makePipe(currency = 'USD', currencyRate = 1): PnlFormatPipe {
  const mockAuthService = { currentUser: signal(mockUser(currency, currencyRate)), isAuthenticated: signal(true), fetchMe: vi.fn(), setCurrentUser: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      PnlFormatPipe,
      UserStore,
      { provide: AuthService, useValue: mockAuthService },
      provideHttpClient(),
      provideRouter([]),
    ],
  });
  return TestBed.inject(PnlFormatPipe);
}

describe('PnlFormatPipe — USD (default)', () => {
  it('pnl > 0 → +$X,XXX.XX', () => {
    const pipe = makePipe();
    expect(pipe.transform(5000)).toBe('+$5,000.00');
  });

  it('pnl < 0 → -$X.XX', () => {
    const pipe = makePipe();
    expect(pipe.transform(-340)).toBe('-$340.00');
  });

  it('pnl = 0 → +$0.00', () => {
    const pipe = makePipe();
    expect(pipe.transform(0)).toBe('+$0.00');
  });

  it('pnl = null → —', () => {
    const pipe = makePipe();
    expect(pipe.transform(null)).toBe('—');
  });

  it('pnl = undefined → —', () => {
    const pipe = makePipe();
    expect(pipe.transform(undefined)).toBe('—');
  });

  it('pnl > 0 avec entry → affiche le pourcentage', () => {
    const pipe = makePipe();
    const result = pipe.transform(5000, 60000);
    expect(result).toContain('+$5,000.00');
    expect(result).toContain('%');
  });

  it('pnl < 0 avec entry → affiche le pourcentage négatif', () => {
    const pipe = makePipe();
    const result = pipe.transform(-340, 4080);
    expect(result).toContain('-$340.00');
    expect(result).toContain('%');
  });
});

describe('PnlFormatPipe — EUR (rate 0.92)', () => {
  it('100 USD → €92.00', () => {
    const pipe = makePipe('EUR', 0.92);
    expect(pipe.transform(100)).toBe('+€92.00');
  });

  it('-100 USD → -€92.00', () => {
    const pipe = makePipe('EUR', 0.92);
    expect(pipe.transform(-100)).toBe('-€92.00');
  });
});
