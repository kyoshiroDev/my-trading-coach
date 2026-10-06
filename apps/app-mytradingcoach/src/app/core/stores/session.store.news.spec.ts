import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { SessionStore } from './session.store';
import { EcoSocketService } from '../services/eco-socket.service';
import type { TradingSession } from '../api/session.api';
import type { MarketContext, NewsItem } from '../api/trades.api';

/**
 * Bandeau BREAKING de la session live : la news vient du drapeau `breaking` calculé par l'API.
 * Avant : première news dont le titre contenait « fed », souvent du Bitcoin (06/10/2026).
 */
describe('SessionStore — bandeau breaking', () => {
  const socket = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    marketContext$: new Subject<MarketContext>(),
    connected$: new Subject<void>(),
    newReleases$: new Subject<unknown>(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: EcoSocketService, useValue: socket }],
    });
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).match(() => true);
    TestBed.resetTestingModule();
  });

  function loadNews(items: Partial<NewsItem>[]) {
    const store = TestBed.inject(SessionStore);
    const http = TestBed.inject(HttpTestingController);
    store.activeSession.set({ id: 's1', status: 'ACTIVE' } as TradingSession);
    TestBed.flushEffects();
    const [req] = http.match((r) => r.url.includes('news'));
    req.flush({ data: items.map((i, n) => ({ id: `n${n}`, symbol: 'SPY', publishedDate: '', ...i })) });
    return store;
  }

  it('prend la news marquée breaking par l’API, pas un titre crypto qui contient « Fed »', () => {
    const store = loadNews([
      { title: 'Le Bitcoin a besoin des ETF pour confirmer le rallye porté par la Fed', symbol: 'BTCUSD', breaking: false },
      { title: 'Powell appelle à la patience sur les baisses de taux', breaking: true },
    ]);
    expect(store.breakingNews()).toBe('Powell appelle à la patience sur les baisses de taux');
  });

  it('aucune news marquée : pas de bandeau', () => {
    const store = loadNews([{ title: 'Nvidia : le goulet d’étranglement du capital', breaking: false }]);
    expect(store.breakingNews()).toBeNull();
  });
});
