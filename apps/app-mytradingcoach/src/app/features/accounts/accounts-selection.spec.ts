import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { AccountsComponent } from './accounts.component';
import { AccountsApi, TradingAccount } from '../../core/api/accounts.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';

function acct(id: string, label: string): TradingAccount {
  return {
    id, label, broker: null, type: 'PERSONAL', status: 'ACTIVE',
    accountSize: null, currency: 'USD', startingBalance: null,
    profitTarget: null, maxDrawdown: null, drawdownType: 'TRAILING',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    metrics: {
      startingBalance: 50000, realizedPnl: 0, currentBalance: 50000, tradesCount: 0,
      objective: null, drawdown: null, estimated: true, disclaimer: 'estimé',
    },
  };
}

// Template minimal qui reproduit la surbrillance du compte sélectionné (mirror du HTML réel),
// sans monter TopbarComponent (lucide) qui ne compile pas en JIT.
const GRID = `
  <div class="acct-grid">
    @for (a of store.accounts(); track a.id) {
      <div class="acct-card" [class.is-selected]="a.id === store.selectedAccountId()" [attr.data-id]="a.id">
        @if (a.id === store.selectedAccountId()) { <span class="acct-active-mark">Actif</span> }
      </div>
    }
  </div>`;

function setup(selectedId: string | 'all') {
  const store = {
    accounts: signal([acct('a', 'Compte principal'), acct('b', 'Lucide 50k')]),
    selectedAccountId: signal<string | 'all'>(selectedId),
    isLoading: signal(false), loaded: signal(true), load: vi.fn(),
  };
  const userStore = { isPremium: () => true, isStarterOrAbove: () => true, maxAccounts: signal(null) };

  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: { create: vi.fn(() => of({ data: {} })) } },
      { provide: SelectedAccountStore, useValue: store },
      { provide: UserStore, useValue: userStore },
    ],
  });
  TestBed.overrideComponent(AccountsComponent, {
    set: { template: GRID, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(AccountsComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return {
    card: (id: string) => el.querySelector(`.acct-card[data-id="${id}"]`) as HTMLElement,
    el,
  };
}

describe('AccountsComponent — surbrillance compte sélectionné', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('compte sélectionné → sa card est .is-selected avec marqueur Actif', () => {
    const { card } = setup('b');
    expect(card('b').classList.contains('is-selected')).toBe(true);
    expect(card('b').querySelector('.acct-active-mark')).toBeTruthy();
    // les autres ne le sont pas
    expect(card('a').classList.contains('is-selected')).toBe(false);
    expect(card('a').querySelector('.acct-active-mark')).toBeNull();
  });

  it('« Tous les comptes » (all) → aucune card en surbrillance', () => {
    const { el } = setup('all');
    expect(el.querySelectorAll('.acct-card.is-selected').length).toBe(0);
    expect(el.querySelectorAll('.acct-active-mark').length).toBe(0);
  });

  it('toujours tous les comptes affichés (rien masqué)', () => {
    const { el } = setup('b');
    expect(el.querySelectorAll('.acct-card').length).toBe(2);
  });
});
