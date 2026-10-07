import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EcoSocketService } from './eco-socket.service';
import { SOCKET_RECONNECT_OPTIONS } from './socket-reconnect';

const fake = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const sockets: { opts: Record<string, unknown>; handlers: Map<string, Handler>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  return { sockets };
});

vi.mock('socket.io-client', () => ({
  io: (_url: string, opts: Record<string, unknown>) => {
    const handlers = new Map<string, (...a: unknown[]) => void>();
    const s = { opts, handlers, on: (e: string, h: (...a: unknown[]) => void) => { handlers.set(e, h); return s; }, connect: vi.fn(), disconnect: vi.fn() };
    fake.sockets.push(s);
    return s;
  },
}));

describe('EcoSocketService — socket /eco authentifié (SCA-B6-03)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake.sockets.length = 0;
    localStorage.setItem('access_token', 'jwt-app');
    TestBed.resetTestingModule();
  });
  afterEach(() => vi.useRealTimers());

  it('envoie le jeton courant, relu à chaque (re)connexion, et étale ses reconnexions', () => {
    TestBed.inject(EcoSocketService).connect();
    const auth = fake.sockets[0].opts['auth'] as (cb: (d: unknown) => void) => void;
    let sent: unknown;
    auth((d) => (sent = d));
    expect(sent).toEqual({ token: 'jwt-app' });
    localStorage.setItem('access_token', 'jwt-renouvele');
    auth((d) => (sent = d));
    expect(sent).toEqual({ token: 'jwt-renouvele' });
    expect(fake.sockets[0].opts).toMatchObject(SOCKET_RECONNECT_OPTIONS);
  });

  it('refusé par le serveur (jeton expiré) → nouvel essai espacé', async () => {
    TestBed.inject(EcoSocketService).connect();
    const s = fake.sockets[0];
    s.handlers.get('disconnect')!('io server disconnect');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(s.connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.connect).toHaveBeenCalledOnce();
  });

  it('connect() appelé deux fois → un seul socket', () => {
    const svc = TestBed.inject(EcoSocketService);
    svc.connect();
    svc.connect();
    expect(fake.sockets).toHaveLength(1);
  });
});
