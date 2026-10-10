import { describe, it, expect, vi } from 'vitest';
import {
  BACKGROUND_LOCK_KEY,
  BACKGROUND_USER_CONCURRENCY,
  BACKGROUND_STALE_MS,
  FULL_BACKFILLS_PER_PASS,
  TradovateBackgroundRefreshCron,
} from './tradovate-background-refresh.cron';

/**
 * Filet de fond : sert les features hors app (récap, Weekly Debrief), JAMAIS le temps réel.
 * Un user dont l'app est ouverte est laissé au WebSocket.
 */
type Conn = { id: string; userId: string; accountId: string; historyImportedAt?: Date | null };

function setup(conns: Conn[], liveUsers: string[] = []) {
  const prisma = {
    brokerConnection: {
      findMany: vi.fn(async () =>
        conns.map((c) => ({ historyImportedAt: new Date('2026-09-01T00:00:00Z'), ...c })),
      ),
    },
  };
  const connections = { assertConfigured: vi.fn() };
  const sync = { sync: vi.fn(async (_userId: string, _accountId?: string, _opts?: unknown) => ({ created: 2, duplicates: 0, failed: 0, total: 2 })) };
  const history = { importForAccount: vi.fn(async () => ({ created: 5 })) };
  const live = { isLive: vi.fn(async (userId: string) => liveUsers.includes(userId)) };
  const store = new Map<string, string>();
  const redis = {
    client: {
      set: vi.fn(async (k: string, v: string, _px: string, _ttl: number, nx?: string) => {
        if (nx === 'NX' && store.has(k)) return null;
        store.set(k, v);
        return 'OK';
      }),
      eval: vi.fn(async (_lua: string, _n: number, k: string, v: string) => (store.get(k) === v ? (store.delete(k), 1) : 0)),
    },
  };
  const cron = new TradovateBackgroundRefreshCron(
    prisma as never, connections as never, sync as never, history as never, live as never, redis as never,
  );
  return { cron, prisma, connections, sync, history, live, redis, store };
}

describe('Tradovate — rafraîchissement de fond (15 min)', () => {
  it('synchronise les connexions en retard, saute celles dont l’app est ouverte', async () => {
    const { cron, sync } = setup(
      [{ id: 'c1', userId: 'u1', accountId: 'a1' }, { id: 'c2', userId: 'u2', accountId: 'a2' }],
      ['u2'],
    );
    // Heure figée HORS passage horaire : sans ça le test dépend de la minute réelle de l'horloge
    // (au premier quart d'heure, l'utilisateur en direct reçoit son rapport mensuel).
    const r = await cron.refreshStale(new Date('2026-09-26T10:37:00Z'));
    expect(r).toEqual({ synced: 1, created: 2, live: 1, failed: 0, backfilled: 0 });
    expect(sync.sync).toHaveBeenCalledTimes(1);
    expect(sync.sync).toHaveBeenCalledWith('u1', 'a1', { history: expect.any(Boolean) });
  });

  it('app ouverte AU passage horaire → le mois est retiré quand même, sans refaire la séance', async () => {
    // Le trou reparé : un utilisateur qui laisse l'app ouverte toute la journée etait saute par
    // le cron, et le WebSocket ne fait que la seance — il n'avait donc JAMAIS le filet mensuel.
    const { cron, sync, history } = setup([{ id: 'c1', userId: 'u1', accountId: 'a1' }], ['u1']);

    const r = await cron.refreshStale(new Date('2026-09-26T10:07:00Z'));

    expect(history.importForAccount).toHaveBeenCalledWith('u1', 'a1', { months: 1 });
    expect(sync.sync).not.toHaveBeenCalled(); // la séance reste au WebSocket
    expect(r).toMatchObject({ live: 1, created: 5, synced: 0 });
  });

  it('app ouverte HORS passage horaire → rien du tout', async () => {
    const { cron, sync, history } = setup([{ id: 'c1', userId: 'u1', accountId: 'a1' }], ['u1']);
    const r = await cron.refreshStale(new Date('2026-09-26T10:37:00Z'));
    expect(history.importForAccount).not.toHaveBeenCalled();
    expect(sync.sync).not.toHaveBeenCalled();
    expect(r.live).toBe(1);
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
    // Hors passage horaire : le filtre de fraîcheur s'applique.
    const now = new Date('2026-09-12T12:22:00Z');
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

  it('au passage horaire, AUCUN filtre de fraîcheur : le mois doit atteindre tout le monde', async () => {
    // Un utilisateur en direct a toujours une synchro récente ; le filtre l'exclurait donc
    // systématiquement du rattrapage mensuel, qui est précisément son seul filet.
    const { cron, prisma } = setup([]);
    await cron.refreshStale(new Date('2026-09-12T12:00:00Z'));
    const where = (prisma.brokerConnection.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where['OR']).toBeUndefined();
  });

  it('un échec n’arrête pas les suivantes', async () => {
    const { cron, sync } = setup([
      { id: 'c1', userId: 'u1', accountId: 'a1' },
      { id: 'c2', userId: 'u2', accountId: 'a2' },
    ]);
    sync.sync.mockRejectedValueOnce(new Error('Tradovate indisponible'));
    expect(await cron.refreshStale(new Date('2026-09-26T10:37:00Z'))).toMatchObject({
      synced: 1,
      failed: 1,
    });
  });

  /**
   * Le rattrapage du passé complet vit ICI et nulle part ailleurs : c'est le seul chemin où
   * personne n'attend une réponse. Mesuré le 2026-09-26 : 24 fenêtres = 11 s d'appels, avant
   * l'écriture en base. Dans le bouton « Synchroniser », ce serait un clic de 30 s.
   */
  describe('passé complet des connexions qui ne l’ont jamais eu', () => {
    const jamais = (id: string, userId: string) => ({
      id, userId, accountId: `a-${id}`, historyImportedAt: null,
    });

    it('au passage horaire → remonte tout le passé, et pas seulement le mois', async () => {
      const { cron, history, sync } = setup([jamais('c1', 'u1')]);

      const r = await cron.refreshStale(new Date('2026-09-26T10:07:00Z'));

      // `{}` = profondeur pleine, bornée par la date de création du compte.
      expect(history.importForAccount).toHaveBeenCalledWith('u1', 'a-c1', {});
      // Le mois n'est pas tiré en double : il est déjà dans le passé complet.
      expect(sync.sync).toHaveBeenCalledWith('u1', 'a-c1', { history: false });
      expect(r.backfilled).toBe(1);
    });

    it('hors passage horaire → on ne tire aucun rapport, la séance suffit', async () => {
      const { cron, history, sync } = setup([jamais('c1', 'u1')]);

      const r = await cron.refreshStale(new Date('2026-09-26T10:37:00Z'));

      expect(history.importForAccount).not.toHaveBeenCalled();
      expect(sync.sync).toHaveBeenCalledWith('u1', 'a-c1', { history: false });
      expect(r.backfilled).toBe(0);
    });

    it('app ouverte → le passé remonte quand même, sans refaire la séance', async () => {
      const { cron, history, sync } = setup([jamais('c1', 'u1')], ['u1']);

      const r = await cron.refreshStale(new Date('2026-09-26T10:07:00Z'));

      expect(history.importForAccount).toHaveBeenCalledWith('u1', 'a-c1', {});
      expect(sync.sync).not.toHaveBeenCalled();
      expect(r).toMatchObject({ live: 1, backfilled: 1 });
    });

    it('plafonné par passage : le reste attend l’heure suivante', async () => {
      // Sans plafond, un déploiement qui trouve 30 connexions à rattraper empilerait 30 imports
      // dans un seul passage et chevaucherait le suivant, 15 min plus tard.
      const conns = Array.from({ length: FULL_BACKFILLS_PER_PASS + 3 }, (_, i) =>
        jamais(`c${i}`, `u${i}`),
      );
      const { cron, history } = setup(conns);

      const r = await cron.refreshStale(new Date('2026-09-26T10:07:00Z'));

      expect(r.backfilled).toBe(FULL_BACKFILLS_PER_PASS);
      // Les autres reçoivent le rattrapage mensuel habituel, pas la profondeur pleine.
      const pleines = history.importForAccount.mock.calls.filter(
        (c: unknown[]) => Object.keys(c[2] as object).length === 0,
      );
      expect(pleines).toHaveLength(FULL_BACKFILLS_PER_PASS);
    });

    it('connexion dont le passé est déjà remonté → jamais deux fois', async () => {
      const { cron, history } = setup([{ id: 'c1', userId: 'u1', accountId: 'a1' }]);

      const r = await cron.refreshStale(new Date('2026-09-26T10:07:00Z'));

      expect(r.backfilled).toBe(0);
      expect(history.importForAccount).not.toHaveBeenCalled(); // passe par la synchro + mois
    });
  });

  it('intégration non configurée sur l’environnement → rien', async () => {
    const { cron, connections, prisma } = setup([{ id: 'c1', userId: 'u1', accountId: 'a1' }]);
    connections.assertConfigured.mockImplementation(() => { throw new Error('non configuré'); });
    expect(await cron.refreshStale()).toEqual({
      synced: 0, created: 0, live: 0, failed: 0, backfilled: 0,
    });
    expect(prisma.brokerConnection.findMany).not.toHaveBeenCalled();
  });

  describe('passages et parallélisme (SCA-B5-03)', () => {
    it('passage précédent encore en cours → celui-ci est sauté', async () => {
      const { cron, sync, store } = setup([{ id: 'c1', userId: 'u1', accountId: 'a1' }]);
      store.set(BACKGROUND_LOCK_KEY, 'autre-passage');
      await cron.scheduledRefresh();
      expect(sync.sync).not.toHaveBeenCalled();
    });

    it('verrou pris pendant le passage, rendu à la fin (même en cas d’échec)', async () => {
      const { cron, store, sync } = setup([{ id: 'c1', userId: 'u1', accountId: 'a1' }]);
      sync.sync.mockImplementation(async () => {
        expect(store.has(BACKGROUND_LOCK_KEY)).toBe(true);
        throw new Error('Tradovate en panne');
      });
      await cron.scheduledRefresh();
      expect(sync.sync).toHaveBeenCalled();
      expect(store.has(BACKGROUND_LOCK_KEY)).toBe(false);
    });

    it('Redis indisponible → le passage tourne quand même', async () => {
      const { cron, sync, redis } = setup([{ id: 'c1', userId: 'u1', accountId: 'a1' }]);
      redis.client.set.mockRejectedValue(new Error('down'));
      redis.client.eval.mockRejectedValue(new Error('down'));
      await cron.scheduledRefresh();
      expect(sync.sync).toHaveBeenCalled();
    });

    it(`utilisateurs en parallèle (${BACKGROUND_USER_CONCURRENCY} max), connexions d’un même utilisateur l’une après l’autre`, async () => {
      const conns = [
        ...Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, userId: `u${i}`, accountId: `a${i}` })),
        { id: 'c-bis', userId: 'u0', accountId: 'a-bis' }, // 2e compte de u0, même login Tradovate
      ];
      const { cron, sync } = setup(conns);
      let running = 0;
      let peak = 0;
      const perUser = new Map<string, number>();
      let sameUserOverlap = false;
      sync.sync.mockImplementation(async (userId: string) => {
        peak = Math.max(peak, ++running);
        perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
        if (perUser.get(userId)! > 1) sameUserOverlap = true;
        await new Promise((r) => setTimeout(r, 5));
        perUser.set(userId, perUser.get(userId)! - 1);
        running--;
        return { created: 0, duplicates: 0, failed: 0, total: 0 };
      });

      const r = await cron.refreshStale(new Date('2026-09-26T10:37:00Z'));

      expect(r.synced).toBe(9);
      expect(peak).toBe(BACKGROUND_USER_CONCURRENCY);
      expect(sameUserOverlap).toBe(false);
    });
  });
});
