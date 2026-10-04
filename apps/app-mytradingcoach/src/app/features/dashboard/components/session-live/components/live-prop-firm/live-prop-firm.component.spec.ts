import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { of } from 'rxjs';
import { LivePropFirmComponent } from './live-prop-firm.component';
import type { AccountRuleMetrics, TradingAccount } from '@app/core/api/accounts.api';
import { TradovateApi } from '@app/core/api/tradovate.api';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradovateStore } from '@app/core/stores/tradovate.store';
import { UserStore } from '@app/core/stores/user.store';
import { TradovateLiveSocketService } from '@app/core/services/tradovate-live-socket.service';
import TEMPLATE from './live-prop-firm.component.html?raw';

/** Panneau de suivi prop firm de la session live, sur son VRAI template. */

const metrics = (p: Partial<AccountRuleMetrics> = {}): AccountRuleMetrics => ({
  startingBalance: 50000, realizedPnl: 820, currentBalance: 50820, tradesCount: 4,
  winRate: 50, bestDay: null, worstDay: null, objective: null,
  drawdown: {
    type: 'TRAILING', floor: 48820, margin: 1350, maxDrawdown: 2000, pct: 0.675, breached: false,
    source: 'plan',
    rule: {
      firmName: 'Apex', planName: 'EOD 50K', phase: 'evaluation', kind: 'trailing_eod',
      locksAt: 52100, lockedFloor: 50100, locked: false, realtimeEquity: false,
      peakSource: 'broker', peakBalance: 50820, officialThrough: null, platform: null, platformChoices: [],
    },
  },
  drawdownUnconfirmed: false,
  progress: {
    kind: 'objective', remaining: 2180, done: false, cycleAfter: null, cycleSource: null,
    payoutsReceived: null, lastPayout: null, unconfirmed: false,
    requirements: [{ key: 'profit', met: false, current: 820, required: 3000, unit: 'usd' }],
  },
  broker: {
    cashBalance: 50820, equity: 50170, openPnl: -650, openPositions: 1,
    balanceAt: new Date(Date.now() - 60_000).toISOString(), equityAt: null, referenceMismatch: false,
  },
  estimated: true, disclaimer: 'estimé',
  ...p,
});

const account = (m: AccountRuleMetrics): TradingAccount => ({
  id: 'a', label: 'Apex éval 50k', broker: 'Apex', type: 'EVALUATION', status: 'ACTIVE',
  accountSize: 50000, currency: 'USD', startingBalance: 50000, profitTarget: 3000,
  maxDrawdown: 2000, drawdownType: 'TRAILING', propFirmPlanId: 'p', platform: null,
  lastPayoutAt: null, createdAt: '', updatedAt: '', metrics: m,
});

function setup(m: AccountRuleMetrics, opts: { demo?: boolean } = {}) {
  const store = { accounts: signal([account(m)]), load: vi.fn() };
  const tvApi = { refreshBalance: vi.fn(() => of({ data: {} })) };
  const tv = { loaded: signal(false), load: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: SelectedAccountStore, useValue: store },
      { provide: TradovateStore, useValue: tv },
      { provide: TradovateApi, useValue: tvApi },
      { provide: UserStore, useValue: { isDemo: () => !!opts.demo } },
      { provide: TradovateLiveSocketService, useValue: { connected: signal(true) } },
    ],
  });
  TestBed.overrideComponent(LivePropFirmComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(LivePropFirmComponent);
  // Entrées signal non alimentées en JIT (cf. angular.md) : remplacées avant le premier rendu.
  (fixture.componentInstance as unknown as { accountId: () => string }).accountId = signal('a');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const text = (id: string) => (el.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { fixture, el, text, store, tvApi, tv };
}

describe('Session live — suivi prop firm', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('affiche solde et latent du broker, la marge avant le plancher et l’objectif du plan', () => {
    const { text } = setup(metrics());
    expect(text('live-prop-firm-balance')).toContain('50,820');
    expect(text('live-prop-firm-open-pnl')).toContain('650');
    const dd = text('live-prop-firm-drawdown');
    expect(dd).toContain('1,350');
    expect(dd).toContain('plancher');
    expect(dd).toContain('48,820');
    expect(dd).toContain('trailing fin de journée');
    const obj = text('live-prop-firm-objective');
    expect(obj).toContain('27 %');
    expect(obj).toContain('il te reste');
    expect(text('live-prop-firm-live')).toBe('LIVE');
  });

  it('plancher dépassé : le dit en clair', () => {
    const m = metrics();
    const { text } = setup(metrics({ drawdown: { ...m.drawdown!, margin: -40, pct: 0, breached: true } }));
    expect(text('live-prop-firm-drawdown')).toContain('plancher dépassé');
  });

  it('sans règle de drawdown : renvoie vers « Mes comptes » au lieu d’une barre vide', () => {
    const { text } = setup(metrics({ drawdown: null }));
    expect(text('live-prop-firm-drawdown')).toContain('Relie-le à son plan');
  });

  it('relit le solde chez le broker une fois à l’ouverture, puis recharge les comptes', () => {
    const { tvApi, store, tv } = setup(metrics());
    expect(tvApi.refreshBalance).toHaveBeenCalledTimes(1);
    expect(tvApi.refreshBalance).toHaveBeenCalledWith('a');
    expect(store.load).toHaveBeenCalled();
    expect(tv.load, 'connexions pas encore chargées').toHaveBeenCalled();
  });

  it('compte démo : aucune relecture (lecture seule)', () => {
    const { tvApi } = setup(metrics(), { demo: true });
    expect(tvApi.refreshBalance).not.toHaveBeenCalled();
  });

  it('« Saisir un trade à la main » prévient le parent', () => {
    const { el, fixture } = setup(metrics());
    const spy = vi.fn();
    fixture.componentInstance.manualEntry.subscribe(spy);
    (el.querySelector('[data-testid="live-prop-firm-manual"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
  });
});
