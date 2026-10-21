import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AccountsComponent } from './accounts.component';
import { AccountsApi, TradingAccount } from '../../core/api/accounts.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';
import { TradesStore } from '../../core/stores/trades.store';
import { TradovateApi } from '../../core/api/tradovate.api';
import { TradovateStore } from '../../core/stores/tradovate.store';
import { LostAccountFlowService } from '../../core/services/lost-account-flow.service';
import TEMPLATE from './accounts.component.html?raw';

/** Mes comptes, écran 3 du compte perdu : badges, compte échoué, section des archivés. VRAI template. */

function acct(id: string, label: string, p: Partial<TradingAccount> = {}, pnl = 0, trades = 0): TradingAccount {
  return {
    id, label, broker: null, type: 'EVALUATION', status: 'ACTIVE',
    accountSize: null, currency: 'USD', startingBalance: 50000,
    profitTarget: null, maxDrawdown: null, drawdownType: 'TRAILING', propFirmPlanId: null, platform: null, lastPayoutAt: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    metrics: {
      startingBalance: 50000, realizedPnl: pnl, currentBalance: 50000 + pnl, tradesCount: trades,
      winRate: null, bestDay: null, worstDay: null,
      objective: null, drawdown: null, drawdownUnconfirmed: false, dailyLoss: null, progress: null, broker: null, estimated: true, disclaimer: 'estimé',
    },
    ...p,
  };
}

function setup(accounts: TradingAccount[], selected: string | 'all' = 'all') {
  const tv = {
    connections: signal([]),
    byAccount: computed(() => new Map()),
    busy: signal({}), feedback: signal({}), loaded: signal(true),
    load: vi.fn(), sync: vi.fn(), selectThenSync: vi.fn(), disconnect: vi.fn(), setFeedback: vi.fn(),
  };
  const store = {
    accounts: signal(accounts),
    selectedAccountId: signal<string | 'all'>(selected),
    isLoading: signal(false), loaded: signal(true), load: vi.fn(),
  };
  const flow = { busy: signal(false), openRetry: vi.fn(), archive: vi.fn(), openChoice: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: {} },
      { provide: SelectedAccountStore, useValue: store },
      { provide: UserStore, useValue: { isDemo: () => false, isPremium: () => true, maxAccounts: signal(null) } },
      { provide: TradovateStore, useValue: tv },
      { provide: TradovateApi, useValue: { refreshBalance: vi.fn(() => of({ data: {} })) } },
      { provide: TradesStore, useValue: { reset: vi.fn() } },
      { provide: Router, useValue: { routerState: { snapshot: { root: { queryParams: {} } } }, navigate: vi.fn() } },
      { provide: LostAccountFlowService, useValue: flow },
    ],
  });
  TestBed.overrideComponent(AccountsComponent, {
    set: {
      template: TEMPLATE,
      imports: [DecimalPipe, FormsModule, NgTemplateOutlet],
      styleUrls: [], styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(AccountsComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { fixture, el, q, flow, cmp: fixture.componentInstance as unknown as Record<string, () => unknown> };
}

const LIST = () => [
  acct('a2', 'Apex 50K #2', {}, 410, 3),
  acct('t', 'Topstep 150K', { status: 'PASSED' }, 9000, 40),
  acct('a1', 'Apex 50K #1', { status: 'FAILED' }, -2960, 12),
  acct('l', 'Lucid 25K', { status: 'ARCHIVED' }, -1100, 8),
];

describe('Mes comptes · compte perdu', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('badges Actif, Validé, Échoué, Archivé (texte, pas seulement une couleur)', () => {
    const { q } = setup(LIST());
    expect(q('account-status-a2')!.textContent!.trim()).toBe('Actif');
    expect(q('account-status-t')!.textContent!.trim()).toBe('Validé');
    expect(q('account-status-a1')!.textContent!.trim()).toBe('Échoué');
    expect(q('account-status-l')!.textContent!.trim()).toBe('Archivé');
    expect(q('account-status-a1')!.classList).toContain('is-failed');
  });

  it('compte échoué : « Hors statistiques », « Nouvelle tentative » et « Archiver »', () => {
    const { q, flow } = setup(LIST());
    expect(q('account-failed-a1')!.textContent).toContain('Hors statistiques · 12 trades');
    q('account-retry-a1')!.click();
    expect(flow.openRetry).toHaveBeenCalledWith('a1');
    q('account-archive-a1')!.click();
    expect(flow.archive).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    expect(q('account-retry-a2')).toBeNull();
    expect(q('account-retry-t')).toBeNull();
  });

  it('archivés : section repliée « 1 COMPTE ARCHIVÉ », hors de la liste principale', () => {
    const { q } = setup(LIST());
    const section = q('archived-accounts') as HTMLDetailsElement;
    expect(section.tagName).toBe('DETAILS');
    expect(section.open).toBe(false);
    expect(section.querySelector('summary')!.textContent).toContain('1 COMPTE ARCHIVÉ');
    expect(section.querySelector('[data-testid="account-card-l"]')).not.toBeNull();
    expect(section.querySelector('[data-testid="account-card-a1"]')).toBeNull();
  });

  it('chiffres du haut : ni l\'échoué ni l\'archivé (validé compté)', () => {
    const { cmp } = setup(LIST());
    expect((cmp['visibleAccounts']() as TradingAccount[]).map((a) => a.id)).toEqual(['a2', 't']);
    expect(cmp['totalPnl']()).toBe(9410);
    expect(cmp['totalTrades']()).toBe(43);
  });

  it('compte archivé choisi dans le sélecteur : affiché seul, ses chiffres lisibles', () => {
    const { q, cmp } = setup(LIST(), 'l');
    expect(q('account-card-l')).not.toBeNull();
    expect(q('archived-accounts')).toBeNull();
    expect(cmp['totalPnl']()).toBe(-1100);
  });

  it('aucun compte archivé : pas de section', () => {
    const { q } = setup(LIST().filter((a) => a.status !== 'ARCHIVED'));
    expect(q('archived-accounts')).toBeNull();
  });
});
