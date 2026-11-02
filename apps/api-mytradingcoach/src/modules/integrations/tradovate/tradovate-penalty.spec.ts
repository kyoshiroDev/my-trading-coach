import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { encryptToken } from '@api/common/utils/token-cipher.util';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateClosingsService } from './tradovate-closings.service';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateHistoryService } from './tradovate-history.service';
import { TradovatePayoutsService } from './tradovate-payouts.service';
import { PENALTY_CAPTCHA_S, PENALTY_DEFAULT_S, PENALTY_MAX_S, readPenalty } from './tradovate-penalty';
import { TradovateReportingClient } from './tradovate-reporting.client';
import { TradovateSyncService } from './tradovate-sync.service';
import { TradovateApiError, TradovatePenaltyError } from './tradovate.errors';

/**
 * Tickets de pénalité (#852, #853, #854). Un 200 avec `p-ticket`, `p-time` ou `p-captcha` n'est ni
 * un refus de jeton, ni un rapport vide : il met le login en pause, sans toucher au statut.
 */

const TICKET = 'TICKET-SECRET';
const ticket = (extra: Record<string, unknown> = {}) => ({ 'p-ticket': TICKET, 'p-time': 120, 'p-message': 'msg', ...extra });
const penaltyError = (captcha = false, seconds = 120) => new TradovatePenaltyError(200, 'test', { seconds, captcha });

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('readPenalty', () => {
  it('reconnaît p-ticket, p-time et p-captcha ; lit la durée de p-time', () => {
    expect(readPenalty(ticket())).toEqual({ seconds: 120, captcha: false });
    expect(readPenalty({ 'p-time': '45' })).toEqual({ seconds: 45, captcha: false });
    expect(readPenalty({ 'p-captcha': false })).toEqual({ seconds: PENALTY_DEFAULT_S, captcha: false });
  });

  it('p-time absent ou illisible : 1 heure ; p-time aberrant : borné', () => {
    expect(readPenalty({ 'p-ticket': 'x' })?.seconds).toBe(PENALTY_DEFAULT_S);
    expect(readPenalty({ 'p-ticket': 'x', 'p-time': 'bientôt' })?.seconds).toBe(PENALTY_DEFAULT_S);
    expect(readPenalty({ 'p-ticket': 'x', 'p-time': -5 })?.seconds).toBe(PENALTY_DEFAULT_S);
    expect(readPenalty({ 'p-ticket': 'x', 'p-time': 10_000_000 })?.seconds).toBe(PENALTY_MAX_S);
  });

  it('captcha : non retentable, pause longue quel que soit p-time', () => {
    expect(readPenalty(ticket({ 'p-captcha': true }))).toEqual({ seconds: PENALTY_CAPTCHA_S, captcha: true });
    expect(readPenalty({ captcha: true })).toEqual({ seconds: PENALTY_CAPTCHA_S, captcha: true });
  });

  it('corps ordinaires : aucune pénalité', () => {
    for (const body of [null, undefined, [], 'texte', { data: '' }, { error: 'invalid_token' }, { captcha: false }]) {
      expect(readPenalty(body)).toBeNull();
    }
  });
});

describe('clients HTTP : une pénalité lève une erreur typée', () => {
  const config = { get: (k: string) => ({ TRADOVATE_OAUTH_CLIENT_ID: 'id', TRADOVATE_OAUTH_CLIENT_SECRET: 's' })[k] };
  const window = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-31T00:00:00Z'), accountName: 'APEX' };
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('postToken : 200 + p-ticket → pénalité, jamais un refus', async () => {
    fetchMock.mockResolvedValue(respond(ticket()));
    const err = await new TradovateApiClient(config as never).refresh('RT').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TradovatePenaltyError);
    expect((err as TradovatePenaltyError).kind).toBe('rate_limited');
    expect((err as TradovatePenaltyError).penalty.seconds).toBe(120);
  });

  it('postToken : 200 + invalid_token reste un refus (comportement inchangé)', async () => {
    fetchMock.mockResolvedValue(respond({ error: 'invalid_token' }));
    const err = await new TradovateApiClient(config as never).refresh('RT').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(TradovatePenaltyError);
    expect((err as TradovateApiError).kind).toBe('unauthorized');
  });

  it('lecture REST : 200 + p-ticket → pénalité ; 429 sans ticket reste une limite ordinaire', async () => {
    const client = new TradovateApiClient(config as never);
    fetchMock.mockResolvedValueOnce(respond(ticket()));
    await expect(client.get('demo', '/account/list', 'AT')).rejects.toBeInstanceOf(TradovatePenaltyError);
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
    const err = await client.get('demo', '/account/list', 'AT').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(TradovatePenaltyError);
    expect((err as TradovateApiError).kind).toBe('rate_limited');
  });

  it('fetchCsv : 200 + p-ticket n’est PAS un CSV vide', async () => {
    fetchMock.mockResolvedValue(respond(ticket()));
    await expect(new TradovateReportingClient().fetchCsv('demo', 'AT', 'Performance', window)).rejects.toBeInstanceOf(TradovatePenaltyError);
  });

  it('fetchCsv : un vrai mois vide reste un CSV vide', async () => {
    fetchMock.mockResolvedValue(respond({ data: '\r\n' }));
    await expect(new TradovateReportingClient().fetchCsv('demo', 'AT', 'Performance', window)).resolves.toBe('');
  });

  it('fetchCsv : réponse illisible et 401 gardent leur erreur', async () => {
    const client = new TradovateReportingClient();
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect(((await client.fetchCsv('demo', 'AT', 'Performance', window).catch((e: unknown) => e)) as TradovateApiError).kind).toBe('unavailable');
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    expect(((await client.fetchCsv('demo', 'AT', 'Performance', window).catch((e: unknown) => e)) as TradovateApiError).kind).toBe('unauthorized');
  });
});

/** Redis en mémoire, juste ce que les verrous utilisent. */
function fakeRedis() {
  const store = new Map<string, string>();
  const ttl = new Map<string, number>();
  return {
    store,
    ttl,
    client: {
      set: vi.fn(async (key: string, value: string, _ex: string, seconds: number, nx?: string) => {
        if (nx === 'NX' && store.has(key)) return null;
        store.set(key, value);
        ttl.set(key, seconds);
        return 'OK';
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    },
  };
}

function connectionHarness(overrides: Partial<BrokerConnection> = {}) {
  const key = randomBytes(32);
  const config = { get: (k: string) => ({ BROKER_TOKEN_ENCRYPTION_KEY: key.toString('base64'), JWT_SECRET: 's' })[k] };
  const conn = {
    id: 'c1',
    userId: 'u1',
    accountId: 'a1',
    provider: BrokerProvider.TRADOVATE,
    status: BrokerConnectionStatus.CONNECTED,
    externalUserId: '5551',
    accessTokenEnc: encryptToken('AT-SECRET', key),
    refreshTokenEnc: encryptToken('RT-SECRET', key),
    // Access token à renouveler, refresh_token encore annoncé valide.
    accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000),
    refreshTokenExpiresAt: new Date(Date.now() + 3_600_000),
    apiHostsAt: new Date(),
    apiHosts: null,
    ...overrides,
  } as BrokerConnection;
  const prisma = {
    brokerConnection: {
      findUnique: vi.fn(async () => conn),
      update: vi.fn(async () => conn),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  const api = { refresh: vi.fn(), renewAccessToken: vi.fn() };
  const redis = fakeRedis();
  const service = new TradovateConnectionService(prisma as never, api as never, config as never, redis as never);
  vi.spyOn(service as unknown as { wait: (ms: number) => Promise<void> }, 'wait').mockResolvedValue(undefined);
  const markNeedsReconnect = vi.spyOn(service, 'markNeedsReconnect');
  return { service, conn, prisma, api, redis, markNeedsReconnect };
}

describe('jetons : une pénalité n’est jamais un refus', () => {
  it('refresh pénalisé : une seule tentative, pas de renew, statut intact, login en pause', async () => {
    const { service, conn, api, redis, prisma, markNeedsReconnect } = connectionHarness();
    api.refresh.mockRejectedValue(penaltyError());

    await expect(service.getSession(conn)).rejects.toMatchObject({ code: 'TRADOVATE_PENALIZED' });

    expect(api.refresh).toHaveBeenCalledOnce();
    expect(api.renewAccessToken).not.toHaveBeenCalled();
    expect(markNeedsReconnect).not.toHaveBeenCalled();
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
    expect(redis.store.get('tradovate:penalty:login:5551')).toBe('penalty');
    expect(redis.ttl.get('tradovate:penalty:login:5551')).toBe(120);
  });

  it('pause en cours : la connexion et ses sœurs n’appellent plus Tradovate', async () => {
    const { service, conn, api, redis } = connectionHarness();
    redis.store.set('tradovate:penalty:login:5551', 'penalty');
    const soeur = { ...conn, id: 'c2', accountId: 'a2' };

    await expect(service.getSession(conn)).rejects.toMatchObject({ code: 'TRADOVATE_PENALIZED' });
    await expect(service.getSession(soeur)).rejects.toMatchObject({ code: 'TRADOVATE_PENALIZED' });
    expect(await service.refreshNow(soeur)).toBe('retry');
    expect(api.refresh).not.toHaveBeenCalled();
    expect(api.renewAccessToken).not.toHaveBeenCalled();
  });

  it('un autre login n’est pas mis en pause', async () => {
    const { service, conn, api, redis } = connectionHarness();
    redis.store.set('tradovate:penalty:login:5551', 'penalty');
    api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800, refresh_token: 'RT-2' });
    await expect(service.getSession({ ...conn, externalUserId: '9999' })).resolves.toMatchObject({ token: 'AT-2' });
  });

  it('login inconnu : pause sur la seule connexion', async () => {
    const { service, conn, api, redis } = connectionHarness({ externalUserId: null });
    api.refresh.mockRejectedValue(penaltyError());
    await expect(service.getSession(conn)).rejects.toMatchObject({ code: 'TRADOVATE_PENALIZED' });
    expect(redis.store.get('tradovate:penalty:conn:c1')).toBe('penalty');
  });

  it('fin de pause : le renouvellement repart', async () => {
    const { service, conn, api, redis } = connectionHarness();
    api.refresh.mockRejectedValueOnce(penaltyError());
    await service.getSession(conn).catch(() => undefined);
    redis.store.clear(); // TTL écoulé
    api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800, refresh_token: 'RT-2' });
    await expect(service.getSession(conn)).resolves.toMatchObject({ token: 'AT-2' });
  });

  it('refreshNow (cron) : pénalité → retry, jamais reconnect', async () => {
    const { service, conn, api, markNeedsReconnect } = connectionHarness();
    api.refresh.mockRejectedValue(penaltyError());
    expect(await service.refreshNow(conn)).toBe('retry');
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(markNeedsReconnect).not.toHaveBeenCalled();
  });

  it('tryRevive : pénalité → aucune résurrection et aucune écriture ; pause en cours → aucun appel', async () => {
    const { service, conn, api, redis, prisma } = connectionHarness({ status: BrokerConnectionStatus.NEEDS_RECONNECT });
    api.refresh.mockRejectedValue(penaltyError());
    expect(await service.tryRevive(conn)).toBe(false);
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
    expect(redis.store.has('tradovate:penalty:login:5551')).toBe(true);
    api.refresh.mockClear();
    expect(await service.tryRevive(conn)).toBe(false);
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('relecture des hôtes pénalisée : pause, et la lecture s’arrête', async () => {
    const { service, conn, api, redis } = connectionHarness({
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      apiHostsAt: null,
    });
    api.renewAccessToken.mockRejectedValue(penaltyError());
    await expect(service.getSession(conn)).rejects.toMatchObject({ code: 'TRADOVATE_PENALIZED' });
    expect(redis.store.get('tradovate:penalty:login:5551')).toBe('penalty');
  });

  it('invalid_token : comportement inchangé (2 tentatives, puis repli renew, aucune pause)', async () => {
    const { service, conn, api, redis } = connectionHarness();
    api.refresh.mockRejectedValue(new TradovateApiError('unauthorized', 200, 'invalid_token'));
    api.renewAccessToken.mockResolvedValue({ accessToken: 'AT-3', expirationTime: new Date(Date.now() + 4_800_000).toISOString(), apiHosts: null });
    await expect(service.getSession(conn)).resolves.toMatchObject({ token: 'AT-3' });
    expect(api.refresh).toHaveBeenCalledTimes(2);
    expect(api.renewAccessToken).toHaveBeenCalledOnce();
    expect([...redis.store.keys()].filter((k) => k.startsWith('tradovate:penalty'))).toEqual([]);
  });
});

describe('captcha', () => {
  it('pas de nouvel essai pendant la pause, erreur lisible sur le login, statut intact', async () => {
    const { service, conn, api, redis, prisma, markNeedsReconnect } = connectionHarness();
    api.refresh.mockRejectedValue(penaltyError(true, PENALTY_CAPTCHA_S));

    await expect(service.getSession(conn)).rejects.toMatchObject({ code: 'TRADOVATE_CAPTCHA_REQUIRED' });
    expect(redis.store.get('tradovate:penalty:login:5551')).toBe('captcha');
    expect(redis.ttl.get('tradovate:penalty:login:5551')).toBe(PENALTY_CAPTCHA_S);
    expect(prisma.brokerConnection.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ externalUserId: '5551' }),
      data: { lastSyncError: expect.stringMatching(/vérification/) },
    });
    expect(markNeedsReconnect).not.toHaveBeenCalled();

    api.refresh.mockClear();
    await expect(service.getSession(conn)).rejects.toMatchObject({ code: 'TRADOVATE_CAPTCHA_REQUIRED' });
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('une pénalité ordinaire ne raccourcit pas une pause captcha', async () => {
    const { service, conn, redis } = connectionHarness();
    redis.store.set('tradovate:penalty:login:5551', 'captcha');
    await service.notePenalty(conn, penaltyError());
    expect(redis.store.get('tradovate:penalty:login:5551')).toBe('captcha');
  });
});

describe('journaux', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pénalité : ni jeton, ni ticket, ni identifiant', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service, conn, api } = connectionHarness();
    api.refresh.mockRejectedValue(penaltyError());
    await service.getSession(conn).catch(() => undefined);
    await service.refreshNow(conn);
    const lines = [...warn.mock.calls, ...log.mock.calls].flat().map(String).join('\n');
    expect(lines).toMatch(/Pénalité Tradovate : pause de 120 s/);
    expect(lines).not.toMatch(/SECRET|c1|u1|5551/);
  });

  it('captcha : journal sans jeton ni identifiant', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, conn, api } = connectionHarness();
    api.refresh.mockRejectedValue(penaltyError(true));
    await service.getSession(conn).catch(() => undefined);
    const lines = warn.mock.calls.flat().map(String).join('\n');
    expect(lines).toMatch(/non retentable/);
    expect(lines).not.toMatch(/SECRET|c1|u1|5551/);
  });
});

describe('import d’historique', () => {
  const PERFORMANCE = [
    'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration',
    'MNQZ6,-2,0,0.25,671418950023,671418950030,2,30928.50,30934.00,$22.00,09/23/2026 13:34:57,09/23/2026 13:35:05,7sec',
  ].join('\n');
  const conn = (overrides: Partial<BrokerConnection> = {}) =>
    ({ id: 'c1', userId: 'u1', accountId: 'a1', externalAccountId: '12', externalEnv: 'demo', historyImportedAt: null, ...overrides }) as BrokerConnection;

  function harness(fetchCsv: (name: string, call: number) => string) {
    let call = 0;
    const api = { get: vi.fn(async () => [{ id: 12, name: 'APEX', timestamp: new Date(Date.now() - 100 * 86_400_000).toISOString() }]) };
    const connections = { getSession: vi.fn(async () => ({ token: 'AT', apiHosts: null })), notePenalty: vi.fn(async () => undefined), getConnection: vi.fn() };
    const reporting = { fetchCsv: vi.fn(async (_e: string, _t: string, name: string) => fetchCsv(name, call++)) };
    const trades = { importTrades: vi.fn(async (_u: string, dtos: unknown[]) => ({ created: dtos.length, duplicates: 0, failed: 0, total: dtos.length })) };
    const prisma = { brokerConnection: { update: vi.fn(async () => ({})) } };
    const service = new TradovateHistoryService(
      prisma as never, api as never, connections as never, reporting as never,
      { getImportSetupId: vi.fn(async () => 's') } as never, trades as never,
    );
    vi.spyOn(service as unknown as { wait: (ms: number) => Promise<void> }, 'wait').mockResolvedValue(undefined);
    return { service, connections, reporting, trades, prisma };
  }
  const markerWritten = (prisma: { brokerConnection: { update: ReturnType<typeof vi.fn> } }) =>
    prisma.brokerConnection.update.mock.calls.some((c) => 'historyImportedAt' in (c[0] as { data: object }).data);

  it('mois pénalisé : marqueur NON posé, arrêt immédiat, erreur remontée', async () => {
    const { service, connections, reporting, prisma } = harness(() => { throw penaltyError(); });
    await expect(service.importHistory('u1', conn())).rejects.toMatchObject({ code: 'TRADOVATE_PENALIZED' });
    expect(markerWritten(prisma)).toBe(false);
    expect(reporting.fetchCsv).toHaveBeenCalledOnce();
    expect(connections.notePenalty).toHaveBeenCalledOnce();
  });

  it('pénalité après un mois réussi : le mois réussi reste compté, le marqueur reste vide', async () => {
    const { service, prisma } = harness((name, call) => {
      if (call === 0) return '';
      if (name === 'Performance') throw penaltyError();
      return '';
    });
    await expect(service.importHistory('u1', conn())).rejects.toMatchObject({ code: 'TRADOVATE_PENALIZED' });
    expect(markerWritten(prisma)).toBe(false);
  });

  it('Fills pénalisé : pas d’import en P&L brut, la fenêtre sera relue', async () => {
    const { service, trades, prisma } = harness((name) => {
      if (name === 'Performance') return PERFORMANCE;
      throw penaltyError();
    });
    await expect(service.importHistory('u1', conn())).rejects.toMatchObject({ code: 'TRADOVATE_PENALIZED' });
    expect(trades.importTrades).not.toHaveBeenCalled();
    expect(markerWritten(prisma)).toBe(false);
  });

  it('Cash History pénalisé : pas d’import à la commission seule', async () => {
    const { service, trades } = harness((name) => {
      if (name === 'Performance') return PERFORMANCE;
      if (name === 'Fills') return '_id,Fill ID,commission\n1,671418950023,1.04';
      throw penaltyError();
    });
    await expect(service.importHistory('u1', conn())).rejects.toMatchObject({ code: 'TRADOVATE_PENALIZED' });
    expect(trades.importTrades).not.toHaveBeenCalled();
  });

  it('témoin : sans pénalité, des mois vides posent bien le marqueur', async () => {
    const { service, prisma } = harness(() => '');
    await service.importHistory('u1', conn());
    expect(markerWritten(prisma)).toBe(true);
  });

  it('réparation des frais : la pénalité arrête la relecture', async () => {
    const { service, reporting, connections } = harness(() => { throw penaltyError(); });
    const windows = service.recomputedWindows(conn());
    await expect(windows.next()).rejects.toMatchObject({ code: 'TRADOVATE_PENALIZED' });
    expect(reporting.fetchCsv).toHaveBeenCalledOnce();
    expect(connections.notePenalty).toHaveBeenCalledOnce();
  });
});

describe('clôtures et payouts', () => {
  const conn = { id: 'c1', accountId: 'a1', externalAccountId: '12', externalEnv: 'demo' } as BrokerConnection;
  const api = { get: vi.fn(async () => [{ id: 12, name: 'APEX', timestamp: '2026-01-01T00:00:00Z' }]) };

  it('clôtures : la pénalité remonte au lieu d’être ignorée', async () => {
    const reporting = { fetchCsv: vi.fn(async () => { throw penaltyError(); }) };
    const prisma = { brokerDailyClose: { findFirst: vi.fn(async () => null), upsert: vi.fn() } };
    const service = new TradovateClosingsService(prisma as never, api as never, reporting as never);
    await expect(service.refresh(conn, 'AT', null)).rejects.toBeInstanceOf(TradovatePenaltyError);
    expect(reporting.fetchCsv).toHaveBeenCalledOnce();
  });

  it('payouts : la pénalité remonte, le curseur n’avance pas', async () => {
    const reporting = { fetchCsv: vi.fn(async () => { throw penaltyError(); }) };
    const prisma = {
      tradingAccount: { findUnique: vi.fn(async () => ({ type: 'FUNDED' })) },
      brokerConnection: { update: vi.fn() },
    };
    const service = new TradovatePayoutsService(prisma as never, api as never, reporting as never);
    await expect(service.refresh(conn, 'AT', null)).rejects.toBeInstanceOf(TradovatePenaltyError);
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
  });
});

describe('synchro', () => {
  it('lecture pénalisée : pause notée, erreur lisible, statut intact, journal sans identifiant', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const conn = { id: 'c1', userId: 'u1', accountId: 'a1', externalAccountId: '12', externalEnv: 'demo' } as BrokerConnection;
    const connections = {
      assertConfigured: vi.fn(),
      getConnection: vi.fn(async () => conn),
      tryLock: vi.fn(async () => true),
      unlock: vi.fn(async () => undefined),
      getSession: vi.fn(async () => ({ token: 'AT', apiHosts: null })),
      notePenalty: vi.fn(async () => undefined),
    };
    const apiClient = { get: vi.fn(async () => { throw penaltyError(); }) };
    const prisma = { brokerConnection: { update: vi.fn(async () => ({})) } };
    const none = {} as never;
    const service = new TradovateSyncService(prisma as never, apiClient as never, connections as never, none, none, none, none, none, none);

    await expect(service.sync('u1', 'a1')).rejects.toMatchObject({ code: 'TRADOVATE_PENALIZED' });

    expect(connections.notePenalty).toHaveBeenCalledOnce();
    expect(prisma.brokerConnection.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { lastSyncError: expect.stringMatching(/limite temporairement/) },
    });
    expect(connections.unlock).toHaveBeenCalledOnce();
    expect(warn.mock.calls.flat().map(String).join('\n')).not.toContain('c1');
    vi.restoreAllMocks();
  });
});
