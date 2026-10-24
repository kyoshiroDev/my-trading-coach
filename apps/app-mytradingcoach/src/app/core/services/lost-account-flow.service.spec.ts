import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ConfirmService } from '@mtc/front-ui';
import { LostAccountFlowService } from './lost-account-flow.service';
import { ToastService } from './toast.service';
import { AccountsApi, TradingAccount } from '../api/accounts.api';
import { SelectedAccountStore } from '../stores/selected-account.store';
import { TradesStore } from '../stores/trades.store';
import { UserStore } from '../stores/user.store';
import { DemoService } from './demo.service';

const acc = (id: string, label: string, over: Partial<TradingAccount> = {}): TradingAccount =>
  ({ id, label, status: 'ACTIVE', metrics: { tradesCount: 12 }, ...over }) as TradingAccount;

function setup(opts: { accounts?: TradingAccount[]; confirm?: boolean; demo?: boolean } = {}) {
  const api = {
    update: vi.fn(() => of({ data: {} })),
    purge: vi.fn(() => of({ data: { deleted: true, tradesDeleted: 12 } })),
    retry: vi.fn(() => of({ data: { id: 'new', label: 'Apex 50K #2' } })),
    incidents: vi.fn(() => of({ data: [{ id: 'inc-1' }] as { id: string }[] })),
  };
  const router = { navigate: vi.fn(async () => true) };
  const store = {
    accounts: signal(opts.accounts ?? [acc('a1', 'Apex 50K #1', { status: 'ACTIVE' })]),
    loaded: signal(true),
    isLoading: signal(false),
    load: vi.fn(),
    select: vi.fn(),
  };
  const tradesStore = { reset: vi.fn() };
  const confirm = { ask: vi.fn(async (_o: { title: string; message: string; danger?: boolean }) => opts.confirm ?? true) };
  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: api },
      { provide: SelectedAccountStore, useValue: store },
      { provide: TradesStore, useValue: tradesStore },
      { provide: ConfirmService, useValue: confirm },
      { provide: Router, useValue: router },
      { provide: UserStore, useValue: { isDemo: signal(!!opts.demo) } },
    ],
  });
  return {
    demo: TestBed.inject(DemoService),
    flow: TestBed.inject(LostAccountFlowService),
    toast: TestBed.inject(ToastService),
    api, store, tradesStore, confirm, router,
  };
}

describe('LostAccountFlowService (compte perdu)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('« Marquer comme échoué » ouvre la feuille sans rien enregistrer', () => {
    const { flow, api } = setup();
    flow.openChoice('a1');
    expect(flow.choiceAccount()?.label).toBe('Apex 50K #1');
    expect(api.update).not.toHaveBeenCalled();
  });

  it('Archiver → PATCH ARCHIVED, rechargements et toast, feuille fermée', async () => {
    const { flow, api, store, tradesStore, toast } = setup();
    flow.openChoice('a1');
    await flow.confirmChoice('archive');
    // La feuille confirme l'incident détecté (#669).
    expect(api.update).toHaveBeenCalledWith('a1', { status: 'ARCHIVED', confirmIncident: true });
    expect(store.load).toHaveBeenCalled();
    expect(tradesStore.reset).toHaveBeenCalled();
    expect(flow.choiceId()).toBeNull();
    expect(toast.visible()[0]).toMatchObject({ type: 'success', message: '« Apex 50K #1 » archivé\u00a0: il sort de tes statistiques.' });
  });

  it("toast de confirmation : « Voir l'autopsie » ouvre la dernière autopsie du compte (#669)", async () => {
    const { flow, api, toast, router } = setup();
    flow.openChoice('a1');
    await flow.confirmChoice('keep');
    const t = toast.visible()[0];
    expect(t.action?.label).toBe("Voir l'autopsie");
    t.action!.run();
    expect(api.incidents).toHaveBeenCalledWith('a1');
    expect(router.navigate).toHaveBeenCalledWith(['/accounts', 'a1', 'autopsie', 'inc-1']);
  });

  it("aucune autopsie côté serveur : on le dit, sans navigation", async () => {
    const { flow, api, toast, router } = setup();
    api.incidents.mockReturnValue(of({ data: [] }));
    flow.openChoice('a1');
    await flow.confirmChoice('archive');
    toast.visible()[0].action!.run();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(toast.visible().some((x) => x.message.startsWith("Pas d'autopsie pour ce compte\u00a0:"))).toBe(true);
  });

  it('Garder comme échoué → PATCH FAILED', async () => {
    const { flow, api } = setup();
    flow.openChoice('a1');
    await flow.confirmChoice('keep');
    expect(api.update).toHaveBeenCalledWith('a1', { status: 'FAILED', confirmIncident: true });
  });

  it('Supprimer : confirmation explicite qui rappelle le compte MyTradingCoach et l\'abonnement, puis suppression définitive', async () => {
    const { flow, api, confirm, toast } = setup();
    flow.openChoice('a1');
    await flow.confirmChoice('delete');
    const asked = confirm.ask.mock.calls[0][0];
    expect(asked.danger).toBe(true);
    expect(asked.message).toContain('12 trades');
    expect(asked.message).toContain('Ton compte MyTradingCoach et ton abonnement ne changent pas');
    expect(api.purge).toHaveBeenCalledWith('a1');
    expect(api.update).not.toHaveBeenCalled();
    expect(toast.visible()[0].message).toBe('« Apex 50K #1 » supprimé · 12 trades effacés.');
  });

  it('Supprimer puis renoncer : rien n\'est envoyé, la feuille reste ouverte', async () => {
    const { flow, api } = setup({ confirm: false });
    flow.openChoice('a1');
    await flow.confirmChoice('delete');
    expect(api.purge).not.toHaveBeenCalled();
    expect(flow.choiceId()).toBe('a1');
  });

  it('suppression : un 404 vaut succès (le compte n\'est déjà plus là)', async () => {
    const { flow, api, store, toast } = setup();
    api.purge.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    flow.openChoice('a1');
    await flow.confirmChoice('delete');
    expect(store.load).toHaveBeenCalled();
    expect(toast.visible()[0].type).toBe('success');
    expect(flow.choiceId()).toBeNull();
  });

  it('refus serveur : toast d\'erreur avec le message du back, feuille laissée ouverte', async () => {
    const { flow, api, toast } = setup();
    api.update.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'Refusé par le serveur' } })));
    flow.openChoice('a1');
    await flow.confirmChoice('keep');
    expect(toast.visible()[0]).toMatchObject({ type: 'error', message: 'Refusé par le serveur' });
    expect(flow.choiceId()).toBe('a1');
    expect(flow.busy()).toBe(false);
  });

  it('Archiver un compte échoué (Mes comptes) passe par le PATCH, jamais par DELETE', () => {
    const { flow, api } = setup({ accounts: [acc('k', 'Lucid 25K', { status: 'FAILED' })] });
    flow.archive(acc('k', 'Lucid 25K', { status: 'FAILED' }));
    // Hors de la feuille de choix : aucune confirmation d'incident.
    expect(api.update).toHaveBeenCalledWith('k', { status: 'ARCHIVED' });
  });

  it('Nouvelle tentative : libellé annoncé = plus grand numéro + 1, création par le serveur', () => {
    const { flow, api, store, toast } = setup({
      accounts: [
        acc('a1', 'Apex 50K #1', { status: 'FAILED' }),
        acc('a3', 'Apex 50K #3', { status: 'FAILED' }),
        acc('x', 'Lucid 25K'),
      ],
    });
    flow.openRetry('a1');
    expect(flow.retryLabel()).toBe('Apex 50K #4');
    flow.createRetry();
    expect(api.retry).toHaveBeenCalledWith('a1');
    expect(store.load).toHaveBeenCalled();
    expect(flow.retryId()).toBeNull();
    expect(toast.visible()[0].message).toBe('« Apex 50K #2 » créé\u00a0: il démarre à zéro.');
  });

  it('Nouvelle tentative refusée (quota) : toast d\'erreur, feuille ouverte', () => {
    const { flow, api, toast } = setup({ accounts: [acc('a1', 'Apex 50K', { status: 'FAILED' })] });
    api.retry.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Limite de comptes atteinte' } })));
    flow.openRetry('a1');
    flow.createRetry();
    expect(toast.visible()[0]).toMatchObject({ type: 'error', message: 'Limite de comptes atteinte' });
    expect(flow.retryId()).toBe('a1');
  });

  describe('tentative déjà créée (B3)', () => {
    const accounts = () => [
      acc('a1', 'Apex 50K #1', { status: 'FAILED' }),
      acc('a2', 'Apex 50K #2'),
      acc('x', 'Lucid 25K', { status: 'FAILED' }),
    ];

    it('« Voir Apex 50K #2 » : la tentative suivante est trouvée, aucune pour la dernière', () => {
      const { flow } = setup({ accounts: accounts() });
      expect(flow.newerAttempt({ label: 'Apex 50K #1' })?.id).toBe('a2');
      expect(flow.newerAttempt({ label: 'Apex 50K #2' })).toBeNull();
      expect(flow.newerAttempt({ label: 'Lucid 25K' })).toBeNull();
    });

    it('« Voir Apex 50K #2 » sélectionne ce compte et ouvre Mes comptes', () => {
      const { flow, store, router } = setup({ accounts: accounts() });
      flow.openAttempt('a2');
      expect(store.select).toHaveBeenCalledWith('a2');
      expect(router.navigate).toHaveBeenCalledWith(['/accounts']);
    });

    it('409 RETRY_EXISTS (autre onglet, double clic) : pas d’erreur ni de message de quota, liste rechargée', () => {
      const { flow, api, store, toast } = setup({ accounts: [acc('a1', 'Apex 50K #1', { status: 'FAILED' })] });
      api.retry.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
        status: 409, error: { statusCode: 409, code: 'RETRY_EXISTS', message: '« Apex 50K #2 » existe déjà.' },
      })));
      flow.openRetry('a1');
      flow.createRetry();
      expect(toast.visible()).toHaveLength(0);
      expect(flow.retryId()).toBeNull();
      expect(flow.busy()).toBe(false);
      expect(store.load).toHaveBeenCalled();
    });
  });

  it('depuis l\'alerte live, liste pas encore chargée : elle se charge', () => {
    const { flow, store } = setup();
    store.loaded.set(false);
    flow.openChoice('a1');
    expect(store.load).toHaveBeenCalled();
  });

  describe('démo (lecture seule) : « Crée ton compte » au premier clic', () => {
    it('« Nouvelle tentative » : invite tout de suite, aucune feuille, aucune requête', () => {
      const { flow, api, demo } = setup({ demo: true, accounts: [acc('a1', 'Apex 50K #1', { status: 'FAILED' })] });
      flow.openRetry('a1');
      expect(demo.showSignupPrompt()).toBe(true);
      expect(flow.retryId()).toBeNull();
      flow.createRetry();
      expect(api.retry).not.toHaveBeenCalled();
    });

    it('« Archiver » (compte échoué) : invite tout de suite, aucune requête', () => {
      const { flow, api, demo } = setup({ demo: true });
      flow.archive(acc('a1', 'Apex 50K #1', { status: 'FAILED' }));
      expect(demo.showSignupPrompt()).toBe(true);
      expect(api.update).not.toHaveBeenCalled();
    });

    it('feuille de choix montrée (le parcours), invite à son « Confirmer », sans requête', async () => {
      const { flow, api, demo } = setup({ demo: true });
      flow.openChoice('a1');
      expect(flow.choiceAccount()?.label).toBe('Apex 50K #1');
      expect(demo.showSignupPrompt()).toBe(false);
      for (const c of ['archive', 'keep', 'delete'] as const) {
        flow.openChoice('a1');
        await flow.confirmChoice(c);
        expect(flow.choiceId()).toBeNull();
      }
      expect(demo.showSignupPrompt()).toBe(true);
      expect(api.update).not.toHaveBeenCalled();
      expect(api.purge).not.toHaveBeenCalled();
    });
  });
});
