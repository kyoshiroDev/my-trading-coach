import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { AccountSelectorComponent } from './account-selector.component';
import { SelectedAccountStore } from '../../../core/stores/selected-account.store';
import { UserStore } from '../../../core/stores/user.store';
import { TradingAccount } from '../../../core/api/accounts.api';

const acc = (over: Partial<TradingAccount>): TradingAccount => over as TradingAccount;

function setup(opts: { premium?: boolean; loaded?: boolean } = {}) {
  const store = {
    accounts: signal<TradingAccount[]>([]),
    selectedAccountId: signal<string | 'all'>('all'),
    isLoading: signal(false),
    loaded: signal(opts.loaded ?? false),
    select: vi.fn(),
    load: vi.fn(),
  };
  const eligible = opts.premium ?? true;
  const userStore = { isStarterOrAbove: () => eligible, isPremium: () => eligible };

  TestBed.configureTestingModule({
    providers: [
      { provide: SelectedAccountStore, useValue: store },
      { provide: UserStore, useValue: userStore },
    ],
  });
  TestBed.overrideComponent(AccountSelectorComponent, {
    set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(AccountSelectorComponent);
  fixture.detectChanges();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { fixture, cmp: fixture.componentInstance as any, store };
}

describe('AccountSelectorComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('Starter+ + non chargé → charge les comptes à l\'init', () => {
    const { store } = setup({ premium: true, loaded: false });
    expect(store.load).toHaveBeenCalledTimes(1);
  });

  it('FREE → ne charge pas (aucun appel /accounts)', () => {
    const { store } = setup({ premium: false });
    expect(store.load).not.toHaveBeenCalled();
  });

  it('déjà chargé → ne recharge pas', () => {
    const { store } = setup({ premium: true, loaded: true });
    expect(store.load).not.toHaveBeenCalled();
  });

  it('dotColor — vert actif / jaune éval / rouge échec / gris archivé', () => {
    const { cmp } = setup();
    expect(cmp.dotColor(acc({ status: 'ACTIVE', type: 'PERSONAL' }))).toBe('var(--green)');
    expect(cmp.dotColor(acc({ status: 'ACTIVE', type: 'EVALUATION' }))).toBe('var(--yellow)');
    expect(cmp.dotColor(acc({ status: 'FAILED', type: 'EVALUATION' }))).toBe('var(--red)');
    expect(cmp.dotColor(acc({ status: 'ARCHIVED', type: 'FUNDED' }))).toBe('var(--text-3)');
    expect(cmp.dotColor(acc({ status: 'PASSED', type: 'EVALUATION' }))).toBe('var(--green)');
  });
});
