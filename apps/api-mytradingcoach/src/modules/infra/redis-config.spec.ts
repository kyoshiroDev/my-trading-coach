import { describe, it, expect, vi } from 'vitest';
import { bullPrefix, redisSettings, socketIoKey } from './redis-config';
import { RedisService } from './redis.service';

const env = (vars: Record<string, string>) => (name: string) => vars[name];

describe('redisSettings — isolation Redis par environnement', () => {
  it('sans variables : base 0, aucun préfixe, file `bull`, canal `socket.io` (comportement d’avant)', () => {
    const s = redisSettings(env({ REDIS_HOST: 'mtc_redis' }));
    expect(s).toMatchObject({ host: 'mtc_redis', port: 6379, db: 0, prefix: '' });
    expect(bullPrefix(s)).toBe('bull');
    expect(socketIoKey(s)).toBe('socket.io');
  });

  it('dev : base et préfixe propres, file et canal distincts de la prod', () => {
    const s = redisSettings(env({ REDIS_HOST: 'mtc_redis', REDIS_DB: '1', REDIS_PREFIX: 'dev:' }));
    expect(s).toMatchObject({ db: 1, prefix: 'dev:' });
    expect(bullPrefix(s)).toBe('dev:bull');
    expect(socketIoKey(s)).toBe('dev:socket.io:db1');
  });

  it('base seule, sans préfixe : le canal pub/sub (global à Redis) porte quand même la base', () => {
    expect(socketIoKey(redisSettings(env({ REDIS_DB: '2' })))).toBe('socket.io:db2');
  });

  it('REDIS_DB invalide → base 0 plutôt qu’un crash', () => {
    expect(redisSettings(env({ REDIS_DB: 'abc' })).db).toBe(0);
    expect(redisSettings(env({ REDIS_DB: '-1' })).db).toBe(0);
  });
});

describe('RedisService.scanKeys — remplace KEYS, gère le préfixe', () => {
  function serviceWith(prefix: string, pages: [string, string[]][]) {
    const config = { get: (k: string) => ({ REDIS_PREFIX: prefix } as Record<string, string>)[k] };
    const svc = new RedisService(config as never);
    const scan = vi.fn();
    for (const p of pages) scan.mockResolvedValueOnce(p);
    (svc as unknown as { client: { scan: typeof scan } }).client = { scan } as never;
    return { svc, scan };
  }

  it('ajoute le préfixe au motif, le retire des clés, suit le curseur jusqu’à 0', async () => {
    const { svc, scan } = serviceWith('dev:', [
      ['17', ['dev:analytics:u1:a']],
      ['0', ['dev:analytics:u1:b']],
    ]);
    expect(await svc.scanKeys('analytics:u1:*')).toEqual(['analytics:u1:a', 'analytics:u1:b']);
    expect(scan).toHaveBeenNthCalledWith(1, '0', 'MATCH', 'dev:analytics:u1:*', 'COUNT', 500);
    expect(scan).toHaveBeenNthCalledWith(2, '17', 'MATCH', 'dev:analytics:u1:*', 'COUNT', 500);
  });

  it('sans préfixe : clés renvoyées telles quelles', async () => {
    const { svc } = serviceWith('', [['0', ['analytics:u1:a']]]);
    expect(await svc.scanKeys('analytics:u1:*')).toEqual(['analytics:u1:a']);
  });
});
