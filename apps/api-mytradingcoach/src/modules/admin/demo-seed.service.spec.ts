import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DemoSeedService, DEMO_RESEED_LOCK } from './demo-seed.service';

/** Fraîcheur de la démo, indépendante des crons (dev tourne sans cron). */
function setup(lastTrade: Date | null, user = true, live = true) {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user ? { id: 'demo' } : null) },
    tradeSession: { findFirst: vi.fn().mockResolvedValue(live ? { id: 'live' } : null) },
    trade: { findFirst: vi.fn().mockResolvedValue(lastTrade ? { tradedAt: lastTrade } : null) },
  };
  const redis = { client: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1) } };
  const service = new DemoSeedService(prisma as never, redis as never);
  const run = vi.spyOn(service, 'run').mockResolvedValue({} as never);
  return { service, redis, run };
}

describe('DemoSeedService.ensureFresh', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('démo du jour → aucun re-seed', async () => {
    const { service, run } = setup(new Date());
    expect(await service.ensureFresh('test')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('démo périmée (dernier trade il y a des mois) → re-seed sous verrou, verrou rendu', async () => {
    const { service, run, redis } = setup(new Date('2026-06-07T08:00:00Z'));
    expect(await service.ensureFresh('connexion démo')).toBe(true);
    expect(redis.client.set).toHaveBeenCalledWith(DEMO_RESEED_LOCK, '1', 'EX', 120, 'NX');
    expect(run).toHaveBeenCalledWith('connexion démo');
    expect(redis.client.del).toHaveBeenCalledWith(DEMO_RESEED_LOCK);
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

  it('aucune session live pour la journée de trading en cours (week-end, après minuit) → re-seed', async () => {
    const { service, run } = setup(new Date(), true, false);
    expect(await service.ensureFresh('connexion démo')).toBe(true);
    expect(run).toHaveBeenCalled();
  });

  it('week-end : un trade du vendredi suffit', async () => {
    const { service } = setup(new Date('2026-10-02T15:00:00')); // vendredi
    expect(await service.isStale(new Date('2026-10-04T10:00:00'))).toBe(false); // dimanche
  });
});

