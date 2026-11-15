import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SelectedAccountStore } from './selected-account.store';
import { AccountsApi, TradingAccount } from '../api/accounts.api';

const acc = (id: string, over: Partial<TradingAccount> = {}): TradingAccount =>
  ({ id, label: id, status: 'ACTIVE', ...over } as TradingAccount);

function setup(opts: { accounts?: TradingAccount[] } = {}) {
  const api = { getAll: vi.fn(() => of({ data: opts.accounts ?? [] })) };
  // Le store ne gate plus par plan : accessible à tous, quota côté API.
  TestBed.configureTestingModule({
    providers: [
      SelectedAccountStore,
      { provide: AccountsApi, useValue: api },
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

  it('load() → charge les comptes via /accounts', () => {
    const { store, api } = setup({ accounts: [acc('a1')] });
    store.load();
    expect(api.getAll).toHaveBeenCalledTimes(1);
    expect(store.accounts().length).toBe(1);
  });

  it('si le compte sélectionné disparaît → retour à « all »', () => {
    localStorage.setItem('mtc.selectedAccount', 'gone');
    const { store } = setup({ accounts: [acc('a1')] }); // 'gone' absent de la liste
    store.load();
    expect(store.selectedAccountId()).toBe('all');
  });

  it('un compte archivé ou échoué reste sélectionnable : ses chiffres restent lisibles', () => {
    localStorage.setItem('mtc.selectedAccount', 'a1');
    const { store } = setup({ accounts: [acc('a1', { status: 'ARCHIVED' }), acc('a2', { status: 'FAILED' })] });
    store.load();
    expect(store.selectedAccountId()).toBe('a1');
    expect(store.accountParam()).toBe('a1');
    store.select('a2');
    store.load();
    expect(store.accountParam()).toBe('a2');
  });

  describe('comptes perdus (échoués et archivés hors des chiffres « tous les comptes »)', () => {
    const list = () => [
      acc('act', { status: 'ACTIVE' }),
      acc('ok', { status: 'PASSED' }),
      acc('ko', { status: 'FAILED' }),
      acc('arc', { status: 'ARCHIVED' }),
    ];

    it('devise de « Tous les comptes » : seulement les comptes comptés (#947)', () => {
      const { store } = setup({ accounts: [
        acc('usd', { status: 'ACTIVE', currency: 'USD' }),
        acc('eur-arc', { status: 'ARCHIVED', currency: 'EUR' }),
        acc('eur-ko', { status: 'FAILED', currency: 'EUR' }),
      ] });
      store.load();
      expect(store.displayCurrency()).toBe('USD');
      store.setIncludeInactive(true);
      expect(store.displayCurrency()).toBeNull(); // l'interrupteur les ramène : devises mêlées
    });

    it('aucun compte compté (tous perdus) : devise de ces comptes, pas l\'USD par défaut', () => {
      const { store } = setup({ accounts: [acc('eur-ko', { status: 'FAILED', currency: 'EUR' })] });
      store.load();
      expect(store.displayCurrency()).toBe('EUR');
    });

    it('compte les comptes exclus par statut', () => {
      const { store } = setup({ accounts: list() });
      store.load();
      expect(store.excludedAccounts()).toEqual({ failed: 1, archived: 1 });
    });

    it('agrégé : actifs et validés seulement, tous avec l\'interrupteur', () => {
      const { store } = setup({ accounts: list() });
      store.load();
      expect(store.aggregateAccounts().map((a) => a.id)).toEqual(['act', 'ok']);
      store.setIncludeInactive(true);
      expect(store.aggregateAccounts().map((a) => a.id)).toEqual(['act', 'ok', 'ko', 'arc']);
    });

    it('paramètres des statistiques : rien par défaut, includeInactive avec l\'interrupteur', () => {
      const { store } = setup({ accounts: list() });
      store.load();
      expect(store.statsParams()).toEqual({});
      expect(store.statsQuery()).toBe('');
      store.setIncludeInactive(true);
      expect(store.statsParams()).toEqual({ includeInactive: 'true' });
      expect(store.statsQuery()).toBe('?includeInactive=true');
    });

    it('compte précis : son id seul, l\'interrupteur ne joue pas (même échoué)', () => {
      const { store } = setup({ accounts: list() });
      store.load();
      store.setIncludeInactive(true);
      store.select('ko');
      expect(store.inactiveIncluded()).toBe(false);
      expect(store.statsParams()).toEqual({ accountId: 'ko' });
      expect(store.statsQuery()).toBe('?accountId=ko');
    });

    it('reset() remet l\'interrupteur à zéro (déconnexion)', () => {
      const { store } = setup({ accounts: list() });
      store.setIncludeInactive(true);
      store.reset();
      expect(store.includeInactive()).toBe(false);
    });
  });

});

// Audit fonctionnel #994 (lot 1d, F13) : une erreur de chargement (y compris le rechargement déclenché
// par le socket Tradovate) vidait tous les comptes en silence : tableau vide, KPI à 0, sélecteur vide.
describe('SelectedAccountStore — échec de chargement', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('rechargement en échec : les comptes déjà chargés restent, l’erreur est signalée', async () => {
    const { store, api } = setup({ accounts: [acc('a1'), acc('a2')] });
    store.load();
    store.select('a2');
    const { throwError } = await import('rxjs');
    api.getAll.mockReturnValueOnce(throwError(() => new Error('réseau')) as never);
    store.load();
    expect(store.accounts().map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(store.selectedAccountId()).toBe('a2');
    expect(store.loadError()).toBe(true);
  });

  it('chargement réussi ensuite : erreur effacée', async () => {
    const { store, api } = setup({ accounts: [acc('a1')] });
    const { throwError } = await import('rxjs');
    api.getAll.mockReturnValueOnce(throwError(() => new Error('réseau')) as never);
    store.load();
    expect(store.loadError()).toBe(true);
    store.load();
    expect(store.loadError()).toBe(false);
    expect(store.accounts().map((a) => a.id)).toEqual(['a1']);
  });
});
