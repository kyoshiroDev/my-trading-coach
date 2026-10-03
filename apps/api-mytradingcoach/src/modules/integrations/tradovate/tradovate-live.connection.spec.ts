import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BACKOFF_MAX_MS,
  HEARTBEAT_MS,
  QUOTA_BACKOFF_MS,
  TRADOVATE_WS_URL,
  backoffDelay,
  cashBalanceUpdate,
  initialAccountState,
  isTradeEvent,
  parseFrame,
  syncRequestMessage,
} from './tradovate-live.protocol';
import { LiveFatalError, TradovateLiveConnection, type LiveSocket } from './tradovate-live.connection';

/** WebSocket Tradovate simulé : on pousse les trames serveur, on lit ce que le client envoie. */
class FakeSocket implements LiveSocket {
  readyState = 1;
  sent: string[] = [];
  closed: number | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) { this.sent.push(data); }
  close(code = 1000) {
    this.closed = code;
    this.readyState = 3;
    this.onclose?.({ code });
  }
  server(raw: string) { this.onmessage?.({ data: raw }); }
  /** Coupure réseau / serveur (sans appel à close() côté client). */
  drop() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
}

const EXT = 777;

function setup(opts: { getToken?: () => Promise<string> } = {}) {
  const sockets: FakeSocket[] = [];
  const onTradeEvent = vi.fn();
  const onFatal = vi.fn();
  const conn = new TradovateLiveConnection({
    url: TRADOVATE_WS_URL.demo,
    externalAccountId: EXT,
    getToken: opts.getToken ?? (async () => 'AT-1'),
    onTradeEvent,
    onFatal,
    socketFactory: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    logger: { warn: vi.fn() },
  });
  const last = () => sockets[sockets.length - 1];
  /** Ouverture + autorisation acceptée. */
  const authorize = () => {
    last().server('o');
    last().server('a[{"s":200,"i":0}]');
  };
  return { conn, sockets, last, authorize, onTradeEvent, onFatal };
}

describe('Protocole Tradovate — fonctions pures', () => {
  it('trames serveur : o / h / c / a[...] (JSON invalide ignoré)', () => {
    expect(parseFrame('o')).toEqual({ kind: 'open' });
    expect(parseFrame('h')).toEqual({ kind: 'heartbeat' });
    expect(parseFrame('c[1000,"bye"]')).toEqual({ kind: 'close' });
    expect(parseFrame('a[{"s":200,"i":0}]')).toEqual({ kind: 'data', messages: [{ s: 200, i: 0 }] });
    expect(parseFrame('a[oops')).toEqual({ kind: 'unknown' });
  });

  it('user/syncrequest : le seul compte synchronisé, entityTypes renseignés (obligatoires)', () => {
    const [endpoint, id, query, body] = syncRequestMessage(1, EXT).split('\n');
    expect([endpoint, id, query]).toEqual(['user/syncrequest', '1', '']);
    expect(JSON.parse(body)).toEqual({ accounts: [EXT], entityTypes: ['fill', 'fillPair', 'position', 'cashBalance'] });
  });

  it('événements utiles : fill / fillPair / position créés ou modifiés, du bon compte', () => {
    const props = (entityType: string, eventType = 'Created', entity: object = {}) =>
      ({ e: 'props', d: { entityType, eventType, entity } });
    expect(isTradeEvent(props('fillPair'), EXT)).toBe(true);
    expect(isTradeEvent(props('fill'), EXT)).toBe(true);
    expect(isTradeEvent(props('position', 'Updated', { accountId: EXT }), EXT)).toBe(true);
    expect(isTradeEvent(props('position', 'Updated', { accountId: 999 }), EXT)).toBe(false);
    expect(isTradeEvent(props('fillPair', 'Deleted'), EXT)).toBe(false);
    expect(isTradeEvent(props('cashBalance'), EXT)).toBe(false);
    expect(isTradeEvent({ s: 200, i: 1 }, EXT)).toBe(false);
  });

  it('backoff exponentiel 1 s, 2 s, 4 s… plafonné à 60 s', () => {
    expect([0, 1, 2, 3].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelay(20)).toBe(BACKOFF_MAX_MS);
  });
});

describe('Connexion WebSocket Tradovate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ouverture → authorize avec le jeton REST → syncrequest, puis heartbeat [] toutes les 2,5 s', async () => {
    const { conn, last, authorize } = setup();
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(last().url).toBe('wss://demo.tradovateapi.com/v1/websocket');

    authorize();
    expect(last().sent[0]).toBe('authorize\n0\n\nAT-1');
    expect(last().sent[1]).toBe(syncRequestMessage(1, EXT));
    expect(conn.isAuthorized).toBe(true);

    const before = last().sent.length;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(last().sent.slice(before)).toEqual(['[]', '[]', '[]']);
  });

  it('pas de heartbeat avant l’autorisation', async () => {
    const { conn, last } = setup();
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    last().server('o');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
    expect(last().sent).toEqual(['authorize\n0\n\nAT-1']);
  });

  it('événement props utile → signalé ; autre compte → ignoré', async () => {
    const { conn, last, authorize, onTradeEvent } = setup();
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    authorize();
    last().server('a[{"e":"props","d":{"entityType":"fillPair","eventType":"Created","entity":{"id":1}}}]');
    last().server('a[{"e":"props","d":{"entityType":"position","eventType":"Updated","entity":{"accountId":999}}}]');
    expect(onTradeEvent).toHaveBeenCalledTimes(1);
  });

  it('coupure → reconnexion en backoff (1 s puis 2 s), nouveau jeton demandé', async () => {
    const getToken = vi.fn(async () => 'AT-1');
    const { conn, sockets, authorize, last } = setup({ getToken });
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    last().drop();
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
    last().drop();
    await vi.advanceTimersByTimeAsync(1999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);
    expect(getToken).toHaveBeenCalledTimes(3);
    // Une autorisation réussie remet le compteur à zéro.
    authorize();
    last().drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(4);
  });

  it('quota de connexions atteint (shutdown) → attente longue avant de réessayer', async () => {
    const { conn, sockets, authorize, last } = setup();
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    authorize();
    last().server('a[{"e":"shutdown","d":{"reasonCode":"ConnectionQuotaReached"}}]');
    last().drop();
    await vi.advanceTimersByTimeAsync(QUOTA_BACKOFF_MS - 1);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
  });

  it('autorisation refusée → socket fermée, reconnexion ensuite (jeton redemandé)', async () => {
    const { conn, sockets, last } = setup();
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    last().server('o');
    last().server('a[{"s":401,"i":0}]');
    expect(sockets[0].closed).toBe(4001);
    expect(conn.isAuthorized).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
  });

  it('stop() : fermeture propre (1000), plus de heartbeat ni de reconnexion', async () => {
    const { conn, sockets, authorize, last } = setup();
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    authorize();
    const s = last();
    conn.stop();
    expect(s.closed).toBe(1000);
    const sent = s.sent.length;
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS * 2);
    expect(s.sent).toHaveLength(sent);
    expect(sockets).toHaveLength(1);
    expect(conn.isStopped).toBe(true);
  });

  it('jeton irrécupérable → abandon signalé (le bouton manuel prend le relais), aucune socket', async () => {
    const { conn, sockets, onFatal } = setup({
      getToken: async () => { throw new LiveFatalError('reconnexion requise'); },
    });
    conn.start();
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
    expect(onFatal).toHaveBeenCalledWith('reconnexion requise');
    expect(sockets).toHaveLength(0);
    expect(conn.isStopped).toBe(true);
  });

  it('jeton momentanément indisponible (verrou) → nouvel essai en backoff', async () => {
    let n = 0;
    const { conn, sockets } = setup({
      getToken: async () => { if (n++ === 0) throw new Error('verrou occupé'); return 'AT-2'; },
    });
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(1);
  });
});

describe('Protocole live — solde du compte', () => {
  const props = (entityType: string, entity: object, eventType = 'Updated') =>
    ({ e: 'props', d: { entityType, eventType, entity } });

  it('cashBalance du compte suivi → montant + date ; autre compte, suppression ou montant absent → null', () => {
    expect(cashBalanceUpdate(props('cashBalance', { accountId: EXT, amount: 50120.25, timestamp: '2026-10-03T15:00:00Z' }), EXT))
      .toEqual({ amount: 50120.25, at: new Date('2026-10-03T15:00:00Z') });
    expect(cashBalanceUpdate(props('cashBalance', { accountId: EXT + 1, amount: 1 }), EXT)).toBeNull();
    expect(cashBalanceUpdate(props('cashBalance', { accountId: EXT, amount: 1 }, 'Deleted'), EXT)).toBeNull();
    expect(cashBalanceUpdate(props('cashBalance', { accountId: EXT }), EXT)).toBeNull();
    expect(cashBalanceUpdate(props('position', { accountId: EXT, amount: 1 }), EXT)).toBeNull();
  });

  it('un solde n\'est pas un événement de trade (pas de synchro REST à chaque variation)', () => {
    expect(isTradeEvent(props('cashBalance', { accountId: EXT, amount: 1 }) as never, EXT)).toBe(false);
  });

  it('état initial : uniquement la réponse 200 du syncrequest (id 1)', () => {
    const d = { cashBalances: [{ accountId: EXT, amount: 10, timestamp: '2026-10-03T10:00:00Z' }], positions: [] };
    expect(initialAccountState({ s: 200, i: 1, d }, EXT)).toEqual({ balance: { amount: 10, at: new Date('2026-10-03T10:00:00Z') }, openPositions: 0 });
    expect(initialAccountState({ s: 200, i: 0, d }, EXT)).toBeNull();
    expect(initialAccountState({ s: 401, i: 1, d }, EXT)).toBeNull();
    expect(initialAccountState({ s: 200, i: 1, d: {} }, EXT)).toEqual({ balance: null, openPositions: 0 });
  });
});

