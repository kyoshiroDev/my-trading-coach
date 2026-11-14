/**
 * Mes comptes · « Supprimer » un compte ARCHIVÉ : suppression définitive du compte et de tous ses
 * trades, jamais au premier clic. Modale explicite (nom, nombre exact de trades lu à l'API, « action
 * définitive », bouton rouge), puis DELETE /accounts/:id/archived. Un compte non archivé garde
 * l'ancien parcours (archivage s'il a de l'historique).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AccountsComponent } from './accounts.component';
import { AccountsApi, TradingAccount } from '../../core/api/accounts.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';
import { ConfirmService } from '@mtc/front-ui';

function acct(id: string, status: 'ACTIVE' | 'ARCHIVED', tradesCount = 0): TradingAccount {
  return {
    id, label: `Compte ${id}`, broker: null, type: 'PERSONAL', status,
    accountSize: null, currency: 'USD', startingBalance: null,
    profitTarget: null, maxDrawdown: null, drawdownType: 'TRAILING', propFirmPlanId: null, platform: null, lastPayoutAt: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    metrics: {
      startingBalance: 5000, realizedPnl: 0, tradingPnl: 0, currentBalance: 5000, tradesCount,
      winRate: null, bestDay: null, worstDay: null,
      objective: null, drawdown: null, drawdownUnconfirmed: false, dailyLoss: null, progress: null, broker: null, estimated: true, disclaimer: 'estimé',
    },
  };
}

function setup(opts: { confirmed?: boolean; brokerConnected?: boolean; deleteImpl?: () => unknown } = {}) {
  const comptes = [acct('act', 'ACTIVE', 3), acct('arc', 'ARCHIVED', 10)];
  const store = {
    accounts: signal(comptes),
    selectedAccountId: signal<string | 'all'>('all'),
    isLoading: signal(false), loadError: signal(false), loaded: signal(true), load: vi.fn(),
  };
  const api = {
    remove: vi.fn(() => of({ data: { archived: true } })),
    create: vi.fn(() => of({ data: {} })),
    // 12 et non 10 : le compte exact vient de l'API (trades ouverts compris), pas des métriques.
    deletionPreview: vi.fn(() => of({ data: { archived: true, tradesCount: 12, sessionsCount: 2, brokerConnected: !!opts.brokerConnected } })),
    deleteArchived: vi.fn(opts.deleteImpl ?? (() => of({ data: { deleted: true, tradesDeleted: 12 } }))),
  };
  const confirm = { ask: vi.fn(() => Promise.resolve(opts.confirmed ?? true)) };

  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: api },
      { provide: SelectedAccountStore, useValue: store },
      { provide: UserStore, useValue: { isDemo: () => false, isPremium: () => true, maxAccounts: signal(null) } },
      { provide: ConfirmService, useValue: confirm },
    ],
  });
  TestBed.overrideComponent(AccountsComponent, {
    set: {
      template: '<div></div>', imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(AccountsComponent);
  fixture.detectChanges();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { cmp: fixture.componentInstance as any, api, store, confirm, comptes };
}

beforeEach(() => {
  TestBed.resetTestingModule();
});

describe('Mes comptes · supprimer un compte archivé', () => {
  it('modale explicite : nom, nombre exact de trades, action définitive, bouton rouge', async () => {
    const { cmp, api, confirm, comptes } = setup({ brokerConnected: true });

    await cmp.confirmDelete(comptes[1]);

    expect(api.deletionPreview).toHaveBeenCalledWith('arc');
    const opts = (confirm.ask.mock.calls[0] as unknown[])[0] as { title: string; message: string; confirmLabel: string; danger: boolean };
    expect(opts.title).toContain('Compte arc');
    expect(opts.message).toContain('12 trades seront supprimés');
    expect(opts.message).toContain('Action définitive');
    expect(opts.message).toContain('connexion Tradovate sera aussi supprimée');
    expect(opts.confirmLabel).toBe('Supprimer le compte et 12 trades');
    expect(opts.danger).toBe(true);
  });

  it('confirmé : DELETE /archived (jamais l\'archivage), comptes rechargés', async () => {
    const { cmp, api, store, comptes } = setup();
    await cmp.confirmDelete(comptes[1]);
    expect(api.deleteArchived).toHaveBeenCalledWith('arc');
    expect(api.remove).not.toHaveBeenCalled();
    expect(store.load).toHaveBeenCalled();
    expect(cmp.deleteError()).toBeNull();
  });

  it('annulé : rien n\'est supprimé', async () => {
    const { cmp, api, comptes } = setup({ confirmed: false });
    await cmp.confirmDelete(comptes[1]);
    expect(api.deleteArchived).not.toHaveBeenCalled();
  });

  it('refus du serveur (ex. désarchivé ailleurs, 409) : message affiché', async () => {
    const message = 'Archive ce compte avant de le supprimer : seul un compte archivé peut être supprimé définitivement.';
    const { cmp, comptes } = setup({ deleteImpl: () => throwError(() => ({ status: 409, error: { message } })) });
    await cmp.confirmDelete(comptes[1]);
    expect(cmp.deleteError()).toBe(message);
  });

  it('compte non archivé : parcours inchangé (archivage par DELETE /accounts/:id), aucune suppression définitive', async () => {
    const { cmp, api, comptes } = setup();
    await cmp.confirmDelete(comptes[0]);
    expect(api.deletionPreview).not.toHaveBeenCalled();
    expect(api.deleteArchived).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledWith('act');
  });
});
