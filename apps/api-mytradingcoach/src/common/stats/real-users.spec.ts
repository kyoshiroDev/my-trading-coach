import { describe, it, expect } from 'vitest';
import { REAL_USERS_WHERE, realUsersSql } from './real-users';

describe('comptes réels des statistiques (#828)', () => {
  it('Prisma : hors démo et hors ADMIN', () => {
    expect(REAL_USERS_WHERE).toEqual({ isDemo: false, role: { not: 'ADMIN' } });
  });

  it('SQL brut : même filtre, avec ou sans alias, sans paramètre', () => {
    expect(realUsersSql().sql).toBe(`"isDemo" = false AND "role" <> 'ADMIN'`);
    expect(realUsersSql('u').sql).toBe(`u."isDemo" = false AND u."role" <> 'ADMIN'`);
    expect(realUsersSql('u').values).toEqual([]);
  });
});
