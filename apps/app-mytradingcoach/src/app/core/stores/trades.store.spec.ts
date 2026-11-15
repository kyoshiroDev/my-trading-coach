import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TradesStore } from './trades.store';
import { environment } from '@app/environments/environment';

const PAGE = { data: { data: [], nextCursor: 'CUR1', hasNextPage: true } };

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), TradesStore],
  });
  return {
    store: TestBed.inject(TradesStore),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('TradesStore — scope compte conservé à la pagination', () => {
  beforeEach(() => TestBed.resetTestingModule());

  const isTrades = (url: string) => url.startsWith(`${environment.apiUrl}/trades`);

  it('loadTrades transmet accountId en query', () => {
    const { store, http } = setup();
    store.loadTrades({ accountId: 'acc1' });
    const req = http.expectOne((r) => isTrades(r.url));
    expect(req.request.urlWithParams).toContain('accountId=acc1');
    req.flush(PAGE);
    http.verify();
  });

  it('loadMore réapplique le filtre accountId (pas seulement le curseur)', () => {
    const { store, http } = setup();
    store.loadTrades({ accountId: 'acc1' });
    http.expectOne((r) => isTrades(r.url)).flush(PAGE);

    store.loadMore();
    const more = http.expectOne((r) => isTrades(r.url));
    expect(more.request.urlWithParams).toContain('accountId=acc1');
    expect(more.request.urlWithParams).toContain('cursor=CUR1');
    more.flush({ data: { data: [], nextCursor: null, hasNextPage: false } });
    http.verify();
  });

  it('sans filtre (Tous les comptes) → aucune query accountId', () => {
    const { store, http } = setup();
    store.loadTrades();
    const req = http.expectOne((r) => isTrades(r.url));
    expect(req.request.urlWithParams).not.toContain('accountId');
    req.flush(PAGE);
    http.verify();
  });
});
// Audit fonctionnel #994 (lot 1c) — F7 : réponses dans le désordre (filtres rapides, « Charger plus »
// puis changement de filtre) ; N10 : supprimer le trade servant de curseur coupait la pagination.
describe('TradesStore — réponses périmées et curseur', () => {
  beforeEach(() => TestBed.resetTestingModule());
  const isTrades = (url: string) => url.startsWith(`${environment.apiUrl}/trades`) && !url.includes('/stats');
  const t = (id: string) => ({ id, pnl: 1, commission: 0 });

  it('deux chargements successifs, réponses inversées : la dernière demande l’emporte', () => {
    const { store, http } = setup();
    store.loadTrades({ result: 'WIN' });
    store.loadTrades({ result: 'LOSS' });
    const [win, loss] = http.match((r) => isTrades(r.url));
    loss.flush({ data: { data: [t('loss')], nextCursor: null, hasNextPage: false } });
    win.flush({ data: { data: [t('win')], nextCursor: null, hasNextPage: false } });
    expect(store.trades().map((x) => x.id)).toEqual(['loss']);
  });

  it('« Charger plus » puis changement de filtre : la page de l’ancien filtre n’est pas ajoutée', () => {
    const { store, http } = setup();
    store.loadTrades({ result: 'WIN' });
    http.expectOne((r) => isTrades(r.url)).flush({ data: { data: [t('w1')], nextCursor: 'w1', hasNextPage: true } });
    store.loadMore();
    store.loadTrades({ result: 'LOSS' });
    const [more, loss] = http.match((r) => isTrades(r.url));
    loss.flush({ data: { data: [t('l1')], nextCursor: null, hasNextPage: false } });
    more.flush({ data: { data: [t('w2')], nextCursor: null, hasNextPage: false } });
    expect(store.trades().map((x) => x.id)).toEqual(['l1']);
  });

  it('suppression du trade servant de curseur : le curseur passe au dernier trade restant', () => {
    const { store, http } = setup();
    store.loadTrades();
    http.expectOne((r) => isTrades(r.url)).flush({ data: { data: [t('a'), t('b')], nextCursor: 'b', hasNextPage: true } });
    store.removeTrade('b');
    expect(store.nextCursor()).toBe('a');
  });

  it('tous les trades chargés supprimés alors qu’il en reste au serveur : la 1re page est relue', () => {
    const { store, http } = setup();
    store.loadTrades({ accountId: 'acc1' });
    http.expectOne((r) => isTrades(r.url)).flush({ data: { data: [t('a'), t('b')], nextCursor: 'b', hasNextPage: true } });
    store.removeTrade('a');
    store.removeTrade('b');
    const reload = http.expectOne((r) => isTrades(r.url));
    expect(reload.request.urlWithParams).toContain('accountId=acc1');
    expect(reload.request.urlWithParams).not.toContain('cursor=');
    reload.flush({ data: { data: [t('c')], nextCursor: null, hasNextPage: false } });
    expect(store.trades().map((x) => x.id)).toEqual(['c']);
  });
});
