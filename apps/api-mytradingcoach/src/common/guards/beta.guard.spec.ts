import { describe, it, expect } from 'vitest';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { BetaGuard } from './beta.guard';

const makeContext = (user: object | null): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('BetaGuard', () => {
  const guard = new BetaGuard();

  it('BETA_TESTER → autorisé', () => {
    const ctx = makeContext({ role: 'BETA_TESTER' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('ADMIN → autorisé', () => {
    const ctx = makeContext({ role: 'ADMIN' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('USER → ForbiddenException avec code BETA_ONLY', () => {
    const ctx = makeContext({ role: 'USER' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('PREMIUM (plan) avec rôle USER → ForbiddenException', () => {
    const ctx = makeContext({ role: 'USER', plan: 'PREMIUM' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('user absent → ForbiddenException', () => {
    const ctx = makeContext(null);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
