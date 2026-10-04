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
import { PropAlertsService } from '@app/core/services/prop-alerts.service';
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
  drawdownUnconfirmed: false, dailyLoss: null,
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

function setup(m: AccountRuleMetrics, opts: { demo?: boolean; premium?: boolean; permission?: string } = {}) {
  const store = { accounts: signal([account(m)]), load: vi.fn() };
  const tvApi = { refreshBalance: vi.fn(() => of({ data: {} })) };
  const tv = { loaded: signal(false), load: vi.fn() };
  const alerts = { permission: signal(opts.permission ?? 'granted'), requestPermission: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: SelectedAccountStore, useValue: store },
      { provide: TradovateStore, useValue: tv },
      { provide: TradovateApi, useValue: tvApi },
      { provide: UserStore, useValue: { isDemo: () => !!opts.demo, isPremium: () => !!opts.premium } },
      { provide: PropAlertsService, useValue: alerts },
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
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { fixture, el, text, q, store, tvApi, tv, alerts };
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

  describe('couche Premium (#370)', () => {
    const dl = {
      limit: 1000, used: 820, remaining: 180, pct: 0.18, breached: false, breach: 'trading_paused_for_day' as const,
      basis: 'equity' as const, startOfDay: 51000, source: 'broker' as const, approximate: false,
    };

    it('Premium : perte du jour, ce qui reste et la sanction de la firm', () => {
      const { text, q } = setup(metrics({ dailyLoss: dl }), { premium: true });
      const t = text('live-prop-firm-daily-loss');
      expect(t).toContain('180');
      expect(t).toContain('820');
      expect(t).toContain('1,000');
      expect(t).toContain('trading coupé');
      expect(q('live-prop-firm-premium-teaser')).toBeNull();
    });

    it('Premium, limite atteinte : le dit en clair', () => {
      const { text } = setup(metrics({ dailyLoss: { ...dl, remaining: -20, pct: 0, breached: true, breach: 'account_failed' } }), { premium: true });
      expect(text('live-prop-firm-daily-loss')).toContain('limite atteinte');
      expect(text('live-prop-firm-daily-loss')).toContain('échec du compte');
    });

    it('gratuit avec plan relié : teaser Premium, ni perte du jour ni bouton de notifications', () => {
      const { q } = setup(metrics(), { premium: false, permission: 'default' });
      expect(q('live-prop-firm-premium-teaser')).not.toBeNull();
      expect(q('live-prop-firm-daily-loss')).toBeNull();
      expect(q('live-prop-firm-enable-notifications')).toBeNull();
    });

    it('Premium, notifications pas encore autorisées : bouton qui les demande', () => {
      const { q, alerts } = setup(metrics({ dailyLoss: dl }), { premium: true, permission: 'default' });
      q('live-prop-firm-enable-notifications')!.click();
      expect(alerts.requestPermission).toHaveBeenCalled();
    });

    it('Premium : gain max du jour pour la consistency, ou dépassement', () => {
      const base = metrics();
      const withCons = (todayPnl: number) => metrics({
        progress: { ...base.progress!, requirements: [...base.progress!.requirements, { key: 'consistency', met: true, current: 0.3, required: 0.4, unit: 'pct', dayCap: 800, todayPnl }] },
      });
      expect(setup(withCons(500), { premium: true }).text('live-prop-firm-consistency')).toContain('300');
      TestBed.resetTestingModule();
      expect(setup(withCons(900), { premium: true }).text('live-prop-firm-consistency')).toContain('dépasse la règle');
    });

    it('sans gain max (hors Premium) : pas de ligne consistency', () => {
      const { q } = setup(metrics(), { premium: false });
      expect(q('live-prop-firm-consistency')).toBeNull();
    });

    it('Premium, notifications bloquées : le dit, sans bouton', () => {
      const { q } = setup(metrics({ dailyLoss: dl }), { premium: true, permission: 'denied' });
      expect(q('live-prop-firm-enable-notifications')).toBeNull();
      expect(q('live-prop-firm-notifications-denied')).not.toBeNull();
    });
  });

  it('« Saisir un trade à la main » prévient le parent', () => {
    const { el, fixture } = setup(metrics());
    const spy = vi.fn();
    fixture.componentInstance.manualEntry.subscribe(spy);
    (el.querySelector('[data-testid="live-prop-firm-manual"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
  });
});
