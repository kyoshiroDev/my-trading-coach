import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SelectedAccountStore } from './selected-account.store';
import { AccountsApi, TradingAccount } from '../api/accounts.api';
import { UserStore } from './user.store';

const acc = (id: string, over: Partial<TradingAccount> = {}): TradingAccount =>
  ({ id, label: id, status: 'ACTIVE', ...over } as TradingAccount);

function setup(opts: { premium?: boolean; accounts?: TradingAccount[] } = {}) {
  const api = { getAll: vi.fn(() => of({ data: opts.accounts ?? [] })) };
  const userStore = { isPremium: () => opts.premium ?? true };
  TestBed.configureTestingModule({
    providers: [
      SelectedAccountStore,
      { provide: AccountsApi, useValue: api },
      { provide: UserStore, useValue: userStore },
    ],
  });
  return { store: TestBed.inject(SelectedAccountStore), api };
}

describe('SelectedAccountStore', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('défaut « all » → selected() null, accountParam() undefined', () => {
    const { store } = setup();
    expect(store.selectedAccountId()).toBe('all');
    expect(store.selected()).toBeNull();
    expect(store.accountParam()).toBeUndefined();
  });

  it('select(id) → selected() = ce compte + accountParam() = id', () => {
    const { store } = setup({ accounts: [acc('a1'), acc('a2')] });
    store.load();
    store.select('a2');
    expect(store.selected()?.id).toBe('a2');
    expect(store.accountParam()).toBe('a2');
  });

  it('persiste la sélection (survit à un reload)', () => {
    const first = setup({ accounts: [acc('a1')] });
    first.store.select('a1');
    expect(localStorage.getItem('mtc.selectedAccount')).toBe('a1');

    // « reload » : nouvelle instance du store → relit la sélection persistée.
    TestBed.resetTestingModule();
    const second = setup({ accounts: [acc('a1')] });
    expect(second.store.selectedAccountId()).toBe('a1');
  });

  it('Premium → charge les comptes via /accounts', () => {
    const { store, api } = setup({ premium: true, accounts: [acc('a1')] });
    store.load();
    expect(api.getAll).toHaveBeenCalledTimes(1);
    expect(store.accounts().length).toBe(1);
  });

  it('non-Premium → aucun appel /accounts, liste vide', () => {
    const { store, api } = setup({ premium: false });
    store.load();
    expect(api.getAll).not.toHaveBeenCalled();
    expect(store.accounts()).toEqual([]);
  });

  it('si le compte sélectionné disparaît → retour à « all »', () => {
    localStorage.setItem('mtc.selectedAccount', 'gone');
    const { store } = setup({ accounts: [acc('a1')] }); // 'gone' absent de la liste
    store.load();
    expect(store.selectedAccountId()).toBe('all');
  });

  it('si le compte sélectionné est archivé → retour à « all » (plus de filtre fantôme)', () => {
    localStorage.setItem('mtc.selectedAccount', 'a1');
    const { store } = setup({ accounts: [acc('a1', { status: 'ARCHIVED' }), acc('a2')] });
    store.load();
    expect(store.selectedAccountId()).toBe('all');
    expect(store.accountParam()).toBeUndefined();
  });

  it('non-Premium → accountParam() undefined même avec une sélection persistée (anti-fuite)', () => {
    localStorage.setItem('mtc.selectedAccount', 'a1'); // ancien compte d'un plan déchu
    const { store } = setup({ premium: false });
    expect(store.accountParam()).toBeUndefined();
  });

  it('non-Premium → load() réinitialise la sélection persistée à « all »', () => {
    localStorage.setItem('mtc.selectedAccount', 'a1');
    const { store } = setup({ premium: false });
    store.load();
    expect(store.selectedAccountId()).toBe('all');
    expect(localStorage.getItem('mtc.selectedAccount')).toBe('all');
  });
});
