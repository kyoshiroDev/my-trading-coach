import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PremiumGuard } from './premium.guard';

const makeContext = (user: object | null): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  }) as unknown as ExecutionContext;

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

describe('PremiumGuard', () => {
  const guard = new PremiumGuard();

  describe('utilisateurs PREMIUM', () => {
    it('autorise les utilisateurs avec plan PREMIUM', () => {
      const ctx = makeContext({ plan: Plan.PREMIUM, trialEndsAt: null, trialUsed: false });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('utilisateurs FREE', () => {
    it('bloque les utilisateurs FREE sans trial', () => {
      const ctx = makeContext({ plan: Plan.FREE, trialEndsAt: null, trialUsed: false });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('retourne trialAvailable: true si trial non utilisé', () => {
      const ctx = makeContext({ plan: Plan.FREE, trialEndsAt: null, trialUsed: false });
      try {
        guard.canActivate(ctx);
      } catch (e: any) {
        expect(e.response?.trialAvailable).toBe(true);
      }
    });

    it('retourne trialAvailable: false si trial déjà utilisé', () => {
      const ctx = makeContext({ plan: Plan.FREE, trialEndsAt: null, trialUsed: true });
      try {
        guard.canActivate(ctx);
      } catch (e: any) {
        expect(e.response?.trialAvailable).toBe(false);
      }
    });
  });

  describe('trial', () => {
    it('autorise si trial encore valide', () => {
      const ctx = makeContext({
        plan: Plan.FREE,
        trialEndsAt: addDays(new Date(), 3),
        trialUsed: true,
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('bloque si trial expiré hier', () => {
      const ctx = makeContext({
        plan: Plan.FREE,
        trialEndsAt: addDays(new Date(), -1),
        trialUsed: true,
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('bloque si trial expire exactement maintenant (passé)', () => {
      const expiredDate = new Date(Date.now() - 1000); // 1 seconde dans le passé
      const ctx = makeContext({
        plan: Plan.FREE,
        trialEndsAt: expiredDate,
        trialUsed: true,
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('user absent', () => {
    it('bloque si user est null (non authentifié)', () => {
      const ctx = makeContext(null);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('retourne trialAvailable: true si user absent (pas encore de compte)', () => {
      const ctx = makeContext(null);
      try {
        guard.canActivate(ctx);
      } catch (e: any) {
        expect(e.response?.code).toBe('PREMIUM_REQUIRED');
        expect(e.response?.trialAvailable).toBe(true);
      }
    });
  });
});
