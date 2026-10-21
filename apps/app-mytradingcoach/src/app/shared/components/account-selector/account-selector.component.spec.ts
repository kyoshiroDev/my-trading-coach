import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { AccountSelectorComponent } from './account-selector.component';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradingAccount } from '@app/core/api/accounts.api';
import { statsScopeStub } from '@app/core/stores/selected-account.store.stub';
import TEMPLATE from './account-selector.component.html?raw';

const acc = (over: Partial<TradingAccount>): TradingAccount => over as TradingAccount;

function setup(opts: { loaded?: boolean; selectedId?: string | 'all' } = {}) {
  const store = {
    accounts: signal<TradingAccount[]>([]),
    selectedAccountId: signal<string | 'all'>(opts.selectedId ?? 'all'),
    selected: signal<TradingAccount | null>(null),
    isLoading: signal(false),
    loaded: signal(opts.loaded ?? false),
    select: vi.fn(),
    load: vi.fn(),
  };

  TestBed.configureTestingModule({
    providers: [{ provide: SelectedAccountStore, useValue: store }],
  });
  TestBed.overrideComponent(AccountSelectorComponent, {
    set: {
      template: '<div></div>',
      imports: [],
      styleUrls: [],
      styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(AccountSelectorComponent);
  fixture.detectChanges();

  return { fixture, cmp: fixture.componentInstance as any, store };
}

describe('AccountSelectorComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it("non chargé → charge les comptes à l'init", () => {
    const { store } = setup({ loaded: false });
    expect(store.load).toHaveBeenCalledTimes(1);
  });

  it('déjà chargé → ne recharge pas', () => {
    const { store } = setup({ loaded: true });
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

  it('isAll() reflète la vue agrégée', () => {
    const allView = setup({ selectedId: 'all' });
    expect(allView.cmp.isAll()).toBe(true);
    TestBed.resetTestingModule();
    const oneAcc = setup({ selectedId: 'a1' });
    expect(oneAcc.cmp.isAll()).toBe(false);
  });

  it('toggle() ouvre puis referme le menu', () => {
    const { cmp } = setup();
    expect(cmp.open()).toBe(false);
    cmp.toggle();
    expect(cmp.open()).toBe(true);
    cmp.toggle();
    expect(cmp.open()).toBe(false);
  });

  it('pick(id) sélectionne le compte ET referme le menu', () => {
    const { cmp, store } = setup();
    cmp.toggle();
    expect(cmp.open()).toBe(true);
    cmp.pick('a2');
    expect(store.select).toHaveBeenCalledWith('a2');
    expect(cmp.open()).toBe(false);
  });

  it('Échap ferme le menu', () => {
    const { cmp } = setup();
    cmp.toggle();
    cmp.onEscape();
    expect(cmp.open()).toBe(false);
  });

  it('clic extérieur ferme, clic intérieur garde ouvert', () => {
    const { cmp, fixture } = setup();
    cmp.toggle();
    // Cible interne (le host lui-même) → reste ouvert.
    cmp.onDocClick({ target: fixture.nativeElement } as unknown as MouseEvent);
    expect(cmp.open()).toBe(true);
    // Cible externe (le body, qui n'est pas contenu dans le host) → ferme.
    cmp.onDocClick({ target: document.body } as unknown as MouseEvent);
    expect(cmp.open()).toBe(false);
  });
});

describe('AccountSelectorComponent · comptes perdus (vrai template)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  const full = (id: string, status: TradingAccount['status'], balance: number): TradingAccount =>
    ({ id, label: id.toUpperCase(), status, type: 'EVALUATION', broker: null, currency: 'USD', metrics: { currentBalance: balance } }) as TradingAccount;

  function render(accounts: TradingAccount[], selectedId: string | 'all' = 'all') {
    const store = {
      ...statsScopeStub(),
      accounts: signal(accounts),
      selectedAccountId: signal<string | 'all'>(selectedId),
      selected: signal<TradingAccount | null>(accounts.find((a) => a.id === selectedId) ?? null),
      displayCurrency: signal('USD'),
      isLoading: signal(false),
      loaded: signal(true),
      select: vi.fn(),
      load: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: SelectedAccountStore, useValue: store }] });
    TestBed.overrideComponent(AccountSelectorComponent, {
      set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(AccountSelectorComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, cmp: fixture.componentInstance as any, store };
  }

  it('comptes échoués et archivés regroupés sous « Hors statistiques », avec leur badge, toujours choisissables', () => {
    const { el } = render([full('a', 'ACTIVE', 50_000), full('f', 'FAILED', 47_000), full('x', 'ARCHIVED', 24_000)]);
    const labels = [...el.querySelectorAll('.menu-lbl')].map((n) => n.textContent?.trim());
    expect(labels).toEqual(['Vue', 'Comptes', 'Hors statistiques']);
    const failed = el.querySelector('[data-testid="account-option-f"]')!;
    expect(failed.querySelector('.status-badge')!.textContent).toContain('Échoué');
    expect(el.querySelector('[data-testid="account-option-x"] .status-badge')!.textContent).toContain('Archivé');
    expect(el.querySelector('[data-testid="account-option-a"] .status-badge')).toBeNull();
  });

  it('solde de « Tous les comptes » : sans les comptes perdus, sauf interrupteur', () => {
    const { cmp, store } = render([full('a', 'ACTIVE', 50_000), full('p', 'PASSED', 10_000), full('f', 'FAILED', 47_000)]);
    expect(cmp.totalBalance()).toBe(60_000);
    store.includeInactive.set(true);
    expect(cmp.totalBalance()).toBe(107_000);
  });

  it('compte échoué sélectionné : badge « Échoué » sur le déclencheur', () => {
    const { el } = render([full('a', 'ACTIVE', 50_000), full('f', 'FAILED', 47_000)], 'f');
    expect(el.querySelector('[data-testid="acct-trigger"] .status-badge')!.textContent).toContain('Échoué');
  });
});
