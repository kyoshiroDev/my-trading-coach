import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import { PresenceInterceptor } from './presence.interceptor';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../modules/infra/redis.service';

/** Redis partagé (comme entre les workers) : SET NX EX. */
function sharedRedis() {
  const keys = new Set<string>();
  const set = vi.fn(async (k: string) => (keys.has(k) ? null : (keys.add(k), 'OK')));
  return { keys, set, redis: { client: { set } } as unknown as RedisService };
}
const ctx = (user?: { id?: string; isDemo?: boolean }) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;
const next: CallHandler = { handle: () => of(null) };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('PresenceInterceptor (SCA-B3-02)', () => {
  let update: ReturnType<typeof vi.fn>;
  let prisma: PrismaService;
  beforeEach(() => {
    update = vi.fn().mockResolvedValue({});
    prisma = { user: { update } } as unknown as PrismaService;
  });

  it('3 workers, 30 requêtes du même utilisateur dans la minute → 1 seule écriture en base', async () => {
    const r = sharedRedis();
    const workers = [0, 1, 2].map(() => new PresenceInterceptor(prisma, r.redis));
    for (let i = 0; i < 30; i++) workers[i % 3].intercept(ctx({ id: 'u1' }), next);
    await flush();
    expect(update).toHaveBeenCalledTimes(1);
    expect(r.set).toHaveBeenCalledTimes(3); // filtre local : 1 appel Redis par worker, pas 30
  });

  it('utilisateurs distincts : une écriture chacun', async () => {
    const r = sharedRedis();
    const w = new PresenceInterceptor(prisma, r.redis);
    w.intercept(ctx({ id: 'a' }), next);
    w.intercept(ctx({ id: 'b' }), next);
    await flush();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('compte démo et requête anonyme : rien', async () => {
    const r = sharedRedis();
    const w = new PresenceInterceptor(prisma, r.redis);
    w.intercept(ctx({ id: 'demo', isDemo: true }), next);
    w.intercept(ctx(undefined), next);
    await flush();
    expect(update).not.toHaveBeenCalled();
    expect(r.set).not.toHaveBeenCalled();
  });

  it('Redis en panne : écriture quand même (limitée par le filtre local), aucune erreur', async () => {
    const redis = { client: { set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) } } as unknown as RedisService;
    const w = new PresenceInterceptor(prisma, redis);
    w.intercept(ctx({ id: 'u1' }), next);
    w.intercept(ctx({ id: 'u1' }), next);
    await flush();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('base en échec : avalé, la requête n’est jamais impactée', async () => {
    update.mockRejectedValue(new Error('pool exhausted'));
    const w = new PresenceInterceptor(prisma, sharedRedis().redis);
    await expect(w.touch('u1')).resolves.toBeUndefined();
  });
});
