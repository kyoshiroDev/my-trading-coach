import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { UserScopedReset } from './user-scoped-reset';
import { SelectedAccountStore } from '../stores/selected-account.store';
import { TradesStore } from '../stores/trades.store';
import { SetupsStore } from '../stores/setups.store';
import type { TradingAccount } from '../api/accounts.api';
import type { Trade } from '../api/trades.api';
import type { Setup } from '../api/setups.api';

/**
 * Logout : les stores propres à l'utilisateur sont vidés sans que `AuthService` les importe
 * (sinon ils partent dans le bundle initial de /register, #692).
 */
describe('UserScopedReset — purge des stores au logout', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'login', children: [] }])],
    });
  }

  it('logout vide les comptes, les trades et les setups déjà chargés', () => {
    setup();
    const accounts = TestBed.inject(SelectedAccountStore);
    const trades = TestBed.inject(TradesStore);
    const setups = TestBed.inject(SetupsStore);
    accounts.accounts.set([{ id: 'a' } as TradingAccount]);
    accounts.selectedAccountId.set('a');
    trades.trades.set([{ id: 't' } as Trade]);
    setups.setups.set([{ id: 's' } as Setup]);

    TestBed.inject(AuthService).logout();

    expect(accounts.accounts()).toEqual([]);
    expect(accounts.selectedAccountId()).toBe('all');
    expect(trades.trades()).toEqual([]);
    expect(setups.setups()).toEqual([]);
  });

  it('chaque logout rappelle les remises à zéro inscrites', () => {
    setup();
    let calls = 0;
    TestBed.inject(UserScopedReset).register(() => calls++);
    const auth = TestBed.inject(AuthService);
    auth.logout();
    auth.logout();
    expect(calls).toBe(2);
  });
});
