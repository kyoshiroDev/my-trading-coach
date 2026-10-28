import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { FreeLimitSyncService } from './free-limit-sync.service';
import { TradovateSyncService } from './tradovate-sync.service';
import { TradovateHistoryService } from './tradovate-history.service';

// Synchro des comptes au-delà de la limite gratuite (#769, B0) : MODE JOURNAL SEUL. Compté une fois
// par compte et par jour, journalisé sans identifiant, jamais bloquant.

const NOW = new Date('2026-11-03T15:00:00Z');
const OLD = new Date('2026-09-01T10:00:00Z');
const NEW = new Date('2026-10-20T10:00:00Z');
const accounts = [
  { id: 'acc-ancien', status: 'ACTIVE', createdAt: OLD },
  { id: 'acc-recent', status: 'ACTIVE', createdAt: NEW },
  { id: 'acc-archive', status: 'ARCHIVED', createdAt: NEW },
];
const freeUser = (over: object = {}) => ({
  plan: 'FREE', role: 'USER', trialEndsAt: null, isDemo: false, keptAccountId: null, tradingAccounts: accounts, ...over,
});

function setup(user: object | null) {
  const sets = new Map<string, Set<string>>();
  const client = {
    sadd: vi.fn(async (k: string, m: string) => {
      const s = sets.get(k) ?? new Set<string>();
      const before = s.size;
      s.add(m);
      sets.set(k, s);
      return s.size - before;
    }),
    expire: vi.fn(async () => 1),
    scard: vi.fn(async (k: string) => sets.get(k)?.size ?? 0),
  };
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user) } };
  const svc = new FreeLimitSyncService(prisma as never, { client } as never);
  return { svc, client, prisma };
}

describe('FreeLimitSyncService (#769, B0, journal seul)', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => void logs.push(String(m)));
  });

  it('compte gratuit à 2 comptes actifs : le plus récent serait ignoré, le compte gardé jamais', async () => {
    const { svc } = setup(freeUser());
    expect(await svc.observe('u1', 'acc-recent', 'synchro', NOW)).toBe(true);
    expect(await svc.observe('u1', 'acc-ancien', 'synchro', NOW)).toBe(false);
    expect(await svc.observe('u1', 'acc-archive', 'synchro', NOW)).toBe(false); // archivé : pas synchronisé de toute façon
  });

  it('compte gardé choisi par l’utilisateur : c’est l’autre qui serait ignoré', async () => {
    const { svc } = setup(freeUser({ keptAccountId: 'acc-recent' }));
    expect(await svc.observe('u1', 'acc-recent', 'synchro', NOW)).toBe(false);
    expect(await svc.observe('u1', 'acc-ancien', 'synchro', NOW)).toBe(true);
  });

  it.each([
    ['abonné Premium', { plan: 'PREMIUM' }],
    ['essai ou Premium offert en cours', { trialEndsAt: new Date(NOW.getTime() + 86_400_000) }],
    ['bêta-testeur', { role: 'BETA_TESTER' }],
    ['admin', { role: 'ADMIN' }],
    ['compte démo', { isDemo: true }],
  ])('%s : jamais concerné', async (_l, over) => {
    const { svc, client } = setup(freeUser(over));
    expect(await svc.observe('u1', 'acc-recent', 'synchro', NOW)).toBe(false);
    expect(client.sadd).not.toHaveBeenCalled();
  });

  it('compté une fois par compte et par jour, journal sans identifiant, décompte du jour', async () => {
    const { svc } = setup(freeUser());
    await svc.observe('u1', 'acc-recent', 'synchro', NOW);
    await svc.observe('u1', 'acc-recent', 'historique', NOW);
    expect(logs).toEqual(["Synchro d'un compte au-delà de la limite gratuite (journal seul, synchro) : serait ignorée"]);
    expect(await svc.countToday(NOW)).toBe(1);
    expect(logs.join(' ')).not.toMatch(/u1|acc-/);
  });

  it('erreur (base ou Redis) : jamais bloquant, nom de l’erreur seulement', async () => {
    const { svc, prisma } = setup(freeUser());
    prisma.user.findUnique.mockRejectedValueOnce(new Error('connexion perdue vers u1'));
    expect(await svc.observe('u1', 'acc-recent', 'synchro', NOW)).toBe(false);
    expect(logs).toEqual(['Limite gratuite de la synchro non évaluée (Error)']);
  });
});

describe('TradovateSyncService.sync : journal seul, la synchro continue (#769, B0)', () => {
  it('compte au-delà de la limite : observé, puis la synchro suit son cours', async () => {
    const freeLimit = { observe: vi.fn().mockResolvedValue(true) };
    const connections = {
      assertConfigured: vi.fn(),
      getConnection: vi.fn().mockResolvedValue({ id: 'c1', externalAccountId: 'x', externalEnv: 'demo' }),
      // Verrou refusé : preuve que la synchro est allée AU-DELÀ du contrôle de la limite.
      tryLock: vi.fn().mockResolvedValue(false),
    };
    const svc = new TradovateSyncService(
      {} as never, {} as never, connections as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      freeLimit as never,
    );
    await expect(svc.sync('u1', 'acc-recent')).rejects.toMatchObject({ code: 'TRADOVATE_SYNC_IN_PROGRESS' });
    expect(freeLimit.observe).toHaveBeenCalledWith('u1', 'acc-recent', 'synchro');
    expect(connections.tryLock).toHaveBeenCalled();
  });
});

describe('TradovateHistoryService.importHistory : journal seul, l’import continue (#769, B0)', () => {
  it('compte au-delà de la limite : observé (source historique), puis l’import suit son cours', async () => {
    const freeLimit = { observe: vi.fn().mockResolvedValue(true) };
    const connections = { getSession: vi.fn().mockRejectedValue(new Error('arrêt du test après le contrôle')) };
    const svc = new TradovateHistoryService(
      {} as never, {} as never, connections as never, {} as never, {} as never, {} as never, freeLimit as never,
    );
    const conn = { id: 'c1', accountId: 'acc-recent', externalAccountId: 'x', externalEnv: 'demo' };
    await expect(svc.importHistory('u1', conn as never)).rejects.toThrow('arrêt du test après le contrôle');
    expect(freeLimit.observe).toHaveBeenCalledWith('u1', 'acc-recent', 'historique');
    expect(connections.getSession).toHaveBeenCalled();
  });
});
