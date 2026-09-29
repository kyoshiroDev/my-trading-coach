import { REFRESH_WINDOW_MS, TradovateTokenRefreshCron } from './tradovate-token-refresh.cron';
import { TradovateException } from './tradovate.errors';

/**
 * Cron de maintien des tokens. Le vrai renouvellement (grant refresh_token,
 * rotation, chiffrement) est prouvé par tradovate-sync.int-spec.ts et
 * tradovate-connection.service.spec.ts ; ici : QUI est ciblé, et ce qui se passe pour chacun.
 */
describe('TradovateTokenRefreshCron', () => {
  const now = new Date('2026-09-12T12:00:00Z');

  function setup(opts: {
    due?: { id: string }[];
    outcomes?: Record<string, 'refreshed' | 'reconnect' | 'retry'>;
    locked?: string[];
    configured?: boolean;
    condemned?: { id: string }[];
    revivable?: string[];
  } = {}) {
    // 1er findMany : connexions à renouveler · 2e : connexions « à reconnecter » à retenter.
    const prisma = {
      brokerConnection: {
        findMany: vi.fn().mockResolvedValueOnce(opts.due ?? []).mockResolvedValueOnce(opts.condemned ?? []),
      },
    };
    const connections = {
      assertConfigured: vi.fn(() => {
        if (opts.configured === false) throw new TradovateException('TRADOVATE_NOT_CONFIGURED');
      }),
      tryLock: vi.fn(async (id: string) => !(opts.locked ?? []).includes(id)),
      unlock: vi.fn(),
      refreshNow: vi.fn(async (c: { id: string }) => opts.outcomes?.[c.id] ?? 'refreshed'),
      tryRevive: vi.fn(async (c: { id: string }) => (opts.revivable ?? []).includes(c.id)),
    };
    const cron = new TradovateTokenRefreshCron(prisma as never, connections as never);
    return { cron, prisma, connections };
  }

  it('cible les connexions Tradovate actives, avec refresh_token, hors démo, qui expirent sous 18 h', async () => {
    const { cron, prisma } = setup();
    await cron.refreshExpiring(now);
    const where = prisma.brokerConnection.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      provider: 'TRADOVATE',
      status: 'CONNECTED',
      refreshTokenEnc: { not: null },
      user: { isDemo: false },
    });
    expect(where.OR).toEqual([
      { refreshTokenExpiresAt: null },
      { refreshTokenExpiresAt: { lt: new Date(now.getTime() + REFRESH_WINDOW_MS) } },
    ]);
  });

  it('fenêtre de 18 h, cron horaire : 15 passages ratés (panne) restent couverts', () => {
    expect(REFRESH_WINDOW_MS).toBe(18 * 3600_000);
    // Cron toutes les heures : même en ratant 15 passages, il reste 3 h avant l'échéance.
    expect(REFRESH_WINDOW_MS - 15 * 3600_000).toBeGreaterThan(0);
  });

  it('renouvelle chaque connexion sous verrou, et compte les issues', async () => {
    const { cron, connections } = setup({
      due: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      outcomes: { a: 'refreshed', b: 'reconnect', c: 'retry' },
    });
    const r = await cron.refreshExpiring(now);
    expect(r).toEqual({ refreshed: 1, reconnect: 1, retry: 1, locked: 0, revived: 0 });
    expect(connections.unlock).toHaveBeenCalledTimes(3);
  });

  it('synchro en cours sur une connexion : on ne renouvelle pas en parallèle (rotation du token)', async () => {
    const { cron, connections } = setup({ due: [{ id: 'a' }, { id: 'b' }], locked: ['a'] });
    const r = await cron.refreshExpiring(now);
    expect(r.locked).toBe(1);
    expect(connections.refreshNow).toHaveBeenCalledTimes(1);
    expect(connections.refreshNow.mock.calls[0][0]).toEqual({ id: 'b' });
  });

  it('échec inattendu sur une connexion : verrou libéré, les suivantes sont quand même renouvelées', async () => {
    const { cron, connections } = setup({ due: [{ id: 'a' }, { id: 'b' }] });
    connections.refreshNow.mockRejectedValueOnce(new Error('boom'));
    const r = await cron.refreshExpiring(now);
    expect(r).toEqual({ refreshed: 1, reconnect: 0, retry: 1, locked: 0, revived: 0 });
    expect(connections.unlock).toHaveBeenCalledWith('a');
    expect(connections.refreshNow).toHaveBeenCalledTimes(2);
  });

  it('intégration non configurée sur cet environnement : ne fait rien', async () => {
    const { cron, prisma } = setup({ configured: false });
    expect(await cron.refreshExpiring(now)).toEqual({ refreshed: 0, reconnect: 0, retry: 0, locked: 0, revived: 0 });
    expect(prisma.brokerConnection.findMany).not.toHaveBeenCalled();
  });

  // ── Seconde chance (bug prod 2026-09-26 : connexions condamnées sur un refus passager) ──
  it('retente les connexions « à reconnecter » dont le refresh_token est encore annoncé valide', async () => {
    const { cron, prisma, connections } = setup({ condemned: [{ id: 'x' }, { id: 'y' }], revivable: ['x'] });
    const r = await cron.refreshExpiring(now);
    const where = prisma.brokerConnection.findMany.mock.calls[1][0].where;
    expect(where).toMatchObject({
      status: 'NEEDS_RECONNECT',
      refreshTokenEnc: { not: null },
      refreshTokenExpiresAt: { gt: now },
      user: { isDemo: false },
    });
    expect(r.revived).toBe(1);
    expect(connections.tryRevive).toHaveBeenCalledTimes(2);
    expect(connections.unlock).toHaveBeenCalledWith('x');
    expect(connections.unlock).toHaveBeenCalledWith('y');
  });

  it('seconde chance : jamais en parallèle d’une synchro de la même connexion', async () => {
    const { cron, connections } = setup({ condemned: [{ id: 'x' }], locked: ['x'] });
    await cron.refreshExpiring(now);
    expect(connections.tryRevive).not.toHaveBeenCalled();
  });
});
