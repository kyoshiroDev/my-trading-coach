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
import { AlertSoundService } from '@app/core/services/alert-sound.service';
import TEMPLATE from './live-prop-firm.component.html?raw';
import SESSION_TEMPLATE from '../../session-live.component.html?raw';

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
    cashBalance: 50820, equity: 50170, openPnl: -650, openPnlKnown: true, openPositions: 1,
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

function setup(
  m: AccountRuleMetrics,
  opts: { demo?: boolean; premium?: boolean; permission?: string; account?: Partial<TradingAccount>; sessionId?: string } = {},
) {
  const store = { accounts: signal([{ ...account(m), ...opts.account }]), load: vi.fn() };
  const tvApi = { refreshBalance: vi.fn(() => of({ data: {} })) };
  const tv = { loaded: signal(false), load: vi.fn() };
  const alerts = { permission: signal(opts.permission ?? 'granted'), requestPermission: vi.fn() };
  const enabled = signal(true);
  const sound = { enabled, toggle: vi.fn(() => enabled.update((v) => !v)) };
  TestBed.configureTestingModule({
    providers: [
      { provide: SelectedAccountStore, useValue: store },
      { provide: TradovateStore, useValue: tv },
      { provide: TradovateApi, useValue: tvApi },
      { provide: UserStore, useValue: { isDemo: () => !!opts.demo, isPremium: () => !!opts.premium } },
      { provide: PropAlertsService, useValue: alerts },
      { provide: AlertSoundService, useValue: sound },
      { provide: TradovateLiveSocketService, useValue: { connected: signal(true) } },
    ],
  });
  TestBed.overrideComponent(LivePropFirmComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(LivePropFirmComponent);
  // Entrées signal non alimentées en JIT (cf. angular.md) : remplacées avant le premier rendu.
  (fixture.componentInstance as unknown as { accountId: () => string }).accountId = signal('a');
  (fixture.componentInstance as unknown as { sessionId: () => string | null }).sessionId = signal(opts.sessionId ?? null);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const text = (id: string) => (el.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { fixture, el, text, q, store, tvApi, tv, alerts, sound };
}

describe('Session live — suivi prop firm', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('position ouverte au latent jamais lu → « - », pas un 0 inventé (comme Trade en cours)', () => {
    const m = metrics();
    const { text } = setup({ ...m, broker: { ...m.broker!, openPnl: 0, openPnlKnown: false } });
    expect(text('live-prop-firm-open-pnl-na')).toBe('-');
    expect(text('live-prop-firm-open-pnl')).toBe('');
  });

  it('affiche solde et latent du broker, la marge avant le plancher et l’objectif du plan', () => {
    const { text } = setup(metrics());
    expect(text('live-prop-firm-balance'), 'equity en direct').toContain('50,170');
    expect(text('live-prop-firm-open-pnl')).toContain('650');
    const dd = text('live-prop-firm-drawdown');
    expect(dd).toContain('1,350');
    expect(dd).toContain('plancher');
    expect(dd).toContain('48,820');
    expect(dd).toContain('trailing fin de journée');
    const obj = text('live-prop-firm-objective');
    expect(obj).toContain('+$820');
    expect(obj).toContain('$3,000');
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

  describe('plan à renseigner (#612)', () => {
    const GAUGES = ['live-prop-firm-daily-loss', 'live-prop-firm-premium-teaser', 'live-prop-firm-drawdown', 'live-prop-firm-objective'];

    it('compte prop firm sans plan : appel à l’action à la place des jauges', () => {
      const { q, text } = setup(metrics(), { account: { propFirmPlanId: null } });
      expect(text('live-prop-firm-plan-cta')).toContain('Relie ce compte à son plan');
      for (const id of GAUGES) expect(q(id), id).toBeNull();
      // Equity et disclaimer restent : seul le bloc des jauges est remplacé.
      expect(q('live-prop-firm-balance')).not.toBeNull();
    });

    it('« Plus tard » : toujours à renseigner, l’appel à l’action reste', () => {
      const { q } = setup(metrics(), { account: { propFirmPlanId: null, type: 'PERSONAL', planLinkChoice: 'LATER' } });
      expect(q('live-prop-firm-plan-cta')).not.toBeNull();
    });

    it('compte déclaré perso : pas d’appel à l’action', () => {
      const { q } = setup(metrics(), { account: { propFirmPlanId: null, type: 'PERSONAL', planLinkChoice: 'PERSONAL' } });
      expect(q('live-prop-firm-plan-cta')).toBeNull();
    });

    it('le bouton ouvre « Quel est ce compte ? » ; plan relié → comptes rechargés, jauges affichées', () => {
      const { q, fixture, store } = setup(metrics(), { account: { propFirmPlanId: null } });
      q('live-prop-firm-plan-link')!.click();
      fixture.detectChanges();
      expect(q('live-prop-firm-plan-modal')!.querySelector('mtc-account-plan-wizard')).not.toBeNull();

      (fixture.componentInstance as unknown as { onPlanLinked: () => void }).onPlanLinked();
      expect(store.load).toHaveBeenCalled();
      // Le rechargement ramène le compte relié au plan : les jauges remplacent l'appel à l'action.
      store.accounts.set([account(metrics())]);
      fixture.detectChanges();
      expect(q('live-prop-firm-plan-modal')).toBeNull();
      expect(q('live-prop-firm-plan-cta')).toBeNull();
      expect(q('live-prop-firm-drawdown')).not.toBeNull();
    });
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

    it('Premium : bouton pour couper puis réactiver le son des alertes', () => {
      const { q, sound, fixture } = setup(metrics(), { premium: true });
      const btn = q('live-prop-firm-sound')!;
      expect(btn.getAttribute('aria-pressed')).toBe('true');
      btn.click();
      fixture.detectChanges();
      expect(sound.toggle).toHaveBeenCalled();
      expect(q('live-prop-firm-sound')!.getAttribute('aria-pressed')).toBe('false');
      expect(q('live-prop-firm-sound')!.getAttribute('aria-label')).toBe('Activer le son des alertes');
    });

    it('gratuit : pas de bouton de son (pas d’alertes)', () => {
      const { q } = setup(metrics(), { premium: false });
      expect(q('live-prop-firm-sound')).toBeNull();
    });

    it('Premium, notifications bloquées : le dit, sans bouton', () => {
      const { q } = setup(metrics({ dailyLoss: dl }), { premium: true, permission: 'denied' });
      expect(q('live-prop-firm-enable-notifications')).toBeNull();
      expect(q('live-prop-firm-notifications-denied')).not.toBeNull();
    });
  });

  it('ordre des jauges : le risque avant le gain (perte du jour, plancher, objectif)', () => {
    const dl = {
      limit: 1000, used: 100, remaining: 900, pct: 0.9, breached: false, breach: 'trading_paused_for_day' as const,
      basis: 'equity' as const, startOfDay: 51000, source: 'broker' as const, approximate: false,
    };
    const { q } = setup(metrics({ dailyLoss: dl }), { premium: true });
    const [a, b, c] = ['live-prop-firm-daily-loss', 'live-prop-firm-drawdown', 'live-prop-firm-objective'].map((id) => q(id)!);
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe('jauge perte du jour : couleur selon la part consommée (seuils de l’app)', () => {
    const dl = (used: number) => ({
      limit: 1000, used, remaining: 1000 - used, pct: (1000 - used) / 1000, breached: used >= 1000,
      breach: 'trading_paused_for_day' as const, basis: 'equity' as const, startOfDay: 51000,
      source: 'broker' as const, approximate: false,
    });
    const fill = (used: number) => {
      const { q } = setup(metrics({ dailyLoss: dl(used) }), { premium: true });
      return q('live-prop-firm-daily-loss')!.querySelector('.bar-fill') as HTMLElement;
    };

    it.each([
      [200, 'dl-green', '20%'],
      [500, 'dl-yellow', '50%'],
      [740, 'dl-yellow', '74%'],
      [750, 'dl-red', '75%'],
      [900, 'dl-red', '90%'],
    ])('%d $ perdus sur 1 000 → %s, barre à %s', (used, cls, width) => {
      const f = fill(used);
      expect(f.className).toContain(cls);
      expect(f.style.width).toBe(width);
      TestBed.resetTestingModule();
    });

    it('plan sans perte journalière (dailyLoss null, Premium) : jauge masquée, pas de teaser', () => {
      const { q } = setup(metrics({ dailyLoss: null, }), { premium: true });
      expect(q('live-prop-firm-daily-loss')).toBeNull();
      expect(q('live-prop-firm-premium-teaser')).toBeNull();
    });
  });
});

describe('Session live — encart du gratuit « tu aurais été alerté » (#769, B4)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });
  const withMargin = (pct: number, breached = false) => {
    const m = metrics();
    return metrics({ drawdown: { ...m.drawdown!, pct, breached } });
  };
  const banner = (el: HTMLElement) =>
    (el.querySelector('[data-testid="live-prop-firm-missed-alert"]')?.textContent ?? '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();

  it('la page de séance transmet l’identifiant de la séance (mémoire « une fois par séance »)', () => {
    expect(SESSION_TEMPLATE).toContain('[sessionId]="session()?.id ?? null"');
  });

  it('marge sous 25 % : « Avec Premium, tu aurais été alerté à 25 % », sans aucune alerte envoyée', () => {
    const { el, alerts } = setup(withMargin(0.2), { sessionId: 's1' });
    expect(banner(el)).toContain('Avec Premium, tu aurais été alerté à 25 % de ta marge avant le plancher.');
    expect(alerts.requestPermission).not.toHaveBeenCalled();
  });

  it('au-dessus de 25 % : rien ; Premium ou démo : jamais', () => {
    expect(setup(withMargin(0.6), { sessionId: 's1' }).q('live-prop-firm-missed-alert')).toBeNull();
    TestBed.resetTestingModule();
    expect(setup(withMargin(0.05), { sessionId: 's1', premium: true }).q('live-prop-firm-missed-alert')).toBeNull();
    TestBed.resetTestingModule();
    expect(setup(withMargin(0.05), { sessionId: 's1', demo: true }).q('live-prop-firm-missed-alert')).toBeNull();
  });

  it('une fois par seuil et par séance : fermé à 25 %, revient à 10 %, plus jamais ensuite dans la séance', () => {
    const { el, fixture, store } = setup(withMargin(0.2), { sessionId: 's1' });
    (el.querySelector('[data-testid="live-prop-firm-missed-close"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(banner(el)).toBe('');
    // La marge remonte puis redescend sous 25 % : même seuil, pas de nouvel encart.
    store.accounts.set([{ ...account(withMargin(0.4)) }]);
    fixture.detectChanges();
    store.accounts.set([{ ...account(withMargin(0.22)) }]);
    fixture.detectChanges();
    expect(banner(el)).toBe('');
    // Nouveau seuil : 10 % (dépassement compris).
    store.accounts.set([{ ...account(withMargin(0, true)) }]);
    fixture.detectChanges();
    expect(banner(el)).toContain('alerté à 10 %');
    (el.querySelector('[data-testid="live-prop-firm-missed-close"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // Même séance rouverte (rechargement) : rien ; autre séance : l'encart revient.
    TestBed.resetTestingModule();
    expect(setup(withMargin(0.05), { sessionId: 's1' }).q('live-prop-firm-missed-alert')).toBeNull();
    TestBed.resetTestingModule();
    expect(banner(setup(withMargin(0.05), { sessionId: 's2' }).el)).toContain('alerté à 10 %');
  });
});
