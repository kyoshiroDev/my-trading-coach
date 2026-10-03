import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { TradovateStore } from './tradovate.store';
import { TradovateApi, type TradovateConnection } from '../api/tradovate.api';
import { ToastService } from '../services/toast.service';

/**
 * Déconnexion Tradovate : garder ou supprimer les trades importés. La déconnexion n'est jamais
 * annulée par un échec de la suppression : on le dit, et on renvoie vers le journal.
 */
function setup(disconnect: TradovateApi['disconnect']) {
  const api = { disconnect: vi.fn(disconnect) };
  TestBed.configureTestingModule({ providers: [{ provide: TradovateApi, useValue: api }] });
  const store = TestBed.inject(TradovateStore);
  store.connections.set([{ accountId: 'a' } as TradovateConnection, { accountId: 'b' } as TradovateConnection]);
  const toasts = () => TestBed.inject(ToastService).visible().map((t) => ({ type: t.type, message: t.message }));
  return { store, api, toasts };
}

const ok = (tradesDeleted: number | null) => () => of({ data: { disconnected: true as const, tradesDeleted } });

describe('TradovateStore.disconnect', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('par défaut : trades gardés, sans paramètre de suppression', () => {
    const { store, api, toasts } = setup(ok(0));
    const done = vi.fn();
    store.disconnect('a', {}, done);
    expect(api.disconnect).toHaveBeenCalledWith('a', false);
    expect(store.connections().map((c) => c.accountId)).toEqual(['b']);
    expect(toasts()).toEqual([
      { type: 'success', message: 'Compte Tradovate déconnecté. Tes trades déjà importés restent dans ton journal.' },
    ]);
    expect(done).toHaveBeenCalledWith(0);
  });

  it('suppression demandée : nombre supprimé annoncé', () => {
    const { store, api, toasts } = setup(ok(12));
    const done = vi.fn();
    store.disconnect('a', { deleteTrades: true }, done);
    expect(api.disconnect).toHaveBeenCalledWith('a', true);
    expect(toasts()).toEqual([{ type: 'success', message: 'Compte Tradovate déconnecté · 12 trades importés supprimés.' }]);
    expect(done).toHaveBeenCalledWith(12);
  });

  it('suppression en échec après déconnexion : connexion retirée quand même, renvoi vers le journal', () => {
    const { store, toasts } = setup(ok(null));
    store.disconnect('a', { deleteTrades: true });
    expect(store.connections().map((c) => c.accountId)).toEqual(['b']);
    expect(toasts()[0].type).toBe('warning');
    expect(toasts()[0].message).toContain('supprimer depuis le journal');
  });

  it('404 (déjà déconnecté) avec suppression demandée : succès de déconnexion, mais rien n’a été supprimé', () => {
    const { store, toasts } = setup(() => throwError(() => new HttpErrorResponse({ status: 404 })));
    const done = vi.fn();
    store.disconnect('a', { deleteTrades: true }, done);
    expect(store.connections().map((c) => c.accountId)).toEqual(['b']);
    expect(toasts()[0].type).toBe('warning');
    expect(done).toHaveBeenCalledWith(null);
  });
});
