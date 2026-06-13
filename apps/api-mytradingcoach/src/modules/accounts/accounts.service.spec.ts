import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { PremiumGuard } from '../../common/guards/premium.guard';

// Le AccountsController est gardé par @UseGuards(JwtAuthGuard, PremiumGuard).
// On prouve ici que le gating Premium rejette bien un non-Premium (403).
const ctxWith = (user: unknown): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as ExecutionContext;

describe('AccountsController — gating Premium', () => {
  const guard = new PremiumGuard();

  it('user FREE (non Premium, hors trial) → 403', () => {
    expect(() =>
      guard.canActivate(ctxWith({ plan: 'FREE', role: 'USER', trialEndsAt: null })),
    ).toThrow(ForbiddenException);
  });

  it('user PREMIUM → autorisé', () => {
    expect(
      guard.canActivate(ctxWith({ plan: 'PREMIUM', role: 'USER' })),
    ).toBe(true);
  });
});

function makePrisma() {
  return {
    tradingAccount: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    trade: { count: vi.fn() },
    tradeSession: { count: vi.fn() },
  };
}

describe('AccountsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: AccountsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new AccountsService(prisma as never);
  });

  it('create — rattache le userId du JWT', async () => {
    prisma.tradingAccount.create.mockResolvedValue({ id: 'a1' });
    await svc.create('u1', { label: 'Apex 50k' } as never);
    expect(prisma.tradingAccount.create).toHaveBeenCalledWith({
      data: { userId: 'u1', label: 'Apex 50k' },
    });
  });

  it('list — scope user + actifs avant archivés', async () => {
    prisma.tradingAccount.findMany.mockResolvedValue([]);
    await svc.list('u1');
    expect(prisma.tradingAccount.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('update — compte d\'un autre user → 404 (pas de fuite)', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'autre' });
    await expect(svc.update('u1', 'a1', { label: 'x' } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.tradingAccount.update).not.toHaveBeenCalled();
  });

  it('delete — compte VIDE → suppression dure', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'ACTIVE' });
    prisma.trade.count.mockResolvedValue(0);
    prisma.tradeSession.count.mockResolvedValue(0);
    const res = await svc.remove('u1', 'a1');
    expect(res).toEqual({ deleted: true });
    expect(prisma.tradingAccount.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });

  it('delete — compte AVEC historique (pas le dernier actif) → archivage', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'ACTIVE' });
    prisma.trade.count.mockResolvedValue(12);
    prisma.tradeSession.count.mockResolvedValue(0);
    prisma.tradingAccount.count.mockResolvedValue(2); // 2 comptes actifs
    const res = await svc.remove('u1', 'a1');
    expect(res).toEqual({ archived: true });
    expect(prisma.tradingAccount.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'ARCHIVED' },
    });
    expect(prisma.tradingAccount.delete).not.toHaveBeenCalled();
  });

  it('delete — DERNIER compte actif avec historique → refus (400)', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'ACTIVE' });
    prisma.trade.count.mockResolvedValue(5);
    prisma.tradeSession.count.mockResolvedValue(0);
    prisma.tradingAccount.count.mockResolvedValue(1); // seul compte actif
    await expect(svc.remove('u1', 'a1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tradingAccount.update).not.toHaveBeenCalled();
  });

  it('delete — compte d\'un autre user → 404', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'autre', status: 'ACTIVE' });
    await expect(svc.remove('u1', 'a1')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('accountWhere — filtre lecture (rétrocompatible + ownership)', () => {
    it('absent → fragment vide (agrégé, comportement actuel)', async () => {
      expect(await svc.accountWhere('u1', undefined)).toEqual({});
      expect(prisma.tradingAccount.findUnique).not.toHaveBeenCalled();
    });

    it("'all' → fragment vide", async () => {
      expect(await svc.accountWhere('u1', 'all')).toEqual({});
    });

    it('compte du user → { accountId }', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ userId: 'u1' });
      expect(await svc.accountWhere('u1', 'a1')).toEqual({ accountId: 'a1' });
    });

    it('compte d\'un autre user → 404 (refusé)', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ userId: 'autre' });
      await expect(svc.accountWhere('u1', 'a1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('ensureDefaultAccountId — défaut anti-NULL', () => {
    it('« Compte principal » actif existe → renvoie son id', async () => {
      prisma.tradingAccount.findFirst.mockResolvedValueOnce({ id: 'principal' });
      expect(await svc.ensureDefaultAccountId('u1')).toBe('principal');
      expect(prisma.tradingAccount.create).not.toHaveBeenCalled();
    });

    it('pas de principal mais un compte actif récent → renvoie le récent', async () => {
      prisma.tradingAccount.findFirst
        .mockResolvedValueOnce(null) // pas de Compte principal
        .mockResolvedValueOnce({ id: 'recent' }); // actif le plus récent
      expect(await svc.ensureDefaultAccountId('u1')).toBe('recent');
      expect(prisma.tradingAccount.create).not.toHaveBeenCalled();
    });

    it('aucun compte actif → crée le « Compte principal » (jamais NULL)', async () => {
      prisma.tradingAccount.findFirst.mockResolvedValue(null);
      prisma.tradingAccount.create.mockResolvedValue({ id: 'created' });
      expect(await svc.ensureDefaultAccountId('u1')).toBe('created');
      expect(prisma.tradingAccount.create).toHaveBeenCalledWith({
        data: { userId: 'u1', label: 'Compte principal' },
        select: { id: true },
      });
    });
  });

  describe('computeRuleMetrics — règles prop firm estimées', () => {
    const t = (pnl: number, day: number) => ({ pnl, tradedAt: new Date(2026, 5, day) });
    // Trades : +1000, +2000, -500 → realizedPnl 2500, currentBalance 52500.
    const trades = [t(1000, 1), t(2000, 2), t(-500, 3)];

    it('STATIC : plancher = startingBalance - maxDrawdown, objectif & marge corrects', () => {
      const m = svc.computeRuleMetrics(
        { startingBalance: 50000, accountSize: null, profitTarget: 3000, maxDrawdown: 2000, drawdownType: 'STATIC' },
        trades,
      );
      expect(m.realizedPnl).toBe(2500);
      expect(m.currentBalance).toBe(52500);
      expect(m.objective).toEqual({ current: 2500, target: 3000, pct: expect.closeTo(0.8333, 3) });
      expect(m.drawdown?.floor).toBe(48000); // 50000 - 2000
      expect(m.drawdown?.margin).toBe(4500); // 52500 - 48000
      expect(m.drawdown?.breached).toBe(false);
      expect(m.estimated).toBe(true);
      expect(m.disclaimer).toContain('Estimation basée uniquement sur les trades loggés');
    });

    it('TRAILING : plancher = hwm - maxDrawdown (différent de STATIC)', () => {
      const m = svc.computeRuleMetrics(
        { startingBalance: 50000, accountSize: null, profitTarget: null, maxDrawdown: 2000, drawdownType: 'TRAILING' },
        trades,
      );
      // soldes cumulés : 51000, 53000, 52500 → hwm 53000 → floor 51000.
      expect(m.drawdown?.floor).toBe(51000);
      expect(m.drawdown?.margin).toBe(1500); // 52500 - 51000
      expect(m.drawdown?.pct).toBeCloseTo(0.75, 3);
      expect(m.objective).toBeNull(); // pas de profitTarget
    });

    it('TRAILING : drawdown dépassé → breached true, pct 0', () => {
      const m = svc.computeRuleMetrics(
        { startingBalance: 50000, accountSize: null, profitTarget: null, maxDrawdown: 2000, drawdownType: 'TRAILING' },
        [t(3000, 1), t(-2500, 2)], // hwm 53000, currentBalance 50500, floor 51000 → margin -500
      );
      expect(m.drawdown?.breached).toBe(true);
      expect(m.drawdown?.pct).toBe(0);
    });

    it('sans règles (maxDrawdown null) → drawdown null, startingBalance via accountSize', () => {
      const m = svc.computeRuleMetrics(
        { startingBalance: null, accountSize: 10000, profitTarget: null, maxDrawdown: null, drawdownType: 'STATIC' },
        [t(500, 1)],
      );
      expect(m.startingBalance).toBe(10000);
      expect(m.currentBalance).toBe(10500);
      expect(m.drawdown).toBeNull();
    });
  });
});
