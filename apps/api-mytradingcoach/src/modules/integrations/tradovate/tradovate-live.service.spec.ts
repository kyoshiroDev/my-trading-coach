import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CATCH_UP_FRESH_MS,
  CATCH_UP_HISTORY_AFTER_MS,
  LIVE_EVENT_DEBOUNCE_MS,
  LIVE_LEASE_RENEW_MS,
  LIVE_ORDERS_DEBOUNCE_MS,
  TradovateLiveService,
  liveLeaseKey,
  LIVE_CATCH_UP_CONCURRENCY,
} from './tradovate-live.service';
import type { LiveSocket } from './tradovate-live.connection';
import { TradovateException } from './tradovate.errors';
import type { WatchVerdict } from './tradovate-watch';

/**
 * Présence → WebSocket Tradovate (temps réel). Verrouille le contrat de portée :
 * app ouverte = connexion + rattrapage ; app fermée = plus rien ; un seul WebSocket par
 * user même avec plusieurs onglets / workers ; les trades passent par la synchro existante.
 */

class FakeSocket implements LiveSocket {
  readyState = 1;
  sent: string[] = [];
  closed: number | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(d: string) { this.sent.push(d); }
  close(code = 1000) { this.closed = code; this.readyState = 3; this.onclose?.({ code }); }
  server(raw: string) { this.onmessage?.({ data: raw }); }
}

const conn = (over: Record<string, unknown> = {}) => ({
  id: 'bc-1', userId: 'u1', accountId: 'acc-1', externalAccountId: '777', externalEnv: 'demo',
  status: 'CONNECTED', lastSyncAt: null as Date | null, ...over,
});

/** Redis en mémoire : SET NX PX, scripts renew / release (propriétaire uniquement), EXISTS. */
function fakeRedis() {
  const store = new Map<string, string>();
  const client = {
    set: vi.fn(async (k: string, v: string, _px: string, _ttl: number, nx?: string) => {
      if (nx === 'NX' && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    eval: vi.fn(async (script: string, _n: number, k: string, id: string) => {
      if (store.get(k) !== id) return 0;
      if (script.includes("'del'")) store.delete(k);
      return 1;
    }),
    exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
  };
  return { store, client };
}

/** Registre des veilles en mémoire (#770) : verdict par user, `watch` par défaut. */
function fakeWatch() {
  const ids = new Set<string>();
  const verdict = new Map<string, WatchVerdict>();
  return {
    ids,
    verdict,
    active: true,
    begin: vi.fn(async (u: string): Promise<WatchVerdict> => {
      const v = verdict.get(u) ?? 'watch';
      if (v === 'stop') ids.delete(u);
      else ids.add(u);
      return v;
    }),
    end: vi.fn(async (u: string) => { ids.delete(u); }),
    current: vi.fn(async () => [...ids]),
    verdicts: vi.fn(async (list: string[]) => new Map(list.map((u) => [u, verdict.get(u) ?? ('watch' as WatchVerdict)]))),
  };
}

function setup(opts: { conns?: ReturnType<typeof conn>[]; redis?: ReturnType<typeof fakeRedis>; watch?: ReturnType<typeof fakeWatch> } = {}) {
  const conns = opts.conns ?? [conn()];
  const redis = opts.redis ?? fakeRedis();
  const sockets: FakeSocket[] = [];
  const prisma = {
    brokerConnection: {
      findMany: vi.fn(async () => conns),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; accountId_provider?: { accountId: string } } }) =>
        conns.find((c) => (where.id ? c.id === where.id : c.accountId === where.accountId_provider?.accountId)) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const found = conns.filter((c) => c.id === where.id);
        found.forEach((c) => Object.assign(c, data));
        return { count: found.length };
      }),
    },
  };
  const connections = {
    assertConfigured: vi.fn(),
    tryLock: vi.fn(async () => true),
    unlock: vi.fn(async () => undefined),
    getAccessToken: vi.fn(async () => 'AT-1'),
    getSession: vi.fn(async () => ({ token: 'AT-1', apiHosts: null })),
  };
  const sync = {
    sync: vi.fn(async () => ({ created: 0, duplicates: 0, failed: 0, total: 0 })),
  };
  const balance = {
    recordCashBalance: vi.fn(async (_id: string, amount: number, at: Date) => ({ accountId: 'acc-1', cashBalance: amount, cashBalanceAt: at })),
    recordOpenPositions: vi.fn(async () => undefined),
  };
  const service = new TradovateLiveService(
    prisma as never, redis as never, connections as never, sync as never, balance as never,
    (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
    opts.watch as never,
  );
  const emitted: { userId: string; event: string; payload: unknown }[] = [];
  service.bindEmitter((userId, event, payload) => emitted.push({ userId, event, payload }));
  return { service, prisma, redis, connections, sync, balance, sockets, emitted };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('Tradovate live — présence dans l’app', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('app ouverte → rattrapage REST PUIS WebSocket Tradovate du compte connecté', async () => {
    const { service, sync, sockets } = setup();
    await service.attach('u1', 'tab-1');
    await settle();
    // Jamais synchronisée → absence : le rattrapage retire aussi le mois en cours.
    expect(sync.sync).toHaveBeenCalledWith('u1', 'acc-1', { history: true });
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://demo.tradovateapi.com/v1/websocket');
    expect(service.openConnectionCount()).toBe(1);
  });

  it(`20 users qui reviennent ensemble → au plus ${LIVE_CATCH_UP_CONCURRENCY} rattrapages simultanés (SCA-B6-02)`, async () => {
    const { service, sync } = setup();
    let running = 0;
    let peak = 0;
    const done: (() => void)[] = [];
    sync.sync.mockImplementation(async () => {
      peak = Math.max(peak, ++running);
      await new Promise<void>((resolve) => done.push(resolve));
      running--;
      return { created: 0, duplicates: 0, failed: 0, total: 0 };
    });

    for (let i = 0; i < 20; i++) await service.attach(`u${i}`, `tab-${i}`);
    await settle();
    expect(running).toBe(LIVE_CATCH_UP_CONCURRENCY);

    while (done.length) { done.shift()!(); await settle(); }
    expect(peak).toBe(LIVE_CATCH_UP_CONCURRENCY);
    expect(sync.sync).toHaveBeenCalledTimes(20);
  });

  it('plusieurs onglets → UN seul WebSocket et un seul rattrapage', async () => {
    const { service, sync, sockets } = setup();
    await service.attach('u1', 'tab-1');
    await service.attach('u1', 'tab-2');
    await settle();
    expect(sockets).toHaveLength(1);
    expect(sync.sync).toHaveBeenCalledTimes(1);
  });

  it('fermer un onglet sur deux → la connexion reste ; fermer le dernier → WebSocket fermé, bail rendu', async () => {
    const { service, sockets, redis } = setup();
    await service.attach('u1', 'tab-1');
    await service.attach('u1', 'tab-2');
    await settle();
    service.detach('u1', 'tab-1');
    await settle();
    expect(sockets[0].closed).toBeNull();
    service.detach('u1', 'tab-2');
    await settle();
    expect(sockets[0].closed).toBe(1000);
    expect(service.openConnectionCount()).toBe(0);
    expect(redis.store.has(liveLeaseKey('u1'))).toBe(false);
    // Plus rien ne tourne : aucune reconnexion, aucun heartbeat.
    const sent = sockets[0].sent.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toHaveLength(sent);
  });

  it('aucun compte connecté (ou compte démo, exclu par la requête) → rien n’est ouvert', async () => {
    const { service, sync, sockets } = setup({ conns: [] });
    await service.attach('u1', 'tab-1');
    await settle();
    expect(sockets).toHaveLength(0);
    expect(sync.sync).not.toHaveBeenCalled();
  });

  it('autre worker titulaire du bail → pas de 2e WebSocket ; bail libéré → reprise au tick suivant', async () => {
    const redis = fakeRedis();
    redis.store.set(liveLeaseKey('u1'), 'autre-worker');
    const { service, sockets } = setup({ redis });
    await service.attach('u1', 'tab-1');
    await settle();
    expect(sockets).toHaveLength(0);
    redis.store.delete(liveLeaseKey('u1'));
    await vi.advanceTimersByTimeAsync(LIVE_LEASE_RENEW_MS);
    expect(sockets).toHaveLength(1);
    await service.onModuleDestroy();
  });

  it('retour après une courte pause → séance seule, pas de rapport mensuel', async () => {
    // 5 min d'absence : le cron de fond a forcément fait le travail, inutile de tirer un rapport.
    const { service, sync } = setup({ conns: [conn({ lastSyncAt: new Date(Date.now() - 5 * 60_000) })] });
    await service.attach('u1', 'tab-1');
    await settle();
    expect(sync.sync).toHaveBeenCalledWith('u1', 'acc-1', { history: false });
    await service.onModuleDestroy();
  });

  it('retour du lendemain → le mois est retiré, même si le cron n’a jamais tourné', async () => {
    // LE scénario : il a tradé hier app fermée, l'API était arrêtée, le cron n'a rien capté.
    // La Trade API ne rejoue jamais une séance passée — seul le rapport mensuel les contient.
    const { service, sync } = setup({
      conns: [conn({ lastSyncAt: new Date(Date.now() - CATCH_UP_HISTORY_AFTER_MS - 1) })],
    });
    await service.attach('u1', 'tab-1');
    await settle();
    expect(sync.sync).toHaveBeenCalledWith('u1', 'acc-1', { history: true });
    await service.onModuleDestroy();
  });

  it('synchro récente (< 60 s) → rattrapage sauté, le WebSocket s’ouvre quand même', async () => {
    const { service, sync, sockets } = setup({
      conns: [conn({ lastSyncAt: new Date(Date.now() - CATCH_UP_FRESH_MS / 2) })],
    });
    await service.attach('u1', 'tab-1');
    await settle();
    expect(sync.sync).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(1);
    await service.onModuleDestroy();
  });
});

describe('Tradovate live — événements → synchro existante', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function live(created = 1) {
    const ctx = setup({ conns: [conn({ lastSyncAt: new Date() })] }); // pas de rattrapage
    ctx.sync.sync.mockResolvedValue({ created, duplicates: 0, failed: 0, total: created });
    await ctx.service.attach('u1', 'tab-1');
    await settle();
    const s = ctx.sockets[0];
    s.server('o');
    s.server('a[{"s":200,"i":0}]');
    const push = (entityType: string) =>
      s.server(`a[{"e":"props","d":{"entityType":"${entityType}","eventType":"Created","entity":{}}}]`);
    return { ...ctx, push };
  }

  it('rafale fill + fill + fillPair → UNE synchro après regroupement, trade relayé au user', async () => {
    const { service, sync, emitted, push } = await live(1);
    push('fill');
    push('fill');
    push('fillPair');
    await vi.advanceTimersByTimeAsync(LIVE_EVENT_DEBOUNCE_MS - 1);
    expect(sync.sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sync.sync).toHaveBeenCalledTimes(1);
    // Trade en direct : la séance suffit, pas de rapport mensuel à chaque fill.
    expect(sync.sync).toHaveBeenCalledWith('u1', 'acc-1', {});
    expect(emitted[0]).toEqual(
      { userId: 'u1', event: 'tradovate:trades', payload: { accountId: 'acc-1', created: 1, duplicates: 0, total: 1, source: 'live' } },
    );
    // La synchro a relu solde et equity chez le broker : relayés au front juste après.
    expect(emitted[1]).toMatchObject({ userId: 'u1', event: 'tradovate:balance', payload: { accountId: 'acc-1' } });
    await service.onModuleDestroy();
  });

  it('rien de nouveau (doublons) → aucun événement « trades », seulement le solde relu', async () => {
    const { service, emitted, push } = await live(0);
    push('fillPair');
    await vi.advanceTimersByTimeAsync(LIVE_EVENT_DEBOUNCE_MS);
    expect(emitted.map((e) => e.event)).toEqual(['tradovate:balance']);
    await service.onModuleDestroy();
  });

  it('synchro déjà en cours (bouton, autre onglet) → nouvel essai quelques secondes plus tard', async () => {
    const { service, sync, push } = await live(1);
    sync.sync.mockRejectedValueOnce(new TradovateException('TRADOVATE_SYNC_IN_PROGRESS'));
    push('fillPair');
    await vi.advanceTimersByTimeAsync(LIVE_EVENT_DEBOUNCE_MS);
    expect(sync.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sync.sync).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
  });

  it('connexion à refaire → statut relayé (la carte « Mes comptes » l’affiche)', async () => {
    const { service, sync, emitted, push } = await live(1);
    sync.sync.mockRejectedValueOnce(new TradovateException('TRADOVATE_RECONNECT_REQUIRED'));
    push('fillPair');
    await vi.advanceTimersByTimeAsync(LIVE_EVENT_DEBOUNCE_MS);
    expect(emitted).toEqual([
      { userId: 'u1', event: 'tradovate:status', payload: { accountId: 'acc-1', status: 'NEEDS_RECONNECT' } },
    ]);
    await service.onModuleDestroy();
  });

  it('jeton pris sous le verrou partagé (rotation du refresh_token), puis rendu', async () => {
    const { service, connections } = await live(0);
    expect(connections.tryLock).toHaveBeenCalledWith('bc-1');
    expect(connections.unlock).toHaveBeenCalledWith('bc-1');
    await service.onModuleDestroy();
  });
});

describe('Tradovate live — WebSocket refusé (421) avec des hôtes en cache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('apiHostsAt remis à null → la reconnexion relit les hôtes et part sur l’hôte dédié', async () => {
    const ANCIEN = { live: 'live.tradovateapi.com', demo: 'demo.tradovateapi.com' };
    const DEDIE = { live: 'live.tradovateapi.com', demo: 'apex-demo.tradovateapi.com' };
    // Hôtes lus il y a 5 min : frais pour le TTL de 30 min, mais NinjaTrader a basculé depuis.
    const c = conn({ lastSyncAt: new Date(), apiHosts: ANCIEN, apiHostsAt: new Date(Date.now() - 5 * 60_000) });
    const { service, sockets, prisma, connections } = setup({ conns: [c] });
    // Comme TradovateTokenManager : hôtes en cache tant que `apiHostsAt` est frais, relus sinon.
    connections.getSession.mockImplementation((async (x: { apiHostsAt: Date | null }) => ({
      token: 'AT-1',
      apiHosts: x.apiHostsAt ? ANCIEN : DEDIE,
    })) as never);
    await service.attach('u1', 'tab-1');
    await settle();
    expect(sockets[0].url).toBe('wss://demo.tradovateapi.com/v1/websocket');

    sockets[0].readyState = 0;
    sockets[0].onerror?.({}); // 421 : error sans close (Node 22)
    await settle();
    expect(prisma.brokerConnection.updateMany).toHaveBeenCalledWith({ where: { id: 'bc-1' }, data: { apiHostsAt: null } });

    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).toBe('wss://apex-demo.tradovateapi.com/v1/websocket');
    await service.onModuleDestroy();
  });
});

describe('Tradovate live — solde du compte poussé par le broker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function opened() {
    const ctx = setup({ conns: [conn({ lastSyncAt: new Date() })] });
    await ctx.service.attach('u1', 'tab-1');
    await settle();
    const s = ctx.sockets[0];
    s.server('o');
    s.server('a[{"s":200,"i":0}]');
    return { ...ctx, s };
  }

  it('souscription : le solde fait partie des entités demandées', async () => {
    const { s, service } = await opened();
    const sub = s.sent.find((m) => m.startsWith('user/syncrequest'))!;
    expect(JSON.parse(sub.split('\n')[3])).toMatchObject({ accounts: [777], entityTypes: expect.arrayContaining(['cashBalance', 'fill']) });
    await service.onModuleDestroy();
  });

  it('état initial : solde le plus récent + positions ouvertes du compte, enregistrés puis relayés', async () => {
    const { s, balance, emitted, service } = await opened();
    s.server(`a[{"s":200,"i":1,"d":{"cashBalances":[
      {"accountId":777,"amount":50100,"timestamp":"2026-10-03T13:00:00Z"},
      {"accountId":777,"amount":50250.5,"timestamp":"2026-10-03T14:00:00Z"},
      {"accountId":999,"amount":1,"timestamp":"2026-10-03T15:00:00Z"}],
      "positions":[{"accountId":777,"netPos":2},{"accountId":777,"netPos":0},{"accountId":999,"netPos":1}]}}]`);
    await settle();
    expect(balance.recordOpenPositions).toHaveBeenCalledWith('bc-1', 1);
    expect(balance.recordCashBalance).toHaveBeenCalledWith('bc-1', 50250.5, new Date('2026-10-03T14:00:00Z'));
    expect(emitted).toContainEqual(expect.objectContaining({ event: 'tradovate:balance', payload: expect.objectContaining({ cashBalance: 50250.5 }) }));
    await service.onModuleDestroy();
  });

  it('variation du solde : enregistrée et relayée SANS synchro REST ni appel au broker', async () => {
    const { s, balance, sync, emitted, service } = await opened();
    s.server('a[{"e":"props","d":{"entityType":"cashBalance","eventType":"Updated","entity":{"accountId":777,"amount":49800,"timestamp":"2026-10-03T15:30:00Z"}}}]');
    await vi.advanceTimersByTimeAsync(LIVE_EVENT_DEBOUNCE_MS * 2);
    expect(balance.recordCashBalance).toHaveBeenCalledWith('bc-1', 49800, new Date('2026-10-03T15:30:00Z'));
    expect(sync.sync).not.toHaveBeenCalled();
    expect(emitted).toEqual([expect.objectContaining({ event: 'tradovate:balance' })]);
    await service.onModuleDestroy();
  });

  it('solde d\'un autre compte du login : ignoré', async () => {
    const { s, balance, service } = await opened();
    s.server('a[{"e":"props","d":{"entityType":"cashBalance","eventType":"Updated","entity":{"accountId":999,"amount":1}}}]');
    await settle();
    expect(balance.recordCashBalance).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });
});

describe('Tradovate live — ordres actifs SL / TP (#601)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function opened() {
    const ctx = setup({ conns: [conn({ lastSyncAt: new Date() })] });
    await ctx.service.attach('u1', 'tab-1');
    await settle();
    const s = ctx.sockets[0];
    s.server('o');
    s.server('a[{"s":200,"i":0}]');
    return { ...ctx, s };
  }
  const stored = (redis: ReturnType<typeof fakeRedis>) => JSON.parse(redis.store.get('tradovate:orders:bc-1') ?? 'null');

  it('instantané initial puis modification : ordres actifs dans Redis, vue live prévenue', async () => {
    const { s, redis, emitted, sync, service } = await opened();
    s.server(`a[{"s":200,"i":1,"d":{"orders":[
      {"id":10,"accountId":777,"contractId":7,"action":"Sell","ordStatus":"Working","ocoId":11},
      {"id":12,"accountId":777,"contractId":7,"action":"Sell","ordStatus":"Filled"}],
      "orderVersions":[{"id":100,"orderId":10,"orderType":"Stop","stopPrice":21480}]}}]`);
    await vi.advanceTimersByTimeAsync(LIVE_ORDERS_DEBOUNCE_MS);
    expect(stored(redis).orders).toEqual([
      { id: 10, contractId: 7, action: 'Sell', orderType: 'Stop', price: null, stopPrice: 21480, parentId: null, ocoId: 11 },
    ]);
    expect(emitted).toContainEqual({ userId: 'u1', event: 'tradovate:orders', payload: { accountId: 'acc-1' } });

    // Stop déplacé : nouvelle version poussée.
    s.server('a[{"e":"props","d":{"entityType":"orderVersion","eventType":"Created","entity":{"id":101,"orderId":10,"orderType":"Stop","stopPrice":21490}}}]');
    await vi.advanceTimersByTimeAsync(LIVE_ORDERS_DEBOUNCE_MS);
    expect(stored(redis).orders[0].stopPrice).toBe(21490);

    // Stop annulé : plus d'ordre actif.
    s.server('a[{"e":"props","d":{"entityType":"order","eventType":"Updated","entity":{"id":10,"accountId":777,"ordStatus":"Canceled"}}}]');
    await vi.advanceTimersByTimeAsync(LIVE_ORDERS_DEBOUNCE_MS);
    expect(stored(redis).orders).toEqual([]);
    expect(sync.sync).not.toHaveBeenCalled(); // un ordre n'est pas un trade
    await service.onModuleDestroy();
  });

  it('rien de changé → ni réécriture ni émission', async () => {
    const { s, redis, emitted, service } = await opened();
    s.server('a[{"s":200,"i":1,"d":{"orders":[]}}]');
    await vi.advanceTimersByTimeAsync(LIVE_ORDERS_DEBOUNCE_MS);
    const writes = redis.client.set.mock.calls.filter((c) => c[0] === 'tradovate:orders:bc-1').length;
    // Limite posée puis annulée dans la même fenêtre : même état qu'avant.
    s.server('a[{"e":"props","d":{"entityType":"order","eventType":"Created","entity":{"id":1,"accountId":777,"contractId":7,"action":"Sell","ordStatus":"Working"}}}]');
    s.server('a[{"e":"props","d":{"entityType":"order","eventType":"Updated","entity":{"id":1,"accountId":777,"ordStatus":"Canceled"}}}]');
    await vi.advanceTimersByTimeAsync(LIVE_ORDERS_DEBOUNCE_MS);
    expect(redis.client.set.mock.calls.filter((c) => c[0] === 'tradovate:orders:bc-1')).toHaveLength(writes);
    expect(emitted.filter((e) => e.event === 'tradovate:orders')).toHaveLength(1);
    await service.onModuleDestroy();
  });
});

describe('Tradovate live — veille serveur app fermée (#770)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('dernier onglet fermé, trader éligible → WebSocket GARDÉ, bail gardé, veille inscrite', async () => {
    const watch = fakeWatch();
    const { service, sockets, redis } = setup({ watch });
    await service.attach('u1', 'tab-1');
    await settle();
    service.detach('u1', 'tab-1');
    await settle();
    expect(watch.begin).toHaveBeenCalledWith('u1');
    expect(watch.ids.has('u1')).toBe(true);
    expect(sockets[0].closed).toBeNull();
    expect(service.openConnectionCount()).toBe(1);
    // Le bail continue d'être renouvelé : la synchro de fond voit le user « en direct ».
    await vi.advanceTimersByTimeAsync(60_000);
    expect(redis.store.has(liveLeaseKey('u1'))).toBe(true);
    await service.onModuleDestroy();
  });

  it.each<WatchVerdict>(['stop', 'paused'])('verdict « %s » → WebSocket fermé, bail rendu', async (v) => {
    const watch = fakeWatch();
    watch.verdict.set('u1', v);
    const { service, sockets, redis } = setup({ watch });
    await service.attach('u1', 'tab-1');
    await settle();
    service.detach('u1', 'tab-1');
    await settle();
    expect(sockets[0].closed).toBe(1000);
    expect(redis.store.has(liveLeaseKey('u1'))).toBe(false);
  });

  it('évaluation de la veille en échec → comportement d’avant (tout s’arrête)', async () => {
    const watch = fakeWatch();
    watch.begin.mockRejectedValueOnce(new Error('redis'));
    const { service, sockets } = setup({ watch });
    await service.attach('u1', 'tab-1');
    await settle();
    service.detach('u1', 'tab-1');
    await settle();
    expect(sockets[0].closed).toBe(1000);
  });

  it('push des traders éteint → aucune veille demandée, tout s’arrête', async () => {
    const watch = fakeWatch();
    watch.active = false;
    const { service, sockets } = setup({ watch });
    await service.attach('u1', 'tab-1');
    await settle();
    service.detach('u1', 'tab-1');
    await settle();
    expect(watch.begin).not.toHaveBeenCalled();
    expect(sockets[0].closed).toBe(1000);
  });

  it('pas titulaire du bail → rien gardé ici (le titulaire s’en charge)', async () => {
    const redis = fakeRedis();
    redis.store.set(liveLeaseKey('u1'), 'autre-worker');
    const watch = fakeWatch();
    const { service, sockets } = setup({ redis, watch });
    await service.attach('u1', 'tab-1');
    await settle();
    service.detach('u1', 'tab-1');
    await settle();
    expect(sockets).toHaveLength(0);
    redis.store.delete(liveLeaseKey('u1'));
    await vi.advanceTimersByTimeAsync(LIVE_LEASE_RENEW_MS * 3);
    expect(sockets).toHaveLength(0); // plus de tick : rien ne tourne ici
  });

  it('onglet rouvert pendant l’évaluation → la connexion reste', async () => {
    const watch = fakeWatch();
    watch.verdict.set('u1', 'stop');
    let resolve!: (v: WatchVerdict) => void;
    watch.begin.mockImplementationOnce(() => new Promise<WatchVerdict>((r) => { resolve = r; }));
    const { service, sockets } = setup({ watch });
    await service.attach('u1', 'tab-1');
    await settle();
    service.detach('u1', 'tab-1');
    await service.attach('u1', 'tab-2');
    resolve('stop');
    await settle();
    expect(sockets[0].closed).toBeNull();
    await service.onModuleDestroy();
  });

  it('balayage : veille finie → WebSocket tenu sans onglet fermé, bail rendu', async () => {
    const watch = fakeWatch();
    const { service, sockets, redis } = setup({ watch });
    await service.attach('u1', 'tab-1');
    await settle();
    service.detach('u1', 'tab-1');
    await settle();
    watch.verdict.set('u1', 'stop'); // séance clôturée, appareil retiré…
    await service.sweepWatch();
    await settle();
    expect(watch.ids.has('u1')).toBe(false);
    expect(sockets[0].closed).toBe(1000);
    expect(redis.store.has(liveLeaseKey('u1'))).toBe(false);
  });

  it('balayage : heures silencieuses → fermé mais veille gardée ; à la fin de la plage → rouvert', async () => {
    const watch = fakeWatch();
    const { service, sockets } = setup({ watch });
    await service.attach('u1', 'tab-1');
    await settle();
    service.detach('u1', 'tab-1');
    await settle();
    watch.verdict.set('u1', 'paused');
    await service.sweepWatch();
    await settle();
    expect(sockets[0].closed).toBe(1000);
    expect(watch.ids.has('u1')).toBe(true);
    watch.verdict.set('u1', 'watch');
    await service.sweepWatch();
    await settle();
    expect(sockets).toHaveLength(2);
    expect(sockets[1].closed).toBeNull();
    await service.onModuleDestroy();
  });

  it('balayage : onglet ouvert sur ce worker → jamais touché, même hors veille', async () => {
    const watch = fakeWatch();
    const { service, sockets } = setup({ watch });
    await service.attach('u1', 'tab-1');
    await settle();
    await service.sweepWatch();
    await settle();
    expect(sockets[0].closed).toBeNull();
    await service.onModuleDestroy();
  });

  it('process disparu (déploiement) → veille reprise par le balayage, rattrapage compris', async () => {
    const watch = fakeWatch();
    watch.ids.add('u1');
    const { service, sockets, sync } = setup({ watch, conns: [conn({ lastSyncAt: new Date(Date.now() - 5 * 60_000) })] });
    await service.sweepWatch();
    await settle();
    expect(sync.sync).toHaveBeenCalledWith('u1', 'acc-1', { history: false });
    expect(sockets).toHaveLength(1);
    await service.onModuleDestroy();
  });

  it('bail tenu par un autre process → pas de reprise', async () => {
    const redis = fakeRedis();
    redis.store.set(liveLeaseKey('u1'), 'autre-worker');
    const watch = fakeWatch();
    watch.ids.add('u1');
    const { service, sockets, sync } = setup({ redis, watch });
    await service.sweepWatch();
    await settle();
    expect(sockets).toHaveLength(0);
    expect(sync.sync).not.toHaveBeenCalled();
  });

  it('deux process balaient en même temps → UN seul WebSocket ; le perdant lâche au balayage suivant', async () => {
    const redis = fakeRedis();
    const watch = fakeWatch();
    watch.ids.add('u1');
    const a = setup({ redis, watch });
    const b = setup({ redis, watch });
    await Promise.all([a.service.sweepWatch(), b.service.sweepWatch()]);
    await settle();
    expect(a.sockets.length + b.sockets.length).toBe(1);
    await Promise.all([a.service.sweepWatch(), b.service.sweepWatch()]);
    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_LEASE_RENEW_MS * 3);
    expect(a.sockets.length + b.sockets.length).toBe(1);
    expect(a.service.openConnectionCount() + b.service.openConnectionCount()).toBe(1);
    await a.service.onModuleDestroy();
    await b.service.onModuleDestroy();
  });

  it('arrêt du process → WebSocket fermé, bail rendu, veille gardée pour la reprise', async () => {
    const watch = fakeWatch();
    const { service, redis } = setup({ watch });
    await service.attach('u1', 'tab-1');
    await settle();
    service.detach('u1', 'tab-1');
    await settle();
    await service.onModuleDestroy();
    expect(redis.store.has(liveLeaseKey('u1'))).toBe(false);
    expect(watch.ids.has('u1')).toBe(true);
  });
});
