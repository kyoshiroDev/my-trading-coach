import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

const makeContext = (user: object | null): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('ADMIN → autorisé', () => {
    const ctx = makeContext({ role: 'ADMIN' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('USER → ForbiddenException', () => {
    const ctx = makeContext({ role: 'USER' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('PREMIUM → ForbiddenException', () => {
    const ctx = makeContext({ role: 'USER', plan: 'PREMIUM' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('BETA_TESTER → ForbiddenException', () => {
    const ctx = makeContext({ role: 'BETA_TESTER' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('user absent → ForbiddenException', () => {
    const ctx = makeContext(null);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
