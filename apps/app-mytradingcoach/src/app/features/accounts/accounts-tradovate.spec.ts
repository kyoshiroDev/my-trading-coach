import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AccountsComponent } from './accounts.component';
import { AccountsApi, TradingAccount } from '../../core/api/accounts.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';
import { TradesStore } from '../../core/stores/trades.store';
import { TradovateApi } from '../../core/api/tradovate.api';
import { TradovateStore, TradovateFeedback, TradovateBusy } from '../../core/stores/tradovate.store';
import type { TradovateConnection } from '../../core/api/tradovate.api';
import { ToastService } from '../../core/services/toast.service';
import TEMPLATE from './accounts.component.html?raw';

/**
 * Écran « Mes comptes » : connexion / synchro / déconnexion Tradovate PAR compte.
 * VRAI template (import `?raw`) ; seuls les composants enfants et les icônes Lucide sont
 * neutralisés (NO_ERRORS_SCHEMA), car ils ne compilent pas en JIT sous vitest.
 */

function acct(id: string, label: string, p: Partial<TradingAccount> = {}): TradingAccount {
  return {
    id, label, broker: null, type: 'EVALUATION', status: 'ACTIVE',
    accountSize: null, currency: 'USD', startingBalance: 50000,
    profitTarget: null, maxDrawdown: null, drawdownType: 'TRAILING', propFirmPlanId: null, platform: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    metrics: {
      startingBalance: 50000, realizedPnl: 0, currentBalance: 50000, tradesCount: 0,
      winRate: null, bestDay: null, worstDay: null,
      objective: null, drawdown: null, drawdownUnconfirmed: false, broker: null, estimated: true, disclaimer: 'estimé',
    },
    ...p,
  };
}

function conn(accountId: string, p: Partial<TradovateConnection> = {}): TradovateConnection {
  return {
    accountId, status: 'CONNECTED', externalAccountId: '65040981', externalAccountName: 'APEX-1234-01',
    externalEnv: 'demo', availableAccounts: [{ id: '65040981', name: 'APEX-1234-01', env: 'demo' }],
    needsAccountSelection: false, lastSyncAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    lastSyncError: null, tradesImported: 34, brokerTradesCount: 0, connectedAt: '2026-09-01T00:00:00.000Z',
    ...p,
  };
}

function setup(opts: {
  accounts: TradingAccount[];
  connections?: TradovateConnection[];
  busy?: Record<string, TradovateBusy>;
  feedback?: Record<string, TradovateFeedback>;
  query?: Record<string, string>;
}) {
  const connections = signal(opts.connections ?? []);
  const tv = {
    connections,
    byAccount: computed(() => new Map(connections().map((c) => [c.accountId, c] as const))),
    busy: signal<Record<string, TradovateBusy | undefined>>(opts.busy ?? {}),
    feedback: signal<Record<string, TradovateFeedback | undefined>>(opts.feedback ?? {}),
    loaded: signal(true),
    load: vi.fn(), sync: vi.fn(), selectThenSync: vi.fn(), disconnect: vi.fn(), setFeedback: vi.fn(),
  };
  const router = {
    routerState: { snapshot: { root: { queryParams: opts.query ?? {} } } },
    navigate: vi.fn(),
  };
  const store = {
    accounts: signal(opts.accounts),
    selectedAccountId: signal<string | 'all'>('all'),
    isLoading: signal(false), loaded: signal(true), load: vi.fn(),
  };
  const tradesStore = { reset: vi.fn() };
  const tvApi = { refreshBalance: vi.fn(() => of({ data: {} })) };

  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: { create: vi.fn(() => of({ data: {} })) } },
      { provide: SelectedAccountStore, useValue: store },
      { provide: UserStore, useValue: { isDemo: () => false, isPremium: () => true, maxAccounts: signal(null) } },
      { provide: TradovateStore, useValue: tv },
      { provide: TradovateApi, useValue: tvApi },
      { provide: TradesStore, useValue: tradesStore },
      { provide: Router, useValue: router },
    ],
  });
  TestBed.overrideComponent(AccountsComponent, {
    set: {
      template: TEMPLATE,
      imports: [DecimalPipe, FormsModule],
      styleUrls: [], styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(AccountsComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const click = (id: string) => { q(id)!.click(); fixture.detectChanges(); };
  return { fixture, el, q, click, tv, router, store, tradesStore, tvApi };
}

describe('Mes comptes — connexion Tradovate par compte', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('non connecté : pilule « Non connecté » + bouton qui ouvre l’écran de réassurance (pas de redirection directe)', () => {
    const { q, click, el } = setup({ accounts: [acct('a', 'Apex 50k')] });
    expect(q('tradovate-status-a')!.textContent).toContain('Non connecté');
    expect(el.querySelector('mtc-tradovate-connect-modal')).toBeNull();

    click('tradovate-connect-a');
    const modal = el.querySelector('mtc-tradovate-connect-modal');
    expect(modal, 'l’écran de réassurance doit s’afficher avant toute redirection').not.toBeNull();
    expect(modal!.getAttribute('origin')).toBe('settings');
  });

  it('connecté : pilule verte, dernière synchro + cumul, bouton Synchroniser câblé sur CE compte', () => {
    const { q, click, tv } = setup({ accounts: [acct('a', 'Apex 50k')], connections: [conn('a')] });
    expect(q('tradovate-status-a')!.textContent).toContain('Connecté');
    const line = q('tradovate-last-sync-a')!.textContent!.replace(/\s+/g, ' ');
    expect(line).toContain('APEX-1234-01');
    expect(line).toContain('Dernière synchro : il y a 2 h');
    expect(line).toContain('34 trades importés');

    click('tradovate-sync-a');
    expect(tv.sync).toHaveBeenCalledWith('a', expect.any(Function));
  });

  it('synchro en cours : bouton désactivé avec spinner/libellé, pas de double-clic', () => {
    const { q } = setup({ accounts: [acct('a', 'A')], connections: [conn('a')], busy: { a: 'sync' } });
    const btn = q('tradovate-sync-a') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Synchronisation…');
  });

  it('deux comptes (Apex + Lucid) : deux lignes indépendantes', () => {
    const { q } = setup({
      accounts: [acct('apex', 'Apex 50k'), acct('lucid', 'Lucid 25k')],
      connections: [conn('apex')],
    });
    expect(q('tradovate-status-apex')!.textContent).toContain('Connecté');
    expect(q('tradovate-status-lucid')!.textContent).toContain('Non connecté');
    expect(q('tradovate-sync-apex')).not.toBeNull();
    expect(q('tradovate-sync-lucid')).toBeNull();
    expect(q('tradovate-connect-lucid')).not.toBeNull();
  });

  it('déconnexion : confirmation d’abord, puis révocation de CE compte seulement', () => {
    const { q, click, tv } = setup({ accounts: [acct('a', 'A')], connections: [conn('a')] });
    click('tradovate-disconnect-a');
    expect(tv.disconnect).not.toHaveBeenCalled();
    expect(q('tradovate-row-a')!.textContent).toContain('Déconnecter ce compte');

    click('tradovate-disconnect-confirm-a');
    expect(tv.disconnect).toHaveBeenCalledWith('a', { deleteTrades: false }, expect.any(Function));
  });

  it('déconnexion d’un compte sans trade importé : simple « Oui », pas de choix de suppression', () => {
    const { q, click } = setup({ accounts: [acct('a', 'A')], connections: [conn('a', { brokerTradesCount: 0 })] });
    click('tradovate-disconnect-a');
    expect(q('tradovate-disconnect-confirm-a')).not.toBeNull();
    expect(q('tradovate-disconnect-choice-a')).toBeNull();
  });

  it('déconnexion avec trades importés : nombre affiché AVANT, choix garder (défaut) ou supprimer', () => {
    const { q, click, tv } = setup({ accounts: [acct('a', 'A')], connections: [conn('a', { brokerTradesCount: 12 })] });
    click('tradovate-disconnect-a');
    expect(q('tradovate-disconnect-confirm-a'), 'plus de « Oui » ambigu').toBeNull();
    const count = q('tradovate-disconnect-count-a')!.textContent!.replace(/\s+/g, ' ');
    expect(count).toContain('12 trades importés');
    expect(count).toContain('saisis à la main');
    // Garder vient en premier : c'est le choix par défaut.
    const actions = [...q('tradovate-disconnect-choice-a')!.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'));
    expect(actions).toEqual(['tradovate-disconnect-keep-a', 'tradovate-disconnect-delete-a']);
    expect(q('tradovate-disconnect-delete-a')!.textContent).toContain('supprimer les 12 trades importés');
    expect(tv.disconnect).not.toHaveBeenCalled();

    click('tradovate-disconnect-keep-a');
    expect(tv.disconnect).toHaveBeenCalledWith('a', { deleteTrades: false }, expect.any(Function));
  });

  it('déconnexion « supprimer les trades importés » : suppression demandée, métriques rechargées', () => {
    const { click, tv, store, tradesStore } = setup({ accounts: [acct('a', 'A')], connections: [conn('a', { brokerTradesCount: 12 })] });
    click('tradovate-disconnect-a');
    click('tradovate-disconnect-delete-a');
    expect(tv.disconnect).toHaveBeenCalledWith('a', { deleteTrades: true }, expect.any(Function));

    const done = tv.disconnect.mock.calls[0][2] as (n: number | null) => void;
    done(12);
    expect(store.load).toHaveBeenCalled();
    expect(tradesStore.reset).toHaveBeenCalled();
  });

  it('déconnexion : Annuler referme le choix sans rien déconnecter', () => {
    const { q, click, tv } = setup({ accounts: [acct('a', 'A')], connections: [conn('a', { brokerTradesCount: 3 })] });
    click('tradovate-disconnect-a');
    click('tradovate-disconnect-cancel-a');
    expect(q('tradovate-disconnect-choice-a')).toBeNull();
    expect(tv.disconnect).not.toHaveBeenCalled();
  });

  it('connexion expirée : « À reconnecter » + message du back + bouton qui rouvre la réassurance', () => {
    const { q, click, el } = setup({
      accounts: [acct('a', 'A')],
      connections: [conn('a', { status: 'NEEDS_RECONNECT', lastSyncError: 'Connexion expirée ou révoquée : reconnecte ton compte Tradovate.' })],
    });
    expect(q('tradovate-status-a')!.textContent).toContain('À reconnecter');
    expect(q('tradovate-row-a')!.textContent).toContain('Connexion expirée ou révoquée');
    expect(q('tradovate-sync-a')).toBeNull();
    click('tradovate-reconnect-a');
    expect(el.querySelector('mtc-tradovate-connect-modal')).not.toBeNull();
  });

  it('login à plusieurs comptes : le sélecteur remplace les boutons de synchro', () => {
    const { q, el } = setup({
      accounts: [acct('a', 'A')],
      connections: [conn('a', { externalAccountId: null, externalAccountName: null, needsAccountSelection: true })],
    });
    expect(el.querySelector('mtc-tradovate-account-picker')).not.toBeNull();
    expect(q('tradovate-sync-a')).toBeNull();
  });

  it('choix du compte en attente (mauvais login) : Déconnecter reste rendu et cliquable', () => {
    const { q, click, tv, el } = setup({
      accounts: [acct('a', 'A')],
      connections: [conn('a', { externalAccountId: null, externalAccountName: null, needsAccountSelection: true })],
    });
    expect(el.querySelector('mtc-tradovate-account-picker')).not.toBeNull();
    const btn = q('tradovate-disconnect-a') as HTMLButtonElement | null;
    expect(btn, 'sans ce bouton, l’utilisateur est coincé sur le mauvais login').not.toBeNull();
    expect(btn!.disabled).toBe(false);

    click('tradovate-disconnect-a');
    click('tradovate-disconnect-confirm-a');
    expect(tv.disconnect).toHaveBeenCalledWith('a', { deleteTrades: false }, expect.any(Function));
  });

  it('résultat de synchro : lignes + avertissements, et erreur claire', () => {
    const { q } = setup({
      accounts: [acct('a', 'A'), acct('b', 'B')],
      connections: [conn('a'), conn('b')],
      feedback: {
        a: { lines: [{ text: '34 trades synchronisés', warn: false }, { text: 'Frais non importés · P&L brut affiché.', warn: true }], error: null },
        b: { lines: [], error: 'Tradovate limite temporairement les requêtes. Réessaie dans quelques minutes.' },
      },
    });
    const a = q('tradovate-feedback-a')!;
    expect(a.textContent).toContain('34 trades synchronisés');
    expect(a.querySelector('.tv-fb.warn')!.textContent).toContain('P&L brut');
    expect(q('tradovate-feedback-b')!.textContent).toContain('Tradovate limite temporairement');
  });

  it('compte archivé non connecté : pas de bouton de connexion', () => {
    const { q } = setup({ accounts: [acct('a', 'A', { status: 'ARCHIVED' })] });
    expect(q('tradovate-connect-a')).toBeNull();
  });

  it('disclaimer lecture seule sous la liste', () => {
    const { q } = setup({ accounts: [acct('a', 'A')] });
    const text = q('tradovate-disclaimer')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain("référencé dans l'écosystème NinjaTrader");
    expect(text).toContain("aucun ordre n'est passé");
    expect(text).toContain('risque de perte en capital');
  });
});

describe('Mes comptes — retour du consentement Tradovate (toasts)', () => {
  beforeEach(() => TestBed.resetTestingModule());
  const toasts = () => TestBed.inject(ToastService).visible().map((t) => ({ type: t.type, message: t.message }));

  it('succès : toast « Compte connecté · N trades synchronisés » + alerte frais, données rechargées, URL nettoyée', () => {
    const { el, router, store, tradesStore } = setup({
      accounts: [acct('a', 'A')],
      query: { tradovate: 'connected', accountId: 'a', trades: '34', fees: 'partial' },
    });
    expect(toasts()).toEqual([
      { type: 'success', message: 'Compte connecté · 34 trades synchronisés' },
      { type: 'warning', message: 'Frais non rapprochés sur certains trades · vérifie le P&L net.' },
    ]);
    expect(el.querySelector('[data-testid="tradovate-return-banner"]'), 'plus de bandeau').toBeNull();
    expect(store.load).toHaveBeenCalled();
    expect(tradesStore.reset).toHaveBeenCalled();

    const [commands, extras] = router.navigate.mock.calls[0];
    expect(commands).toEqual([]);
    expect(extras).toMatchObject({ replaceUrl: true, queryParamsHandling: 'merge' });
    expect(extras.queryParams).toMatchObject({ tradovate: null, trades: null, accountId: null, reason: null });
  });

  it('première synchro en échec : connecté quand même, alerte pour relancer', () => {
    setup({ accounts: [acct('a', 'A')], query: { tradovate: 'connected', accountId: 'a', sync: 'error' } });
    expect(toasts()[0].type).toBe('warning');
    expect(toasts()[0].message).toContain('Synchroniser');
  });

  it('choix du compte à confirmer + compte écarté : info puis avertissement explicite', () => {
    setup({ accounts: [acct('a', 'A')], query: { tradovate: 'select_account', accountId: 'a', excluded: '1' } });
    const t = toasts();
    expect(t[0]).toEqual({ type: 'info', message: 'Compte Tradovate connecté : confirme ci-dessous le compte à synchroniser.' });
    expect(t[1].type).toBe('warning');
    expect(t[1].message).toContain('déjà relié à un autre compte MyTradingCoach');
  });

  it('échec : toast d’erreur clair', () => {
    setup({ accounts: [acct('a', 'A')], query: { tradovate: 'error', reason: 'denied', accountId: 'a' } });
    expect(toasts()).toEqual([{ type: 'error', message: "Tu as refusé l'accès sur Tradovate : aucune donnée n'a été lue." }]);
  });

  it('retour destiné au wizard : ignoré ici (l’onboarding le traite)', () => {
    const { router } = setup({
      accounts: [acct('a', 'A')],
      query: { tradovate: 'connected', accountId: 'a', trades: '3', from: 'wizard' },
    });
    expect(toasts()).toEqual([]);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('aucun retour : ni toast ni navigation', () => {
    const { router } = setup({ accounts: [acct('a', 'A')] });
    expect(toasts()).toEqual([]);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('Mes comptes — solde lu chez le broker', () => {
  beforeEach(() => TestBed.resetTestingModule());

  const withBroker = (id: string, broker: NonNullable<TradingAccount['metrics']['broker']>) =>
    acct(id, 'Apex 50k', {
      metrics: { ...acct(id, '').metrics, currentBalance: broker.cashBalance, broker },
    });
  const live = {
    cashBalance: 50_500, equity: 48_700, openPnl: -1_800, openPositions: 1,
    balanceAt: new Date().toISOString(), equityAt: new Date().toISOString(), referenceMismatch: false,
  };

  it('ouverture de la page : solde relu UNE fois pour chaque compte connecté, puis liste rechargée', () => {
    const { tvApi, store } = setup({
      accounts: [acct('a', 'Apex 50k'), acct('b', 'Lucid'), acct('c', 'TPT')],
      connections: [conn('a'), conn('b', { status: 'NEEDS_RECONNECT' }), conn('c', { needsAccountSelection: true })],
    });
    expect(tvApi.refreshBalance).toHaveBeenCalledTimes(1);
    expect(tvApi.refreshBalance).toHaveBeenCalledWith('a');
    expect(store.load).toHaveBeenCalled();
  });

  it('dépli : solde, equity et latent du broker, avec « Actualiser » sur CE compte', () => {
    const { q, click, tvApi } = setup({ accounts: [withBroker('a', live)], connections: [conn('a')] });
    click('account-expand-a');
    const line = q('account-broker-a')!.textContent!.replace(/\s+/g, ' ');
    expect(line).toContain('Chez le broker');
    expect(line).toContain('$50,500');
    expect(line).toContain('$48,700');
    expect(line).toContain('1 position ouverte');
    tvApi.refreshBalance.mockClear();
    click('broker-refresh-a');
    expect(tvApi.refreshBalance).toHaveBeenCalledWith('a');
  });

  it('solde de départ incompatible avec le broker : avertissement explicite', () => {
    const { q, click } = setup({ accounts: [withBroker('a', { ...live, referenceMismatch: true })], connections: [conn('a')] });
    click('account-expand-a');
    expect(q('broker-reference-mismatch')!.textContent).toContain('ne correspond pas au solde du broker');
  });
});

describe('Mes comptes — verrouillage selon la plateforme', () => {
  beforeEach(() => TestBed.resetTestingModule());

  const rule = (over: Partial<NonNullable<NonNullable<TradingAccount['metrics']['drawdown']>['rule']>>) => ({
    firmName: 'Apex Trader Funding', planName: 'EOD Trail', phase: 'evaluation' as const, kind: 'trailing_eod' as const,
    locksAt: null, lockedFloor: null, locked: false, realtimeEquity: true, platform: null, platformChoices: [], ...over,
  });
  const withRule = (r: ReturnType<typeof rule>) => acct('a', 'Apex 50k', {
    propFirmPlanId: 'apex-eod-50k',
    metrics: {
      ...acct('a', '').metrics,
      drawdown: { type: 'TRAILING', floor: 53_500, margin: 1_000, maxDrawdown: 2_000, pct: 0.5, breached: false, source: 'plan', rule: r },
    },
  });

  it('plateforme inconnue alors que le verrouillage en dépend : avertissement et plateformes citées', () => {
    const { q, click } = setup({ accounts: [withRule(rule({ platformChoices: ['rithmic', 'tradovate', 'wealthcharts'] }))] });
    click('account-expand-a');
    const warn = q('dd-platform-unknown')!.textContent!.replace(/\s+/g, ' ');
    expect(warn).toContain('Rithmic, Tradovate, Wealthcharts');
    expect(warn).toContain('le plus prudent');
  });

  it('plateforme connue : règle appliquée affichée, pas d\'avertissement', () => {
    const { q, click } = setup({ accounts: [withRule(rule({ platform: 'rithmic', locksAt: 55_000, lockedFloor: 53_000, locked: true }))] });
    click('account-expand-a');
    expect(q('dd-basis')!.textContent).toContain('règle Rithmic');
    expect(q('dd-platform-unknown')).toBeNull();
  });
});

