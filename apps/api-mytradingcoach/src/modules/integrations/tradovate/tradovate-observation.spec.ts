import { describe, expect, it, vi } from 'vitest';
import { AccountStatus } from '@prisma/client';
import { TradovateObservationCron } from './tradovate-observation.cron';
import { classifyFailure, OBSERVATION_RETENTION_DAYS, observationDay, readListedAccount } from './tradovate-observation';
import { TradovateApiError, TradovateException, TradovatePenaltyError } from './tradovate.errors';

/**
 * Journal d'observation (#684, phase 2) : une lecture de `/account/list` par login et par jour,
 * une ligne par connexion, rien d'autre. Aucun appel réel : client API simulé.
 */

const now = new Date('2026-11-03T05:40:00Z'); // 06:40 à Paris
const H = 3_600_000;

describe('observationDay', () => {
  it('jour de Paris, à minuit UTC', () => {
    expect(observationDay(now).toISOString()).toBe('2026-11-03T00:00:00.000Z');
    // 23:30 UTC le 2 = 00:30 le 3 à Paris.
    expect(observationDay(new Date('2026-11-02T23:30:00Z')).toISOString()).toBe('2026-11-03T00:00:00.000Z');
  });
});

describe('readListedAccount', () => {
  it('présent : champs bruts recopiés, absents laissés à null', () => {
    expect(readListedAccount([{ id: 11, active: false, closed: true }], '11'))
      .toEqual({ listed: true, active: false, closed: true, restricted: null });
  });

  it('absent de la liste ou liste illisible : listed false, champs null', () => {
    expect(readListedAccount([{ id: 12 }], '11')).toEqual({ listed: false, active: null, closed: null, restricted: null });
    expect(readListedAccount({ errorText: 'x' }, '11').listed).toBe(false);
  });
});

describe('classifyFailure', () => {
  it.each([
    [new TradovateApiError('unauthorized', 401, '/account/list'), 'UNAUTHORIZED', 401],
    [new TradovateApiError('forbidden', 403, '/account/list'), 'FORBIDDEN', 403],
    [new TradovateApiError('rate_limited', 429, '/account/list'), 'RATE_LIMITED', 429],
    [new TradovateApiError('not_found', 404, '/account/list'), 'NOT_FOUND', 404],
    [new TradovateApiError('unavailable', 0, '/account/list : TimeoutError'), 'UNAVAILABLE', null],
    [new TradovateApiError('unavailable', 502, '/account/list'), 'UNAVAILABLE', 502],
    [new TradovatePenaltyError(200, '/account/list', { ticket: true, seconds: 60, captcha: false } as never), 'PENALIZED', 200],
    [new TradovateException('TRADOVATE_PENALIZED'), 'PENALIZED', null],
    [new TradovateException('TRADOVATE_CAPTCHA_REQUIRED'), 'PENALIZED', null],
    [new TradovateException('TRADOVATE_RECONNECT_REQUIRED'), 'TOKEN_REFUSED', null],
    [new TradovateException('TRADOVATE_REFRESH_DEFERRED'), 'TOKEN_DEFERRED', null],
    [new Error('boom'), 'ERROR', null],
  ])('%s → %s', (err, outcome, httpStatus) => {
    expect(classifyFailure(err)).toEqual({ outcome, httpStatus });
  });
});

type Conn = {
  id: string; userId: string; externalUserId: string | null; externalAccountId: string; externalEnv: string;
  historyImportedAt: Date | null; lastSyncAt: Date | null;
  account: { status: AccountStatus; statusChangedAt: Date | null };
};

function conn(id: string, over: Partial<Conn> = {}): Conn {
  return {
    id, userId: 'u1', externalUserId: '900', externalAccountId: id.replace(/\D/g, ''), externalEnv: 'demo',
    historyImportedAt: null, lastSyncAt: null, account: { status: AccountStatus.ACTIVE, statusChangedAt: null }, ...over,
  };
}

function setup(opts: {
  conns?: Conn[];
  list?: unknown;
  getError?: unknown;
  sessionError?: unknown;
  locked?: string[];
  configured?: boolean;
} = {}) {
  const prisma = {
    brokerConnection: { findMany: vi.fn(async () => opts.conns ?? []) },
    tradovateAccountObservation: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  const connections = {
    assertConfigured: vi.fn(() => {
      if (opts.configured === false) throw new TradovateException('TRADOVATE_NOT_CONFIGURED');
    }),
    tryLock: vi.fn(async (id: string) => !(opts.locked ?? []).includes(id)),
    unlock: vi.fn(async () => undefined),
    getSession: vi.fn(async () => {
      if (opts.sessionError) throw opts.sessionError;
      return { token: 'jeton-secret', apiHosts: null };
    }),
    notePenalty: vi.fn(async () => undefined),
  };
  const api = {
    get: vi.fn(async () => {
      if (opts.getError) throw opts.getError;
      return opts.list ?? [];
    }),
  };
  const cron = new TradovateObservationCron(prisma as never, connections as never, api as never);
  const logger = { log: vi.fn(), warn: vi.fn() };
  (cron as unknown as { logger: typeof logger }).logger = logger;
  const rows = () => prisma.tradovateAccountObservation.createMany.mock.calls.flatMap(([a]) => a.data as Record<string, unknown>[]);
  return { cron, prisma, connections, api, logger, rows };
}

describe('TradovateObservationCron', () => {
  it('cible les connexions CONNECTED avec compte choisi, hors démo, pas encore notées ce jour', async () => {
    const { cron, prisma } = setup();
    await cron.observe(now);
    const where = (prisma.brokerConnection.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({
      provider: 'TRADOVATE',
      status: 'CONNECTED',
      externalAccountId: { not: null },
      user: { isDemo: false },
      observations: { none: { day: observationDay(now) } },
    });
    // Comptes en pause (#684) compris : aucun filtre sur le statut du compte.
    expect(where).not.toHaveProperty('NOT');
    expect(where).not.toHaveProperty('account');
  });

  it('intégration non configurée : rien', async () => {
    const { cron, prisma } = setup({ configured: false });
    await cron.observe(now);
    expect(prisma.brokerConnection.findMany).not.toHaveBeenCalled();
  });

  it('sœurs d’un login : UN appel, une ligne par connexion avec ce que la liste dit de chacune', async () => {
    const failedOld = { status: AccountStatus.FAILED, statusChangedAt: new Date(now.getTime() - 72 * H) };
    const { cron, api, rows } = setup({
      conns: [
        conn('c1'),
        conn('c2', { account: failedOld, historyImportedAt: new Date('2026-10-01') }),
        conn('c3'),
      ],
      list: [{ id: 1, active: true, closed: false, restricted: false }, { id: 2, active: false, closed: true }],
    });
    const r = await cron.observe(now);
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledWith('demo', '/account/list', 'jeton-secret', undefined, null);
    expect(rows()).toEqual([
      expect.objectContaining({ connectionId: 'c1', outcome: 'OK', httpStatus: 200, listed: true, active: true, closed: false, restricted: false, accountStatus: 'ACTIVE', syncPaused: false }),
      expect.objectContaining({ connectionId: 'c2', outcome: 'OK', listed: true, active: false, closed: true, restricted: null, accountStatus: 'FAILED', syncPaused: true }),
      expect.objectContaining({ connectionId: 'c3', outcome: 'OK', listed: false, active: null, closed: null, restricted: null }),
    ]);
    expect(r).toMatchObject({ observed: 3, listed: 2, missing: 1, closed: 1, failed: 0, calls: 1 });
  });

  it('logins différents, ou même login chez deux utilisateurs MTC, ou login inconnu : un appel chacun', async () => {
    const { cron, api } = setup({
      conns: [
        conn('c1'),
        conn('c2', { externalUserId: '901' }),
        conn('c3', { userId: 'u2' }),
        conn('c4', { externalUserId: null }),
        conn('c5', { externalUserId: null }),
        conn('c6', { externalEnv: 'live' }),
      ],
    });
    await cron.observe(now);
    expect(api.get).toHaveBeenCalledTimes(6);
  });

  it('échec de la liste : une ligne par sœur avec l’issue, sans champs du compte', async () => {
    const { cron, rows } = setup({
      conns: [conn('c1'), conn('c2')],
      getError: new TradovateApiError('forbidden', 403, '/account/list'),
    });
    const r = await cron.observe(now);
    expect(rows()).toEqual([
      expect.objectContaining({ connectionId: 'c1', outcome: 'FORBIDDEN', httpStatus: 403, listed: null, closed: null }),
      expect.objectContaining({ connectionId: 'c2', outcome: 'FORBIDDEN', httpStatus: 403, listed: null }),
    ]);
    expect(r.failed).toBe(2);
  });

  it('ticket de pénalité reçu : noté sur le login, ligne PENALIZED', async () => {
    const penalty = new TradovatePenaltyError(200, '/account/list', { ticket: true, seconds: 60, captcha: false } as never);
    const { cron, connections, rows } = setup({ conns: [conn('c1')], getError: penalty });
    await cron.observe(now);
    expect(connections.notePenalty).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), penalty);
    expect(rows()[0]).toMatchObject({ outcome: 'PENALIZED', httpStatus: 200 });
  });

  it('pause de pénalité en cours : aucun appel de la liste, ligne PENALIZED', async () => {
    const { cron, api, rows } = setup({ conns: [conn('c1')], sessionError: new TradovateException('TRADOVATE_PENALIZED') });
    const r = await cron.observe(now);
    expect(api.get).not.toHaveBeenCalled();
    expect(rows()[0]).toMatchObject({ outcome: 'PENALIZED', httpStatus: null });
    expect(r.calls).toBe(0);
  });

  it('jeton refusé : ligne TOKEN_REFUSED, aucune lecture', async () => {
    const { cron, api, rows } = setup({ conns: [conn('c1')], sessionError: new TradovateException('TRADOVATE_RECONNECT_REQUIRED') });
    await cron.observe(now);
    expect(api.get).not.toHaveBeenCalled();
    expect(rows()[0]).toMatchObject({ outcome: 'TOKEN_REFUSED' });
  });

  it('verrou : première sœur occupée → lecture avec la suivante ; toutes occupées → rien écrit', async () => {
    const a = setup({ conns: [conn('c1'), conn('c2')], locked: ['c1'] });
    await a.cron.observe(now);
    expect(a.connections.getSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }));
    expect(a.rows()).toHaveLength(2);
    expect(a.connections.unlock).toHaveBeenCalledWith('c2');

    const b = setup({ conns: [conn('c1'), conn('c2')], locked: ['c1', 'c2'] });
    const r = await b.cron.observe(now);
    expect(b.prisma.tradovateAccountObservation.createMany).not.toHaveBeenCalled();
    expect(r.skipped).toBe(2);
  });

  it('verrou rendu même en cas d’échec', async () => {
    const { cron, connections } = setup({ conns: [conn('c1')], getError: new Error('boom') });
    await cron.observe(now);
    expect(connections.unlock).toHaveBeenCalledWith('c1');
  });

  it('idempotent : insertion sans doublon ; purge au-delà de la conservation', async () => {
    const { cron, prisma } = setup({ conns: [conn('c1')] });
    await cron.observe(now);
    expect(prisma.tradovateAccountObservation.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    const cutoff = new Date(observationDay(now).getTime() - OBSERVATION_RETENTION_DAYS * 24 * H);
    expect(prisma.tradovateAccountObservation.deleteMany).toHaveBeenCalledWith({ where: { day: { lt: cutoff } } });
  });

  it('journal : des nombres seulement, ni jeton, ni identifiant, ni nom de compte', async () => {
    const { cron, logger, rows } = setup({
      conns: [conn('c1'), conn('c2', { externalUserId: '901' })],
      list: [{ id: 1, name: 'APEX-123456', active: true }],
    });
    await cron.observe(now);
    const logged = JSON.stringify([...logger.log.mock.calls, ...logger.warn.mock.calls]);
    for (const secret of ['jeton-secret', 'c1', 'c2', 'u1', '900', '901', 'APEX']) expect(logged).not.toContain(secret);
    // Les lignes non plus ne portent ni nom ni identifiant Tradovate.
    expect(JSON.stringify(rows())).not.toContain('APEX');
    expect(Object.keys(rows()[0]).sort()).toEqual(
      ['accountStatus', 'active', 'closed', 'connectionId', 'day', 'httpStatus', 'lastSyncAt', 'listed', 'outcome', 'restricted', 'syncPaused'],
    );
  });
});
