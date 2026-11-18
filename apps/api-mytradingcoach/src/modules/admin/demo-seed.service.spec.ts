import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DemoSeedService, DEMO_RESEED_LOCK } from './demo-seed.service';

/** Fraîcheur de la démo, indépendante des crons (dev tourne sans cron). */
// `open` : position ouverte (pnl null) en base, par défaut datée comme le dernier trade.
function setup(lastTrade: Date | null, user = true, live = true, open: Date | null = lastTrade) {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user ? { id: 'demo' } : null) },
    tradeSession: { findFirst: vi.fn().mockResolvedValue(live ? { id: 'live' } : null) },
    trade: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: { pnl: unknown } }) => {
        const at = where.pnl === null ? open : lastTrade;
        return Promise.resolve(at ? { id: 't', tradedAt: at } : null);
      }),
    },
  };
  const redis = { client: { set: vi.fn().mockResolvedValue('OK'), eval: vi.fn().mockResolvedValue(1) } };
  const service = new DemoSeedService(prisma as never, redis as never);
  // Le seed lui-même (sous verrou) : `run` est réservé à l'admin et au cron (B5 #1066).
  const run = vi.spyOn(service as unknown as { seed(reason: string): Promise<unknown> }, 'seed').mockResolvedValue({});
  return { service, redis, run };
}

describe('DemoSeedService.ensureFresh', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('démo du jour → aucun re-seed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:30:00')); // mardi, marché ouvert
    try {
      const { service, run } = setup(new Date('2026-10-06T10:20:00'));
      expect(await service.ensureFresh('test')).toBe(false);
      expect(run).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('démo périmée (dernier trade il y a des mois) → re-seed sous verrou, verrou rendu', async () => {
    const { service, run, redis } = setup(new Date('2026-06-07T08:00:00Z'));
    expect(await service.ensureFresh('connexion démo')).toBe(true);
    expect(redis.client.set).toHaveBeenCalledWith(DEMO_RESEED_LOCK, expect.any(String), 'EX', 120, 'NX');
    expect(run).toHaveBeenCalledWith('connexion démo');
    // Verrou rendu seulement s'il porte encore notre jeton (B5 #1066).
    expect(redis.client.eval).toHaveBeenCalledWith(expect.any(String), 1, DEMO_RESEED_LOCK, redis.client.set.mock.calls[0][1]);
  });

  it('démo absente → re-seed', async () => {
    const { service, run } = setup(null, false);
    expect(await service.ensureFresh('boot')).toBe(true);
    expect(run).toHaveBeenCalled();
  });

  it('verrou déjà pris (autre visiteur, cron) → la démo actuelle est servie, pas de second re-seed', async () => {
    const { service, run, redis } = setup(null);
    redis.client.set.mockResolvedValueOnce(null);
    expect(await service.ensureFresh('connexion démo')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('en semaine, marché ouvert : position ouverte de plus de 45 min → périmée, sinon servie telle quelle', async () => {
    const day = new Date('2026-10-06T00:00:00'); // mardi
    const at = (h: number, m = 0) => { const d = new Date(day); d.setHours(h, m, 0, 0); return d; };
    expect(await setup(at(10, 0)).service.isStale(at(10, 30))).toBe(false); // 30 min
    expect(await setup(at(10, 0)).service.isStale(at(10, 46))).toBe(true); // 46 min → recalée
    expect(await setup(at(2, 0)).service.isStale(at(18, 17))).toBe(true); // seed de la nuit
    expect(await setup(at(18, 11)).service.isStale(at(18, 17))).toBe(false);
    // Hors créneau (coupure de 23:00, tout début de journée) : la séance de la veille suffit.
    expect(await setup(at(22, 50)).service.isStale(at(23, 30))).toBe(false);
    expect(await setup(at(-2, -10)).service.isStale(at(0, 20)), 'veille 22:50, à 00:20').toBe(false);
  });

  it('en semaine, aucune session live pour la journée de trading en cours → re-seed', async () => {
    const { service } = setup(new Date('2026-10-06T10:20:00'), true, false);
    expect(await service.isStale(new Date('2026-10-06T10:30:00'))).toBe(true);
  });

  it('week-end (#977) : séance du vendredi clôturée, sans session live ni position ouverte → servie', async () => {
    const friday = new Date('2026-10-02T15:47:00');
    const sunday = new Date('2026-10-04T10:00:00');
    expect(await setup(friday, true, false, null).service.isStale(sunday)).toBe(false);
    expect(await setup(friday, true, false, null).service.isStale(new Date('2026-10-03T00:05:00')), 'samedi 00:05').toBe(false);
  });

  it('week-end : session ACTIVE ou position ouverte restée du vendredi soir → re-seed', async () => {
    const friday = new Date('2026-10-02T22:50:00');
    const saturday = new Date('2026-10-03T09:00:00');
    expect(await setup(friday, true, true, null).service.isStale(saturday), 'session ACTIVE').toBe(true);
    expect(await setup(friday, true, false, friday).service.isStale(saturday), 'position ouverte').toBe(true);
  });

  it('week-end : dernière séance plus ancienne que le vendredi → re-seed', async () => {
    const { service } = setup(new Date('2026-10-01T15:00:00'), true, false, null); // jeudi
    expect(await service.isStale(new Date('2026-10-04T10:00:00'))).toBe(true);
  });
});

