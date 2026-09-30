import { describe, it, expect } from 'vitest';
import { dbPoolConfig } from './pool-config';

describe('dbPoolConfig — pool Postgres borné', () => {
  it('défaut : 5 connexions par process, délais bornés', () => {
    expect(dbPoolConfig({ DATABASE_URL: 'postgresql://x' })).toMatchObject({
      connectionString: 'postgresql://x',
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      query_timeout: 15_000,
    });
  });

  it('DB_POOL_MAX respecté ; valeur invalide → défaut', () => {
    expect(dbPoolConfig({ DB_POOL_MAX: '8' }).max).toBe(8);
    expect(dbPoolConfig({ DB_POOL_MAX: '0' }).max).toBe(5);
    expect(dbPoolConfig({ DB_POOL_MAX: 'x' }).max).toBe(5);
  });

  it('jamais de statement_timeout : PgBouncer refuserait la connexion (paramètre de démarrage)', () => {
    expect(dbPoolConfig({})).not.toHaveProperty('statement_timeout');
    expect(dbPoolConfig({})).not.toHaveProperty('options');
  });
});
