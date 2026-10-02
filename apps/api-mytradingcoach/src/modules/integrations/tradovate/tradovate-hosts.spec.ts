import { describe, it, expect, vi, afterEach } from 'vitest';
import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { encryptToken } from '@api/common/utils/token-cipher.util';
import {
  fetchFollowingRedirect,
  parseApiHosts,
  reportingBase,
  restBase,
  wsUrl,
} from './tradovate-hosts';
import { TradovateLiveConnection, type LiveSocket } from './tradovate-live.connection';
import { TradovateTokenManager } from './tradovate-token-manager';

/** Réponse RÉELLE de accessTokenRequest / renewAccessToken, relevée le 2026-10-02 (demo et live). */
const MESURE = {
  live: 'live.tradovateapi.com',
  demo: 'demo.tradovateapi.com',
  mdLive: 'md.tradovateapi.com',
  mdDemo: 'md-demo.tradovateapi.com',
  replay: 'replay.tradovateapi.com',
  reportingLive: 'rpt-live.tradovateapi.com',
  reportingDemo: 'rpt-demo.tradovateapi.com',
  riskMonitorLive: 'risk-monitor-api-live.ninjatrader.com',
  riskMonitorDemo: 'risk-monitor-api-demo.ninjatrader.com',
  userContext: 'user-context-api.ninjatrader.com',
};
/** Hôtes d'une prop firm sur infra dédiée (forme décrite par la doc « Dynamic API Hosts »). */
const PROP_FIRM = { ...MESURE, demo: 'apex-demo.tradovateapi.com', reportingDemo: 'apex-rpt-demo.tradovateapi.com' };

describe('apiHosts — lecture et construction des URL', () => {
  it('lit la forme réelle mesurée (hôtes nus)', () => {
    expect(parseApiHosts(MESURE)).toEqual(MESURE);
  });

  it('écarte ce qui n’est pas un hôte nu (schéma, chemin, port, identifiants)', () => {
    expect(
      parseApiHosts({
        live: 'live.tradovateapi.com',
        demo: 'https://evil.example/v1',
        reportingDemo: 'rpt.example:8443',
        reportingLive: 'user@rpt.example',
      }),
    ).toEqual({ live: 'live.tradovateapi.com' });
    expect(parseApiHosts(null)).toBeNull();
    expect(parseApiHosts({})).toBeNull();
    expect(parseApiHosts(['demo.tradovateapi.com'])).toBeNull();
  });

  it('REST, WebSocket et reporting suivent l’hôte de la prop firm', () => {
    expect(restBase('demo', PROP_FIRM)).toBe('https://apex-demo.tradovateapi.com/v1');
    expect(wsUrl('demo', PROP_FIRM)).toBe('wss://apex-demo.tradovateapi.com/v1/websocket');
    expect(reportingBase('demo', PROP_FIRM)).toBe('https://apex-rpt-demo.tradovateapi.com');
    expect(restBase('live', PROP_FIRM)).toBe('https://live.tradovateapi.com/v1');
    expect(reportingBase('live', PROP_FIRM)).toBe('https://rpt-live.tradovateapi.com');
  });

  it('sans apiHosts : repli explicite sur les hôtes historiques', () => {
    expect(restBase('demo', null)).toBe('https://demo.tradovateapi.com/v1');
    expect(wsUrl('demo', undefined)).toBe('wss://demo.tradovateapi.com/v1/websocket');
    expect(reportingBase('demo', { live: 'live.tradovateapi.com' })).toBe('https://rpt-demo.tradovateapi.com');
  });
});

describe('fetchFollowingRedirect — filet 307 d’un hôte périmé', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('suit la 307 EN GARDANT le jeton (fetch le retirerait seul)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: 'https://apex-demo.tradovateapi.com/v1/account/list' } }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onRedirect = vi.fn();
    const res = await fetchFollowingRedirect(
      'https://demo.tradovateapi.com/v1/account/list',
      { headers: { Authorization: 'Bearer AT-1' } },
      onRedirect,
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://apex-demo.tradovateapi.com/v1/account/list',
      expect.objectContaining({ headers: { Authorization: 'Bearer AT-1' }, redirect: 'manual' }),
    );
    expect(onRedirect).toHaveBeenCalledWith('demo.tradovateapi.com', 'apex-demo.tradovateapi.com');
  });

  it('ne suit jamais une redirection vers du http clair', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, { status: 307, headers: { location: 'http://apex-demo.tradovateapi.com/v1/x' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchFollowingRedirect('https://demo.tradovateapi.com/v1/x', {});
    expect(res.status).toBe(307);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('WebSocket — URL relue à chaque (re)connexion', () => {
  it('l’hôte change entre deux connexions → la reconnexion part sur le nouvel hôte', async () => {
    vi.useFakeTimers();
    try {
      const urls: string[] = [];
      const sockets: LiveSocket[] = [];
      let hosts: unknown = MESURE;
      const live = new TradovateLiveConnection({
        url: () => wsUrl('demo', hosts),
        externalAccountId: 1,
        getToken: async () => 'AT-1',
        onTradeEvent: vi.fn(),
        socketFactory: (url) => {
          urls.push(url);
          const s = { readyState: 1, send: vi.fn(), close: vi.fn(), onmessage: null, onclose: null, onerror: null } as LiveSocket;
          sockets.push(s);
          return s;
        },
      });
      live.start();
      await vi.advanceTimersByTimeAsync(0);
      hosts = PROP_FIRM; // bascule NinjaTrader : la socket tombe (421), les hôtes ont changé
      sockets[0].onclose?.({ code: 1006 });
      await vi.advanceTimersByTimeAsync(60_000);
      live.stop();
      expect(urls[0]).toBe('wss://demo.tradovateapi.com/v1/websocket');
      expect(urls[1]).toBe('wss://apex-demo.tradovateapi.com/v1/websocket');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TradovateTokenManager — relecture de apiHosts', () => {
  const key = randomBytes(32);

  function setup(overrides: Partial<BrokerConnection> = {}) {
    const conn = {
      id: 'c1',
      userId: 'u1',
      accountId: 'a1',
      provider: BrokerProvider.TRADOVATE,
      status: BrokerConnectionStatus.CONNECTED,
      accessTokenEnc: encryptToken('AT-1', key),
      refreshTokenEnc: encryptToken('RT-1', key),
      accessTokenExpiresAt: new Date(Date.now() + 120 * 60_000),
      refreshTokenExpiresAt: null,
      externalUserId: '5751613',
      apiHosts: MESURE,
      apiHostsAt: null,
      ...overrides,
    } as unknown as BrokerConnection;
    const prisma = {
      brokerConnection: {
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(conn),
      },
    };
    const api = {
      refresh: vi.fn(),
      renewAccessToken: vi.fn().mockResolvedValue({
        accessToken: 'AT-RENEW',
        expirationTime: new Date(Date.now() + 80 * 60_000).toISOString(),
        apiHosts: PROP_FIRM,
      }),
    };
    const logger = { log: vi.fn(), warn: vi.fn() };
    const manager = new TradovateTokenManager({
      prisma: prisma as never,
      api: api as never,
      locks: {} as never,
      logger: logger as never,
      tokenKey: () => key,
      wait: async () => undefined,
      markNeedsReconnect: vi.fn(),
    });
    return { manager, conn, prisma, api, logger };
  }

  it('hôtes jamais lus → renewAccessToken, hôtes + jeton persistés et diffusés aux sœurs', async () => {
    const { manager, conn, prisma, api, logger } = setup();
    await expect(manager.getSession(conn)).resolves.toEqual({ token: 'AT-RENEW', apiHosts: PROP_FIRM });
    expect(api.renewAccessToken).toHaveBeenCalledWith('AT-1');
    const data = prisma.brokerConnection.update.mock.calls[0][0].data;
    expect(data.apiHosts).toEqual(PROP_FIRM);
    expect(data.apiHostsAt).toBeInstanceOf(Date);
    expect(prisma.brokerConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ externalUserId: '5751613', id: { not: 'c1' } }),
        data: expect.objectContaining({ apiHosts: PROP_FIRM }),
      }),
    );
    // Changement d'hôte loggé : c'est la preuve attendue côté prod.
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('demo=apex-demo.tradovateapi.com'));
  });

  it('hôtes lus il y a plus de 30 min → relus', async () => {
    const { manager, conn, api } = setup({ apiHostsAt: new Date(Date.now() - 31 * 60_000) });
    await manager.getAccessToken(conn);
    expect(api.renewAccessToken).toHaveBeenCalledTimes(1);
  });

  it('hôtes frais → aucun appel, hôtes stockés rendus', async () => {
    const { manager, conn, api } = setup({ apiHostsAt: new Date() });
    await expect(manager.getSession(conn)).resolves.toEqual({ token: 'AT-1', apiHosts: MESURE });
    expect(api.renewAccessToken).not.toHaveBeenCalled();
  });

  it('relecture en échec → jamais bloquant : jeton et hôtes connus conservés', async () => {
    const { manager, conn, api, prisma } = setup();
    api.renewAccessToken.mockRejectedValueOnce(new Error('réseau'));
    await expect(manager.getSession(conn)).resolves.toEqual({ token: 'AT-1', apiHosts: MESURE });
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
  });
});
