import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TradesStore } from './trades.store';
import { environment } from '../../../environments/environment';

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
    expect(req.request.url).toContain('accountId=acc1');
    req.flush(PAGE);
    http.verify();
  });

  it('loadMore réapplique le filtre accountId (pas seulement le curseur)', () => {
    const { store, http } = setup();
    store.loadTrades({ accountId: 'acc1' });
    http.expectOne((r) => isTrades(r.url)).flush(PAGE);

    store.loadMore();
    const more = http.expectOne((r) => isTrades(r.url));
    expect(more.request.url).toContain('accountId=acc1');
    expect(more.request.url).toContain('cursor=CUR1');
    more.flush({ data: { data: [], nextCursor: null, hasNextPage: false } });
    http.verify();
  });

  it('sans filtre (Tous les comptes) → aucune query accountId', () => {
    const { store, http } = setup();
    store.loadTrades();
    const req = http.expectOne((r) => isTrades(r.url));
    expect(req.request.url).not.toContain('accountId');
    req.flush(PAGE);
    http.verify();
  });
});