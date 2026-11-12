import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { SessionStore } from './session.store';
import { EcoSocketService } from '../services/eco-socket.service';
import type { SessionTrade, TradingSession } from '../api/session.api';

/** Débrief juste après la clôture : les trades réellement rattachés, pas le dernier sondage (#947). */
describe('SessionStore — trades du débrief après clôture', () => {
  const socket = {
    connect: vi.fn(), disconnect: vi.fn(),
    marketContext$: new Subject(), connected$: new Subject<void>(), newReleases$: new Subject<unknown>(),
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

  it('clôture → relit la séance du jour et remplace les trades par ceux de la séance', () => {
    const store = TestBed.inject(SessionStore);
    const http = TestBed.inject(HttpTestingController);
    const tradeA = { id: 'a', sessionId: 'other', pnl: 100 } as SessionTrade;
    const tradeB = { id: 'b', sessionId: 's1', pnl: -20 } as SessionTrade;
    store.activeSession.set({ id: 's1', status: 'ACTIVE' } as TradingSession);
    store.todayTrades.set([tradeA, tradeB]);
    http.match(() => true);

    store.closeSessionThenDebrief();
    http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/session/s1/close'))
      .flush({ data: { id: 's1', status: 'CLOSED', totalPnl: -20, totalTrades: 1 } });

    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/session/today'))
      .flush({ data: { id: 's1', status: 'CLOSED', trades: [tradeB] } });
    expect(store.todayTrades()).toEqual([tradeB]);
    expect(store.activeSession()?.status).toBe('CLOSED');
  });
});
