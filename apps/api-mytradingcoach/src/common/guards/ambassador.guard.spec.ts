import { describe, it, expect } from 'vitest';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { AmbassadorGuard } from './ambassador.guard';

const makeContext = (user: object | null): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

// Garde l'accès au relevé de commissions (POST /referral/ambassador/statement).
describe('AmbassadorGuard', () => {
  const guard = new AmbassadorGuard();

  it('AMBASSADOR → autorisé', () => {
    expect(guard.canActivate(makeContext({ role: 'AMBASSADOR' }))).toBe(true);
  });

  it('ADMIN → autorisé', () => {
    expect(guard.canActivate(makeContext({ role: 'ADMIN' }))).toBe(true);
  });

  it('USER → ForbiddenException', () => {
    expect(() => guard.canActivate(makeContext({ role: 'USER' }))).toThrow(ForbiddenException);
  });

  it('user absent → ForbiddenException', () => {
    expect(() => guard.canActivate(makeContext(null))).toThrow(ForbiddenException);
  });
});
