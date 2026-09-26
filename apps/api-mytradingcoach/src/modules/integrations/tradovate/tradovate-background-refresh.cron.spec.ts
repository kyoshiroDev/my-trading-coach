import { describe, it, expect, vi } from 'vitest';
import { BACKGROUND_STALE_MS, TradovateBackgroundRefreshCron } from './tradovate-background-refresh.cron';

/**
 * Filet de fond : sert les features hors app (récap, Weekly Debrief), JAMAIS le temps réel.
 * Un user dont l'app est ouverte est laissé au WebSocket.
 */
function setup(conns: { id: string; userId: string; accountId: string }[], liveUsers: string[] = []) {
  const prisma = { brokerConnection: { findMany: vi.fn(async () => conns) } };
  const connections = { assertConfigured: vi.fn() };
  const sync = { sync: vi.fn(async () => ({ created: 2, duplicates: 0, failed: 0, total: 2 })) };
  const live = { isLive: vi.fn(async (userId: string) => liveUsers.includes(userId)) };
  const cron = new TradovateBackgroundRefreshCron(prisma as never, connections as never, sync as never, live as never);
  return { cron, prisma, connections, sync, live };
}

describe('Tradovate — rafraîchissement de fond (15 min)', () => {
  it('synchronise les connexions en retard, saute celles dont l’app est ouverte', async () => {
    const { cron, sync } = setup(
      [{ id: 'c1', userId: 'u1', accountId: 'a1' }, { id: 'c2', userId: 'u2', accountId: 'a2' }],
      ['u2'],
    );
    expect(await cron.refreshStale()).toEqual({ synced: 1, created: 2, live: 1, failed: 0 });
    expect(sync.sync).toHaveBeenCalledTimes(1);
    expect(sync.sync).toHaveBeenCalledWith('u1', 'a1', { history: expect.any(Boolean) });
  });

  it('le rattrapage mensuel ne tourne qu’au PREMIER passage de chaque heure', async () => {
    // Deux appels Reporting par connexion et par heure suffisent : ce rattrapage ne comble que
    // ce que la séance n'expose pas. Les 3 autres passages de l'heure restent en synchro seule.
    const { cron, sync } = setup([{ id: 'c1', userId: 'u1', accountId: 'a1' }]);
    await cron.refreshStale(new Date('2026-09-26T10:07:00Z'));
    expect(sync.sync).toHaveBeenLastCalledWith('u1', 'a1', { history: true });

    sync.sync.mockClear();
    for (const minute of ['10:22', '10:37', '10:52']) {
      await cron.refreshStale(new Date(`2026-09-26T${minute}:00Z`));
      expect(sync.sync).toHaveBeenLastCalledWith('u1', 'a1', { history: false });
    }
  });

  it('ne cible que les connexions actives, choisies, hors démo, sans synchro depuis 12 min', async () => {
    const { cron, prisma } = setup([]);
    const now = new Date('2026-09-12T12:00:00Z');
    await cron.refreshStale(now);
    const where = (prisma.brokerConnection.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({
      provider: 'TRADOVATE',
      status: 'CONNECTED',
      externalAccountId: { not: null },
      externalEnv: { not: null },
      user: { isDemo: false },
    });
    expect(where['OR']).toEqual([
      { lastSyncAt: null },
      { lastSyncAt: { lt: new Date(now.getTime() - BACKGROUND_STALE_MS) } },
    ]);
  });

  it('un échec n’arrête pas les suivantes', async () => {
    const { cron, sync } = setup([
      { id: 'c1', userId: 'u1', accountId: 'a1' },
      { id: 'c2', userId: 'u2', accountId: 'a2' },
    ]);
    sync.sync.mockRejectedValueOnce(new Error('Tradovate indisponible'));
    expect(await cron.refreshStale()).toMatchObject({ synced: 1, failed: 1 });
  });

  it('intégration non configurée sur l’environnement → rien', async () => {
    const { cron, connections, prisma } = setup([{ id: 'c1', userId: 'u1', accountId: 'a1' }]);
    connections.assertConfigured.mockImplementation(() => { throw new Error('non configuré'); });
    expect(await cron.refreshStale()).toEqual({ synced: 0, created: 0, live: 0, failed: 0 });
    expect(prisma.brokerConnection.findMany).not.toHaveBeenCalled();
  });
});
