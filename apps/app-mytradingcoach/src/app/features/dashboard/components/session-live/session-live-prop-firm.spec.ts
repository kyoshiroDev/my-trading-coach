import { describe, it, expect, beforeEach } from 'vitest';
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
 * Colonne droite de la session live : suivi prop firm à la place de Trade rapide quand le compte
 * de la session est synchronisé, Trade rapide sinon, et retour possible à la saisie manuelle.
 */

const account = (type: TradingAccount['type']): TradingAccount => ({
  id: 'a', label: 'Apex 50k', broker: null, type, status: 'ACTIVE', accountSize: 50000,
  currency: 'USD', startingBalance: 50000, profitTarget: null, maxDrawdown: null,
  drawdownType: 'TRAILING', propFirmPlanId: null, platform: null, lastPayoutAt: null,
  createdAt: '', updatedAt: '',
  metrics: {
    startingBalance: 50000, realizedPnl: 0, currentBalance: 50000, tradesCount: 0, winRate: null,
    bestDay: null, worstDay: null, objective: null, drawdown: null, drawdownUnconfirmed: false,
    progress: null, broker: null, estimated: true, disclaimer: 'estimé',
  },
});

const conn: TradovateConnection = {
  accountId: 'a', status: 'CONNECTED', externalAccountId: '1', externalAccountName: 'APEX-1',
  externalEnv: 'demo', availableAccounts: [], needsAccountSelection: false, lastSyncAt: null,
  lastSyncError: null, tradesImported: 0, brokerTradesCount: 0, connectedAt: '',
};

function setup(opts: { type?: TradingAccount['type']; connected?: boolean }) {
  const connections = signal(opts.connected === false ? [] : [conn]);
  TestBed.configureTestingModule({
    providers: [
      { provide: SelectedAccountStore, useValue: { accounts: signal([account(opts.type ?? 'EVALUATION')]) } },
      {
        provide: TradovateStore,
        useValue: { byAccount: computed(() => new Map(connections().map((c) => [c.accountId, c] as const))) },
      },
      { provide: MoneyService, useValue: { format: () => '$0' } },
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
  return { fixture, el };
}

describe('Session live — suivi prop firm à la place de Trade rapide', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('compte d’éval synchronisé : suivi prop firm, pas de Trade rapide', () => {
    const { el } = setup({});
    expect(el.querySelector('mtc-live-prop-firm')).not.toBeNull();
    expect(el.querySelector('mtc-quick-trade')).toBeNull();
  });

  it('compte non synchronisé ou compte perso : Trade rapide, comme avant', () => {
    expect(setup({ connected: false }).el.querySelector('mtc-quick-trade')).not.toBeNull();
    TestBed.resetTestingModule();
    const perso = setup({ type: 'PERSONAL' }).el;
    expect(perso.querySelector('mtc-quick-trade')).not.toBeNull();
    expect(perso.querySelector('mtc-live-prop-firm')).toBeNull();
  });

  it('« Saisir un trade à la main » puis « Suivi du compte » : aller-retour', () => {
    const { el, fixture } = setup({});
    const cmp = fixture.componentInstance as unknown as { manualEntry: { set: (v: boolean) => void } };
    cmp.manualEntry.set(true);
    fixture.detectChanges();
    expect(el.querySelector('mtc-quick-trade')).not.toBeNull();
    (el.querySelector('[data-testid="back-to-prop-firm"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('mtc-live-prop-firm')).not.toBeNull();
    expect(el.querySelector('mtc-quick-trade')).toBeNull();
  });
});
