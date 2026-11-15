import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { SessionStore } from './session.store';
import { EcoSocketService } from '../services/eco-socket.service';
import type { MarketContext } from '../api/trades.api';

/**
 * Audit fonctionnel #994 (lot 1d, F17) : un double clic sur « Démarrer la session » envoyait deux
 * POST ; le second clôturait la première séance (vide) côté API, qui restait dans l'historique.
 */
describe('SessionStore — démarrage protégé du double clic', () => {
  const socket = {
    connect: vi.fn(), disconnect: vi.fn(),
    marketContext$: new Subject<MarketContext>(), connected$: new Subject<void>(), newReleases$: new Subject<unknown>(),
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
  const starts = (http: HttpTestingController) => http.match((r) => r.method === 'POST' && /\/session\/start$/.test(r.url));

  it('deux clics avant la réponse → un seul démarrage', () => {
    const store = TestBed.inject(SessionStore);
    const http = TestBed.inject(HttpTestingController);
    store.startSession('a');
    store.startSession('a');
    expect(starts(http)).toHaveLength(1);
    expect(store.starting()).toBe(true);
  });

  it('après un échec, on peut réessayer', () => {
    const store = TestBed.inject(SessionStore);
    const http = TestBed.inject(HttpTestingController);
    store.startSession('a');
    starts(http)[0].flush({ message: 'down' }, { status: 500, statusText: 'Err' });
    expect(store.starting()).toBe(false);
    store.startSession('a');
    expect(starts(http)).toHaveLength(1);
  });
});
