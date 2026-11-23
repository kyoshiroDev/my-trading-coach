import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { newerAttempt } from '@mtc/shared';
import { AccountsComponent } from './accounts.component';
import { AccountsApi, TradingAccount } from '../../core/api/accounts.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';
import { TradesStore } from '../../core/stores/trades.store';
import { TradovateApi } from '../../core/api/tradovate.api';
import { TradovateStore } from '../../core/stores/tradovate.store';
import { LostAccountFlowService } from '../../core/services/lost-account-flow.service';
import TEMPLATE from './accounts.component.html?raw';

/** Mes comptes, vue multi-comptes (#668) : tri par exposition, compte le plus exposé, perte max du jour. VRAI template. */

function acct(id: string, label: string, p: Partial<TradingAccount> = {}, pnl = 0, trades = 0): TradingAccount {
  return {
    id, label, broker: null, type: 'EVALUATION', status: 'ACTIVE',
    accountSize: null, currency: 'USD', startingBalance: 50000,
    profitTarget: null, maxDrawdown: null, drawdownType: 'TRAILING', propFirmPlanId: null, platform: null, lastPayoutAt: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    metrics: {
      startingBalance: 50000, realizedPnl: pnl, tradingPnl: pnl, currentBalance: 50000 + pnl, tradesCount: trades,
      winRate: null, bestDay: null, worstDay: null,
      objective: null, drawdown: null, drawdownUnconfirmed: false, dailyLoss: null, planHasDailyLoss: false, progress: null, broker: null, estimated: true, disclaimer: 'estimé',
    },
    ...p,
  };
}

function setup(accounts: TradingAccount[], selected: string | 'all' = 'all', connections: { accountId: string; status: string }[] = [], premium = true) {
  const tv = {
    connections: signal(connections),
    byAccount: computed(() => new Map(connections.map((c) => [c.accountId, { brokerTradesCount: 0, needsAccountSelection: false, ...c }] as const))),
    busy: signal({}), feedback: signal({}), loaded: signal(true),
    load: vi.fn(), sync: vi.fn(), selectThenSync: vi.fn(), disconnect: vi.fn(), setFeedback: vi.fn(),
  };
  const store = {
    accounts: signal(accounts),
    selectedAccountId: signal<string | 'all'>(selected),
    isLoading: signal(false), loadError: signal(false), loaded: signal(true), load: vi.fn(), select: vi.fn(),
  };
  const flow = {
    busy: signal(false), openRetry: vi.fn(), archive: vi.fn(), openChoice: vi.fn(), openAttempt: vi.fn(),
    newerAttempt: (a: TradingAccount) => newerAttempt(a.label, store.accounts()),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: {} },
      { provide: SelectedAccountStore, useValue: store },
      { provide: UserStore, useValue: { isDemo: () => false, isPremium: () => premium, maxAccounts: signal(null) } },
      { provide: TradovateStore, useValue: tv },
      { provide: TradovateApi, useValue: { refreshBalance: vi.fn(() => of({ data: {} })) } },
      { provide: TradesStore, useValue: { reset: vi.fn() } },
      { provide: Router, useValue: { routerState: { root: { queryParamMap: of(convertToParamMap({})) }, snapshot: { root: { queryParams: {} } } }, navigate: vi.fn() } },
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
  return { fixture, el, q, flow, store, router: TestBed.inject(Router), cmp: fixture.componentInstance as unknown as Record<string, () => unknown> };
}


type Gauge = { pct: number; breached?: boolean };
/** Compte avec marge plancher (`dd`) et, en Premium, perte max du jour (`daily`). */
function tracked(id: string, dd: Gauge | null, daily: Gauge | null = null, p: Partial<TradingAccount> = {}): TradingAccount {
  const base = acct(id, id, { propFirmPlanId: dd ? 'apex-eod-50k' : null, ...p });
  base.metrics = {
    ...base.metrics,
    drawdown: dd ? { type: 'TRAILING', floor: 48000, margin: Math.round(2000 * dd.pct), maxDrawdown: 2000, pct: dd.pct, breached: !!dd.breached, source: 'plan', rule: null } : null,
    dailyLoss: daily ? { limit: 1000, used: Math.round(1000 * (1 - daily.pct)), remaining: Math.round(1000 * daily.pct), pct: daily.pct, breached: !!daily.breached, breach: 'trading_paused_for_day', basis: 'equity', startOfDay: 50000, source: 'trades', approximate: false } : null,
  };
  return base;
}
const rowIds = (el: HTMLElement) => [...el.querySelectorAll('[data-testid="account-row"]')].map((r) => r.getAttribute('data-account-id'));

describe('Mes comptes · vue multi-comptes (#668)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('lignes du plus exposé au moins exposé (marge la plus serrée, perte max du jour comprise)', () => {
    const { el } = setup([
      tracked('safe', { pct: 0.9 }, { pct: 0.8 }),
      tracked('daily-hot', { pct: 0.7 }, { pct: 0.12 }),
      tracked('dd-mid', { pct: 0.4 }, { pct: 0.9 }),
    ]);
    expect(rowIds(el)).toEqual(['daily-hot', 'dd-mid', 'safe']);
  });

  it('« Le plus exposé » sur le premier seulement, avec sa couleur ; absent avec un seul compte suivi', () => {
    const { q, el } = setup([tracked('a', { pct: 0.9 }), tracked('b', { pct: 0.2 })]);
    expect(el.querySelectorAll('[data-testid="account-most-exposed"]')).toHaveLength(1);
    expect(q('tradovate-row-b')!.classList).toContain('is-most-exposed');
    expect(q('tradovate-row-b')!.getAttribute('style')).toContain('--tone: var(--red)');
    TestBed.resetTestingModule();
    const one = setup([tracked('a', { pct: 0.9 }), acct('perso', 'perso', { type: 'PERSONAL' })]);
    expect(one.q('account-most-exposed')).toBeNull();
  });

  it('un seul compte choisi au sélecteur : pas de mise en avant', () => {
    const { q } = setup([tracked('a', { pct: 0.9 }), tracked('b', { pct: 0.2 })], 'b');
    expect(q('account-most-exposed')).toBeNull();
  });

  it('« Sans plan relié » après les comptes suivis, avant validés et échoués ; règles manuelles triées avec les autres', () => {
    const { el, q } = setup([
      acct('noplan', 'Éval sans plan'),
      tracked('failed', { pct: 0 }, null, { status: 'FAILED' }),
      tracked('manual', { pct: 0.3 }, null, { propFirmPlanId: null }),
      tracked('plan', { pct: 0.8 }),
    ]);
    expect(rowIds(el)).toEqual(['manual', 'plan', 'noplan', 'failed']);
    expect(q('accounts-no-plan-group')!.textContent).toContain('Sans plan relié');
  });

  it('marge avant le plancher en $ et en %, perte max du jour en $ et en % (Premium)', () => {
    const { q } = setup([tracked('a', { pct: 0.62 }, { pct: 0.48 })]);
    expect(q('account-dd-pct-a')!.textContent!.trim()).toBe('62\u00a0%');
    expect(q('account-daily-loss-a')!.textContent).toContain('480');
    expect(q('account-daily-loss-a')!.textContent).toContain('48\u00a0%');
  });

  it('compte gratuit relié à un plan qui prévoit une perte max du jour : teaser Premium (ouvre la fenêtre Premium)', () => {
    const a = tracked('a', { pct: 0.62 });
    a.metrics.planHasDailyLoss = true;
    const { q, fixture } = setup([a], 'all', [], false);
    expect(q('account-daily-loss-teaser-a')!.getAttribute('aria-label')).toBe('Perte max du jour\u00a0: disponible en Premium');
    q('account-daily-loss-teaser-a')!.click();
    fixture.detectChanges();
    expect((fixture.componentInstance as unknown as { showPlanModal: () => boolean }).showPlanModal()).toBe(true);
  });

  it('compte gratuit relié à un plan SANS perte max du jour : « — », ni teaser ni mention Premium', () => {
    const { q } = setup([tracked('a', { pct: 0.3 }), tracked('b', { pct: 0.9 })], 'all', [], false);
    expect(q('account-daily-loss-teaser-a')).toBeNull();
    expect(q('tradovate-row-a')!.querySelector('.cell-dl')!.textContent!.trim()).toBe('—');
    expect(q('account-most-exposed')!.getAttribute('title')).not.toContain('Premium');
  });

  it('gating (décision du 22/11) : gratuit avec 3 comptes actifs, tri et mise en avant quand même', () => {
    const { el, q } = setup([tracked('x', { pct: 0.9 }), tracked('y', { pct: 0.15 }), tracked('z', { pct: 0.5 })], 'all', [], false);
    expect(rowIds(el)).toEqual(['y', 'z', 'x']);
    expect(q('tradovate-row-y')!.classList).toContain('is-most-exposed');
  });

  it('« À surveiller » compte aussi la perte max du jour', () => {
    const { el } = setup([tracked('a', { pct: 0.9 }, { pct: 0.2 }), tracked('b', { pct: 0.8 })]);
    const card = [...el.querySelectorAll('.stat-card')].find((c) => c.textContent!.includes('À surveiller'))!;
    expect(card.querySelector('.stat-value')!.textContent!.trim()).toBe('1');
  });

  it('heure du relevé broker visible sous le solde', () => {
    const a = tracked('a', { pct: 0.6 });
    a.metrics.broker = { cashBalance: 50000, equity: 50000, openPnl: 0, openPnlKnown: true, openPositions: 0, balanceAt: new Date(Date.now() - 4 * 60_000).toISOString(), equityAt: null, referenceMismatch: false };
    const { q } = setup([a]);
    expect(q('account-broker-age-a')!.textContent).toContain('relevé il y a');
  });
});
