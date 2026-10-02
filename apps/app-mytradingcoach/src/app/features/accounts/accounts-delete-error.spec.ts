/**
 * la suppression de compte échouait en silence (retour Val, Discord).
 *
 * Le back refuse d'archiver le DERNIER compte actif porteur d'historique — règle
 * correcte, elle évite un utilisateur sans compte où rattacher ses prochains trades.
 * Mais `confirmDelete()` n'avait aucun handler `error:` : le 400 partait dans le vide,
 * le compte restait dans la liste, rien ne s'affichait. D'où « je rafraîchis la page il
 * est toujours dessus c'est normal ? ».
 *
 * Rien ne testait ce chemin : le cas passant était couvert, le cas refusé non.
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

const MESSAGE_BACK =
  "Garde au moins un compte actif. Crée-en un autre avant d'archiver celui-ci.";

function acct(id: string, tradesCount = 0, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE'): TradingAccount {
  return {
    id, label: `Compte ${id}`, broker: null, type: 'PERSONAL', status,
    accountSize: null, currency: 'USD', startingBalance: null,
    profitTarget: null, maxDrawdown: null, drawdownType: 'TRAILING', propFirmPlanId: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    metrics: {
      startingBalance: 5000, realizedPnl: 0, currentBalance: 5000, tradesCount,
      winRate: null, bestDay: null, worstDay: null,
      objective: null, drawdown: null, estimated: true, disclaimer: 'estimé',
    },
  };
}

function setup(comptes: TradingAccount[], removeImpl: () => unknown) {
  const store = {
    accounts: signal(comptes),
    selectedAccountId: signal<string | 'all'>('all'),
    isLoading: signal(false), loaded: signal(true), load: vi.fn(),
  };
  const api = { remove: vi.fn(removeImpl), create: vi.fn(() => of({ data: {} })) };

  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: api },
      { provide: SelectedAccountStore, useValue: store },
      { provide: UserStore, useValue: { isPremium: () => true, maxAccounts: signal(null) } },
      // L'utilisateur confirme la suppression dans le dialogue.
      { provide: ConfirmService, useValue: { ask: vi.fn(() => Promise.resolve(true)) } },
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
  return { cmp: fixture.componentInstance as any, api, store, fixture };
}

beforeEach(() => {
  TestBed.resetTestingModule();
});

describe('Comptes — un refus de suppression est désormais expliqué', () => {
  it('400 du back → le message est affiché tel quel', async () => {
    const { cmp, store } = setup(
      [acct('a', 12)],
      () => throwError(() => ({ error: { message: MESSAGE_BACK } })),
    );

    await cmp.confirmDelete(acct('a', 12));

    expect(
      cmp.deleteError(),
      'Le refus repart dans le vide : le compte reste sans explication',
    ).toBe(MESSAGE_BACK);
    expect(store.load, 'Rien à recharger, la suppression a échoué').not.toHaveBeenCalled();
  });

  it('erreur sans message serveur → repli lisible, jamais « undefined »', async () => {
    const { cmp } = setup([acct('a', 12)], () => throwError(() => new Error('net')));

    await cmp.confirmDelete(acct('a', 12));

    expect(cmp.deleteError()).toBe('Suppression impossible.');
  });

  it('succès → aucun message, liste rechargée (non-régression)', async () => {
    const { cmp, store } = setup(
      [acct('a', 0), acct('b', 5)],
      () => of({ data: { deleted: true } }),
    );

    await cmp.confirmDelete(acct('a', 0));

    expect(cmp.deleteError()).toBeNull();
    expect(store.load).toHaveBeenCalled();
  });

  it('rouvrir un menu efface le message précédent', async () => {
    const { cmp } = setup([acct('a', 12)], () => throwError(() => new Error('net')));
    await cmp.confirmDelete(acct('a', 12));
    expect(cmp.deleteError()).not.toBeNull();

    cmp.toggleMenu('a');

    expect(cmp.deleteError(), 'Message obsolète laissé sous une liste qui a changé').toBeNull();
  });

  it('changer de vue efface le message', async () => {
    const { cmp, store, fixture } = setup([acct('a', 12)], () => throwError(() => new Error('net')));
    await cmp.confirmDelete(acct('a', 12));
    expect(cmp.deleteError()).not.toBeNull();

    store.selectedAccountId.set('a');
    fixture.detectChanges();

    expect(cmp.deleteError()).toBeNull();
  });
});

describe('Comptes — l\'option Supprimer est inerte quand l\'échec est certain', () => {
  it('dernier compte actif AVEC trades → bloqué en amont', async () => {
    const { cmp } = setup([acct('a', 12)], () => of({ data: {} }));
    expect(cmp.suppressionBloquee(acct('a', 12))).toBe(true);
  });

  it('dernier compte actif SANS trade → autorisé (le back le supprime)', async () => {
    // Sur-bloquer serait pire que le bug : le back supprime volontiers un compte vide,
    // même s'il est le dernier.
    const { cmp } = setup([acct('a', 0)], () => of({ data: {} }));
    expect(cmp.suppressionBloquee(acct('a', 0))).toBe(false);
  });

  it('plusieurs comptes actifs → autorisé même avec de l\'historique', () => {
    const { cmp } = setup([acct('a', 12), acct('b', 3)], () => of({ data: {} }));
    expect(cmp.suppressionBloquee(acct('a', 12))).toBe(false);
  });

  it('un compte archivé n\'est jamais bloqué', () => {
    const { cmp } = setup([acct('a', 12, 'ARCHIVED')], () => of({ data: {} }));
    expect(cmp.suppressionBloquee(acct('a', 12, 'ARCHIVED'))).toBe(false);
  });
});
