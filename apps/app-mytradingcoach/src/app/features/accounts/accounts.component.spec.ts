import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { AccountsComponent } from './accounts.component';
import { AccountsApi, TradingAccount } from '../../core/api/accounts.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';

function acct(p: Partial<TradingAccount> & { id: string }): TradingAccount {
  return {
    id: p.id,
    label: p.label ?? 'Compte',
    broker: p.broker ?? null,
    type: p.type ?? 'PERSONAL',
    status: p.status ?? 'ACTIVE',
    accountSize: p.accountSize ?? null,
    currency: p.currency ?? 'USD',
    startingBalance: p.startingBalance ?? null,
    profitTarget: p.profitTarget ?? null,
    maxDrawdown: p.maxDrawdown ?? null,
    drawdownType: p.drawdownType ?? 'TRAILING',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metrics: {
      startingBalance: 50000,
      realizedPnl: 0,
      currentBalance: 50000,
      tradesCount: 0,
      objective: null,
      drawdown: null,
      estimated: true,
      disclaimer: 'estimé',
      ...(p.metrics ?? {}),
    },
  };
}

const api = { create: vi.fn(() => of({ data: {} })), update: vi.fn(() => of({ data: {} })), remove: vi.fn(() => of({ data: {} })) };

function setup(opts: { premium: boolean; accounts: TradingAccount[]; limit?: number | null }) {
  const accountsSig = signal(opts.accounts);
  const store = {
    accounts: accountsSig,
    isLoading: signal(false),
    loaded: signal(true),
    load: vi.fn(),
  };
  // limit: null = illimité (Premium par défaut dans les tests existants).
  const userStore = {
    isPremium: () => opts.premium,
    isStarterOrAbove: () => opts.premium,
    maxAccounts: signal(opts.limit ?? null),
  };

  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: api },
      { provide: SelectedAccountStore, useValue: store },
      { provide: UserStore, useValue: userStore },
    ],
  });
  // Template stubé + imports vidés : neutralise lucide-angular (TopbarComponent), qui
  // ne compile pas en JIT/vitest. On valide la logique pure (agrégats, barres, payload).
  TestBed.overrideComponent(AccountsComponent, {
    set: {
      template: '<div></div>',
      imports: [],
      styleUrls: [],
      styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  return TestBed.createComponent(AccountsComponent).componentInstance as unknown as Record<string, unknown>;
}

describe('AccountsComponent — logique', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    api.create.mockClear();
    api.update.mockClear();
    api.remove.mockClear();
  });

  it('agrège capital / pnl / trades sur les comptes non archivés', () => {
    const c = setup({
      premium: true,
      accounts: [
        acct({ id: 'a', metrics: { startingBalance: 50000, realizedPnl: 1240, currentBalance: 51240, tradesCount: 38, objective: null, drawdown: null, estimated: true, disclaimer: '' } }),
        acct({ id: 'b', metrics: { startingBalance: 50000, realizedPnl: 890, currentBalance: 50890, tradesCount: 21, objective: null, drawdown: null, estimated: true, disclaimer: '' } }),
        acct({ id: 'z', status: 'ARCHIVED', metrics: { startingBalance: 99999, realizedPnl: 9999, currentBalance: 0, tradesCount: 99, objective: null, drawdown: null, estimated: true, disclaimer: '' } }),
      ],
    });
    expect((c['trackedCapital'] as () => number)()).toBe(100000);
    expect((c['totalPnl'] as () => number)()).toBe(2130);
    expect((c['totalTrades'] as () => number)()).toBe(59);
  });

  it('compte « à surveiller » les comptes dont la marge drawdown est dépassée ou ≤ 25 %', () => {
    const dd = (pct: number, breached: boolean) => ({ type: 'TRAILING' as const, floor: 0, margin: 0, maxDrawdown: 2500, pct, breached });
    const c = setup({
      premium: true,
      accounts: [
        acct({ id: 'safe', metrics: { startingBalance: 0, realizedPnl: 0, currentBalance: 0, tradesCount: 0, objective: null, drawdown: dd(0.7, false), estimated: true, disclaimer: '' } }),
        acct({ id: 'low', metrics: { startingBalance: 0, realizedPnl: 0, currentBalance: 0, tradesCount: 0, objective: null, drawdown: dd(0.18, false), estimated: true, disclaimer: '' } }),
        acct({ id: 'breach', metrics: { startingBalance: 0, realizedPnl: 0, currentBalance: 0, tradesCount: 0, objective: null, drawdown: dd(0, true), estimated: true, disclaimer: '' } }),
      ],
    });
    expect((c['atRiskCount'] as () => number)()).toBe(2);
  });

  it('barre objectif : largeur = pct, atteint à 100 %', () => {
    const c = setup({ premium: true, accounts: [] });
    const a = acct({ id: 'a', metrics: { startingBalance: 0, realizedPnl: 0, currentBalance: 0, tradesCount: 0, objective: { current: 1500, target: 3000, pct: 0.5 }, drawdown: null, estimated: true, disclaimer: '' } });
    expect((c['objWidth'] as (x: TradingAccount) => number)(a)).toBe(50);
    expect((c['objReached'] as (x: TradingAccount) => boolean)(a)).toBe(false);
    const done = acct({ id: 'b', metrics: { startingBalance: 0, realizedPnl: 0, currentBalance: 0, tradesCount: 0, objective: { current: 3000, target: 3000, pct: 1 }, drawdown: null, estimated: true, disclaimer: '' } });
    expect((c['objReached'] as (x: TradingAccount) => boolean)(done)).toBe(true);
  });

  it('couleur marge drawdown : rouge si critique, vert si confortable', () => {
    const c = setup({ premium: true, accounts: [] });
    const mk = (pct: number, breached: boolean) => acct({ id: 'x', metrics: { startingBalance: 0, realizedPnl: 0, currentBalance: 0, tradesCount: 0, objective: null, drawdown: { type: 'TRAILING', floor: 0, margin: 0, maxDrawdown: 2500, pct, breached }, estimated: true, disclaimer: '' } });
    const ddColor = c['ddColor'] as (x: TradingAccount) => string;
    expect(ddColor(mk(0.8, false))).toBe('var(--green)');
    expect(ddColor(mk(0.4, false))).toBe('var(--yellow)');
    expect(ddColor(mk(0.1, false))).toBe('var(--red)');
    expect(ddColor(mk(0, true))).toBe('var(--red)');
  });

  it('create : compte perso → broker/objectif/drawdown nuls dans le payload', () => {
    const c = setup({ premium: true, accounts: [] });
    (c['openCreate'] as () => void)();
    (c['patch'] as (p: unknown) => void)({ label: 'Perso Binance', type: 'PERSONAL', broker: 'doit disparaître', profitTarget: 3000, maxDrawdown: 2500 });
    (c['submitForm'] as () => void)();
    expect(api.create).toHaveBeenCalledTimes(1);
    const payload = api.create.mock.calls[0][0] as Record<string, unknown>;
    expect(payload['label']).toBe('Perso Binance');
    expect(payload['broker']).toBeNull();
    expect(payload['profitTarget']).toBeNull();
    expect(payload['maxDrawdown']).toBeNull();
  });

  it('submit bloqué si label vide', () => {
    const c = setup({ premium: true, accounts: [] });
    (c['openCreate'] as () => void)();
    (c['submitForm'] as () => void)();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('quota STARTER 3/3 → atLimit, openCreate ouvre l\'upsell (pas le formulaire), submit bloqué', () => {
    const c = setup({ premium: true, limit: 3, accounts: [acct({ id: 'a' }), acct({ id: 'b' }), acct({ id: 'c' })] });
    expect((c['atLimit'] as () => boolean)()).toBe(true);
    (c['openCreate'] as () => void)();
    expect((c['formOpen'] as () => boolean)()).toBe(false);
    expect((c['showPlanModal'] as () => boolean)()).toBe(true);
    (c['patch'] as (p: unknown) => void)({ label: 'C4' });
    expect((c['canSubmit'] as () => boolean)()).toBe(false);
  });

  it('sous le quota (1/3) → openCreate ouvre le formulaire', () => {
    const c = setup({ premium: true, limit: 3, accounts: [acct({ id: 'a' })] });
    expect((c['atLimit'] as () => boolean)()).toBe(false);
    (c['openCreate'] as () => void)();
    expect((c['formOpen'] as () => boolean)()).toBe(true);
  });

  it('comptes archivés ne consomment pas le quota', () => {
    const c = setup({ premium: true, limit: 3, accounts: [acct({ id: 'a' }), acct({ id: 'b' }), acct({ id: 'z', status: 'ARCHIVED' })] });
    expect((c['atLimit'] as () => boolean)()).toBe(false); // 2 actifs < 3
  });

  it('Premium (limit null) → jamais atLimit', () => {
    const c = setup({ premium: true, limit: null, accounts: [acct({ id: 'a' }), acct({ id: 'b' }), acct({ id: 'c' }), acct({ id: 'd' })] });
    expect((c['atLimit'] as () => boolean)()).toBe(false);
  });
});
