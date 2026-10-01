import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { SessionStore } from './session.store';
import { EcoSocketService } from '../services/eco-socket.service';
import type { TradingSession } from '../api/session.api';
import type { MarketContext } from '../api/trades.api';

/**
 * SCA-B4-02 / B4-03 : en session active, < 3 requêtes/min par onglet (hors quick-trade), aucune
 * onglet caché, contexte marché reçu par le socket. Avant : ~9 req/min (marché 15 s, stats 30 s,
 * calendrier 60 s, /auth/me 30 s).
 */
describe('SessionStore — polling de session', () => {
  let hidden = false;
  const socket = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    marketContext$: new Subject<MarketContext>(),
    connected$: new Subject<void>(),
    newReleases$: new Subject<unknown>(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: EcoSocketService, useValue: socket }],
    });
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).match(() => true);
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  /** Démarre une session active et renvoie le compteur de requêtes HTTP émises ensuite. */
  function startActiveSession() {
    const store = TestBed.inject(SessionStore);
    const http = TestBed.inject(HttpTestingController);
    store.activeSession.set({ id: 's1', status: 'ACTIVE' } as TradingSession);
    TestBed.flushEffects();
    http.match(() => true); // requêtes de démarrage (contexte, news) : hors comptage du régime
    let count = 0;
    const tick = (ms: number) => {
      vi.advanceTimersByTime(ms);
      count += http.match(() => true).length;
    };
    return { store, tick, requests: () => count };
  }

  it('régime établi : moins de 3 requêtes par minute (sur 10 min)', () => {
    const { tick, requests } = startActiveSession();
    for (let i = 0; i < 20; i++) tick(30_000);
    expect(socket.connect).toHaveBeenCalled();
    expect(requests()).toBeGreaterThanOrEqual(20); // le polling tourne bien (stats live 30 s)
    expect(requests() / 10).toBeLessThan(3);
  });

  it('onglet caché : aucune requête', () => {
    const { tick, requests } = startActiveSession();
    hidden = true;
    for (let i = 0; i < 20; i++) tick(30_000);
    expect(requests()).toBe(0);
  });

  it('le contexte marché poussé par le socket alimente le store sans requête', () => {
    const { store, requests } = startActiveSession();
    const ctx = { nq: { value: 21000, changePct: 0.4, source: 'yahoo' } } as unknown as MarketContext;
    socket.marketContext$.next(ctx);
    expect(store.marketCtx()).toEqual(ctx);
    expect(requests()).toBe(0);
  });
});
