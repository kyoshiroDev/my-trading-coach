import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import { SessionLiveComponent } from './session-live.component';
import type { TradingSession } from '@app/core/api/session.api';
import type { TradingAccount } from '@app/core/api/accounts.api';
import type { TradovateConnection } from '@app/core/api/tradovate.api';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradovateStore } from '@app/core/stores/tradovate.store';
import { MoneyService } from '@app/core/services/money.service';
import TEMPLATE from './session-live.component.html?raw';

/**
 * Session live v3 : suivi prop firm quand le compte de la session est synchronisé (Trade rapide
 * sur demande, « Saisir un trade à la main »), sinon P&L du jour + Trade rapide toujours affiché.
 */

const account = (type: TradingAccount['type']): TradingAccount => ({
  id: 'a', label: 'Apex 50k', broker: null, type, status: 'ACTIVE', accountSize: 50000,
  currency: 'USD', startingBalance: 50000, profitTarget: null, maxDrawdown: null,
  drawdownType: 'TRAILING', propFirmPlanId: null, platform: null, lastPayoutAt: null,
  createdAt: '', updatedAt: '',
  metrics: {
    startingBalance: 50000, realizedPnl: 0, currentBalance: 50000, tradesCount: 0, winRate: null,
    bestDay: null, worstDay: null, objective: null, drawdown: null, drawdownUnconfirmed: false, dailyLoss: null,
    progress: null, broker: null, estimated: true, disclaimer: 'estimé',
  },
});

const conn: TradovateConnection = {
  accountId: 'a', status: 'CONNECTED', externalAccountId: '1', externalAccountName: 'APEX-1',
  externalEnv: 'demo', availableAccounts: [], needsAccountSelection: false, lastSyncAt: null,
  lastSyncError: null, tradesImported: 0, brokerTradesCount: 0, connectedAt: '',
};

function setup(opts: { type?: TradingAccount['type']; connected?: boolean; loaded?: boolean }) {
  const connections = signal(opts.connected === false ? [] : [conn]);
  // Par défaut, connexions déjà chargées (cas « passé par Mes comptes »).
  const loaded = signal(opts.loaded ?? true);
  const load = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: SelectedAccountStore, useValue: { accounts: signal([account(opts.type ?? 'EVALUATION')]) } },
      {
        provide: TradovateStore,
        useValue: {
          byAccount: computed(() => new Map(connections().map((c) => [c.accountId, c] as const))),
          loaded,
          load,
        },
      },
      { provide: MoneyService, useValue: { format: () => '$0', formatFor: () => '$0' } },
    ],
  });
  TestBed.overrideComponent(SessionLiveComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(SessionLiveComponent);
  const session = { id: 's', status: 'ACTIVE', accountId: 'a' } as unknown as TradingSession;
  // Entrées signal non alimentées en JIT (cf. angular.md) : remplacées avant le premier rendu.
  (fixture.componentInstance as unknown as { session: () => TradingSession }).session = signal(session);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, connections, load };
}

describe('Session live — suivi prop firm à la place de Trade rapide', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('compte d’éval synchronisé : suivi prop firm, pas de Trade rapide', () => {
    const { el } = setup({});
    expect(el.querySelector('mtc-live-prop-firm')).not.toBeNull();
    expect(el.querySelector('mtc-quick-trade')).toBeNull();
  });

  it('compte non synchronisé ou compte perso : P&L du jour, lien prop firm et Trade rapide', () => {
    const unsynced = setup({ connected: false }).el;
    expect(unsynced.querySelector('mtc-quick-trade')).not.toBeNull();
    expect(unsynced.querySelector('[data-testid="live-account-summary"]')).not.toBeNull();
    expect(unsynced.querySelector('[data-testid="link-prop-firm"]')?.textContent).toContain('Lier un compte prop firm');
    TestBed.resetTestingModule();
    const perso = setup({ type: 'PERSONAL' }).el;
    expect(perso.querySelector('mtc-quick-trade')).not.toBeNull();
    expect(perso.querySelector('mtc-live-prop-firm')).toBeNull();
  });

  it('ordre mobile : bandeau, annonce, trade en cours, suivi du compte, clôturés, puis contexte et clôture', () => {
    const { el } = setup({});
    const order = ['mtc-live-bar', 'mtc-live-next-event', 'mtc-live-position', 'mtc-live-prop-firm', 'mtc-live-closed-trades', '[data-testid="open-context"]', '[data-testid="close-session-live"]']
      .map((sel) => el.querySelector(sel));
    expect(order.every(Boolean)).toBe(true);
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('« Clôturer la session » prévient le parent ; « Contexte marché » ouvre la feuille', () => {
    const { el, fixture } = setup({});
    const spy = vi.fn();
    fixture.componentInstance.closeSession.subscribe(spy);
    (el.querySelector('[data-testid="close-session-live"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
    expect(el.querySelector('[data-testid="context-sheet"]')).toBeNull();
    (el.querySelector('[data-testid="open-context"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="context-sheet"]')).not.toBeNull();
  });

  it('« Saisir un trade à la main » puis « Fermer la saisie » : aller-retour', () => {
    const { el, fixture } = setup({});
    const cmp = fixture.componentInstance as unknown as { manualEntry: { set: (v: boolean) => void } };
    cmp.manualEntry.set(true);
    fixture.detectChanges();
    expect(el.querySelector('mtc-quick-trade')).not.toBeNull();
    expect(el.querySelector('mtc-live-prop-firm'), 'le suivi reste affiché').not.toBeNull();
    (el.querySelector('[data-testid="back-to-prop-firm"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('mtc-quick-trade')).toBeNull();
  });

  it('ouverture directe ou F5 (connexions pas encore chargées) : les charge, puis affiche le suivi', () => {
    const { el, fixture, connections, load } = setup({ connected: false, loaded: false });
    expect(load).toHaveBeenCalledOnce();
    expect(el.querySelector('mtc-quick-trade')).not.toBeNull(); // en attendant la réponse
    connections.set([conn]); // réponse de l'API
    fixture.detectChanges();
    expect(el.querySelector('mtc-live-prop-firm')).not.toBeNull();
  });

  it('connexions déjà chargées : pas de nouvel appel', () => {
    expect(setup({}).load).not.toHaveBeenCalled();
  });
});
