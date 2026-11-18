import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DemoSeedService, DEMO_RESEED_LOCK } from './demo-seed.service';

// Le seed réel est remplacé : on teste ici le verrou, la transaction et le cache autour de lui.
vi.mock('./demo-seed', async (orig) => ({
  ...(await orig<typeof import('./demo-seed')>()),
  seedDemo: vi.fn().mockResolvedValue({ trades: 1, accounts: 1, winRate: 0, grossPnl: 0, fees: 0, pnl: 0, redDays: 0, tradingDays: 1 }),
}));

function setup() {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'demo' }) },
  };
  const redis = {
    client: {
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      eval: vi.fn().mockResolvedValue(1),
    },
  };
  const service = new DemoSeedService(prisma as never, redis as never);
  return { service, prisma, redis };
}

/** B5 (#1066) : le re-seed du cron et de l'admin prenait la purge sans le verrou de la connexion démo. */
describe('DemoSeedService.run : sous verrou (B5 #1066)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prend le verrou avec un jeton propre, puis le rend seulement si c’est encore le sien', async () => {
    const { service, redis } = setup();
    await service.run('cron quotidien');
    expect(redis.client.set).toHaveBeenCalledWith(DEMO_RESEED_LOCK, expect.any(String), 'EX', expect.any(Number), 'NX');
    const token = redis.client.set.mock.calls[0][1];
    // Libération conditionnelle (comparaison du jeton côté Redis), jamais un DEL aveugle : un seed
    // plus long que le TTL ne doit pas libérer le verrou pris entre-temps par un autre.
    expect(redis.client.del).not.toHaveBeenCalled();
    expect(redis.client.eval).toHaveBeenCalledWith(expect.stringContaining('get'), 1, DEMO_RESEED_LOCK, token);
  });

  it('verrou déjà pris (connexion démo, autre worker) : 409, aucune purge', async () => {
    const { service, redis } = setup();
    redis.client.set.mockResolvedValueOnce(null);
    const { seedDemo } = await import('./demo-seed');
    await expect(service.run('admin')).rejects.toBeInstanceOf(ConflictException);
    expect(seedDemo).not.toHaveBeenCalled();
    expect(redis.client.eval).not.toHaveBeenCalled();
  });

  it('seed en échec : le verrou est quand même rendu', async () => {
    const { service, redis } = setup();
    const { seedDemo } = await import('./demo-seed');
    vi.mocked(seedDemo).mockRejectedValueOnce(new Error('base indisponible'));
    await expect(service.run('admin')).rejects.toThrow('base indisponible');
    expect(redis.client.eval).toHaveBeenCalledOnce();
  });
});

describe('DemoSeedCron : re-seed déjà en cours (B5 #1066)', () => {
  it('verrou pris : le cron passe son tour sans erreur ; une autre erreur remonte', async () => {
    const { DemoSeedCron } = await import('./demo-seed.cron');
    const run = vi.fn().mockRejectedValueOnce(new ConflictException('en cours')).mockRejectedValueOnce(new Error('base'));
    const cron = new DemoSeedCron({ run } as never);
    await expect(cron.scheduledReseed()).resolves.toBeUndefined();
    await expect(cron.scheduledReseed()).rejects.toThrow('base');
  });
});
