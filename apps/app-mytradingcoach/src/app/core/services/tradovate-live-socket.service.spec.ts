import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TradovateLiveSocketService, type TradovateLiveTrades } from './tradovate-live-socket.service';
import { ToastService } from './toast.service';
import { SelectedAccountStore } from '../stores/selected-account.store';
import { TradovateStore } from '../stores/tradovate.store';
import { SessionStore } from '../stores/session.store';

/** Socket.io simulée : on déclenche les événements serveur à la main. */
const fake = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const sockets: { url: string; opts: Record<string, unknown>; handlers: Map<string, Handler>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; removeAllListeners: ReturnType<typeof vi.fn>; emit(e: string, ...a: unknown[]): void }[] = [];
  return { sockets };
});

vi.mock('socket.io-client', () => ({
  io: (url: string, opts: Record<string, unknown>) => {
    const handlers = new Map<string, (...a: unknown[]) => void>();
    const s = {
      url, opts, handlers,
      on: (e: string, h: (...a: unknown[]) => void) => { handlers.set(e, h); return s; },
      connect: vi.fn(),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
      emit: (e: string, ...a: unknown[]) => handlers.get(e)?.(...a),
    };
    fake.sockets.push(s);
    return s;
  },
}));

function setup(activeSession = false) {
  const toast = { success: vi.fn() };
  const accounts = { load: vi.fn() };
  const tradovate = { load: vi.fn() };
  const session = { hasActiveSession: signal(activeSession), refreshLive: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ToastService, useValue: toast },
      { provide: SelectedAccountStore, useValue: accounts },
      { provide: TradovateStore, useValue: tradovate },
      { provide: SessionStore, useValue: session },
    ],
  });
  const service = TestBed.inject(TradovateLiveSocketService);
  return { service, toast, accounts, tradovate, session };
}

const trades = (created: number): TradovateLiveTrades =>
  ({ accountId: 'acc-1', created, duplicates: 0, total: created, source: 'live' });

describe('TradovateLiveSocketService — temps réel Tradovate côté app', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    fake.sockets.length = 0;
    localStorage.setItem('access_token', 'jwt-app');
  });
  afterEach(() => vi.useRealTimers());

  it('une seule connexion, sur /tradovate-live, authentifiée avec le jeton courant (relu à chaque reconnexion)', () => {
    const { service } = setup();
    service.connect();
    service.connect();
    expect(fake.sockets).toHaveLength(1);
    expect(fake.sockets[0].url).toMatch(/\/tradovate-live$/);
    const auth = fake.sockets[0].opts['auth'] as (cb: (d: object) => void) => void;
    localStorage.setItem('access_token', 'jwt-renouvelé');
    let sent: object | null = null;
    auth((d) => (sent = d));
    expect(sent).toEqual({ token: 'jwt-renouvelé' });
  });

  it('trades poussés → toast, comptes + connexions rechargés, écrans ouverts prévenus', () => {
    const { service, toast, accounts, tradovate, session } = setup(false);
    const seen: TradovateLiveTrades[] = [];
    service.imported$.subscribe((e) => seen.push(e));
    service.connect();
    fake.sockets[0].emit('tradovate:trades', trades(2));
    expect(toast.success).toHaveBeenCalledWith('2 trades Tradovate synchronisés');
    expect(accounts.load).toHaveBeenCalled();
    expect(tradovate.load).toHaveBeenCalled();
    expect(session.refreshLive).not.toHaveBeenCalled(); // pas de session ouverte
    expect(seen).toEqual([trades(2)]);
  });

  it('session en cours → le Live feed est rechargé aussitôt', () => {
    const { service, session, toast } = setup(true);
    service.connect();
    fake.sockets[0].emit('tradovate:trades', trades(1));
    expect(session.refreshLive).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('1 trade Tradovate synchronisé');
  });

  it('rien de créé → silence', () => {
    const { service, toast } = setup();
    service.connect();
    fake.sockets[0].emit('tradovate:trades', trades(0));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('connexion à refaire → carte « Mes comptes » rechargée', () => {
    const { service, tradovate } = setup();
    service.connect();
    fake.sockets[0].emit('tradovate:status', { accountId: 'acc-1', status: 'NEEDS_RECONNECT' });
    expect(tradovate.load).toHaveBeenCalled();
  });

  it('refusé par le serveur (jeton expiré) → nouvel essai espacé, sans bruit', () => {
    vi.useFakeTimers();
    const { service, toast } = setup();
    service.connect();
    fake.sockets[0].emit('disconnect', 'io server disconnect');
    expect(fake.sockets[0].connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(fake.sockets[0].connect).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('disconnect() (logout, onglet fermé) → socket fermée, plus aucun nouvel essai', () => {
    vi.useFakeTimers();
    const { service } = setup();
    service.connect();
    const s = fake.sockets[0];
    s.emit('disconnect', 'io server disconnect');
    service.disconnect();
    vi.advanceTimersByTime(120_000);
    expect(s.disconnect).toHaveBeenCalled();
    expect(s.removeAllListeners).toHaveBeenCalled();
    expect(s.connect).not.toHaveBeenCalled();
    expect(service.connected()).toBe(false);
  });
});
