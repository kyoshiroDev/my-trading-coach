import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';

// Le AccountsController n'est gardé que par JwtAuthGuard (PROMPT-169) : le multi-comptes
// est ouvert à FREE (1 compte) comme à PREMIUM (illimité) ; le plafond vit dans le service.

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
    user: { findUnique: vi.fn() },
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

  describe('ensureDefaultAccountId — compte par défaut hérite du capital profil', () => {
    it('crée « Compte principal » avec le startingBalance = capital du profil', async () => {
      prisma.tradingAccount.findFirst.mockResolvedValue(null); // pas de principal, pas de récent
      prisma.user.findUnique.mockResolvedValue({ startingCapital: 50000 });
      prisma.tradingAccount.create.mockResolvedValue({ id: 'a1' });

      const id = await svc.ensureDefaultAccountId('u1');

      expect(id).toBe('a1');
      expect(prisma.tradingAccount.create).toHaveBeenCalledWith({
        data: { userId: 'u1', label: 'Compte principal', startingBalance: 50000 },
        select: { id: true },
      });
    });

    it('capital profil à 0 → startingBalance null (pas de base factice)', async () => {
      prisma.tradingAccount.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ startingCapital: 0 });
      prisma.tradingAccount.create.mockResolvedValue({ id: 'a2' });

      await svc.ensureDefaultAccountId('u1');

      expect(prisma.tradingAccount.create).toHaveBeenCalledWith({
        data: { userId: 'u1', label: 'Compte principal', startingBalance: null },
        select: { id: true },
      });
    });

    it('« Compte principal » déjà présent → renvoie son id sans créer', async () => {
      prisma.tradingAccount.findFirst.mockResolvedValueOnce({ id: 'existing' });

      const id = await svc.ensureDefaultAccountId('u1');

      expect(id).toBe('existing');
      expect(prisma.tradingAccount.create).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resolveAccountLimit — quota par plan/rôle', () => {
    // Méthode privée : on la teste directement (entrées/sorties claires).
    const limit = (ctx: unknown) =>
      (svc as unknown as { resolveAccountLimit: (c?: unknown) => number | null }).resolveAccountLimit(ctx);

    it('FREE → 1', () => expect(limit({ plan: 'FREE', role: 'USER' })).toBe(1));
    it('PREMIUM → illimité (null)', () => expect(limit({ plan: 'PREMIUM', role: 'USER' })).toBeNull());
    it('trial actif (FREE + trialEndsAt futur) → illimité', () => {
      expect(limit({ plan: 'FREE', role: 'USER', trialEndsAt: new Date(Date.now() + 86_400_000) })).toBeNull();
    });
    it('trial expiré → retombe sur le plan (FREE → 1)', () => {
      expect(limit({ plan: 'FREE', role: 'USER', trialEndsAt: new Date(Date.now() - 86_400_000) })).toBe(1);
    });
    it('ADMIN → illimité', () => expect(limit({ plan: 'FREE', role: 'ADMIN' })).toBeNull());
    it('BETA_TESTER → illimité', () => expect(limit({ plan: 'FREE', role: 'BETA_TESTER' })).toBeNull());
    it('sans contexte (appel interne) → non plafonné (null)', () => expect(limit(undefined)).toBeNull());
  });

  describe('create — quota par plan', () => {
    const ctx = (plan: string, extra: Record<string, unknown> = {}) =>
      ({ plan, role: 'USER', ...extra }) as never;

    it('FREE sous le quota (0/1) → crée, ne compte que les comptes ACTIVE', async () => {
      prisma.tradingAccount.count.mockResolvedValue(0);
      prisma.tradingAccount.create.mockResolvedValue({ id: 'a1' });
      await svc.create('u1', { label: 'C1' } as never, ctx('FREE', { trialEndsAt: null }));
      // Slot = comptes ACTIVE uniquement (PASSED / FAILED / ARCHIVED libèrent le slot).
      expect(prisma.tradingAccount.count).toHaveBeenCalledWith({
        where: { userId: 'u1', status: 'ACTIVE' },
      });
      expect(prisma.tradingAccount.create).toHaveBeenCalled();
    });

    it('PREMIUM → illimité (aucun comptage, crée même à 50 comptes)', async () => {
      prisma.tradingAccount.create.mockResolvedValue({ id: 'aN' });
      await svc.create('u1', { label: 'CN' } as never, ctx('PREMIUM'));
      expect(prisma.tradingAccount.count).not.toHaveBeenCalled();
      expect(prisma.tradingAccount.create).toHaveBeenCalled();
    });

    it('trial (FREE + trialEndsAt futur) → illimité', async () => {
      prisma.tradingAccount.create.mockResolvedValue({ id: 'aT' });
      const future = new Date(Date.now() + 3 * 86400_000);
      await svc.create('u1', { label: 'CT' } as never, ctx('FREE', { trialEndsAt: future }));
      expect(prisma.tradingAccount.count).not.toHaveBeenCalled();
      expect(prisma.tradingAccount.create).toHaveBeenCalled();
    });

    it('FREE au quota (1/1) → 403', async () => {
      prisma.tradingAccount.count.mockResolvedValue(1);
      await expect(
        svc.create('u1', { label: 'C2' } as never, ctx('FREE', { trialEndsAt: null })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.tradingAccount.create).not.toHaveBeenCalled();
    });
  });

  describe('update — réactivation et quota (anti-bypass)', () => {
    const ctx = (plan: string, extra: Record<string, unknown> = {}) =>
      ({ plan, role: 'USER', ...extra }) as never;

    it('réactivation (FAILED → ACTIVE) au quota → 403 ACCOUNT_LIMIT_REACHED, pas d\'update', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'FAILED' });
      prisma.tradingAccount.count.mockResolvedValue(1); // déjà 1 ACTIVE (FREE plein)
      await expect(
        svc.update('u1', 'a1', { status: 'ACTIVE' } as never, ctx('FREE', { trialEndsAt: null })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.tradingAccount.count).toHaveBeenCalledWith({
        where: { userId: 'u1', status: 'ACTIVE' },
      });
      expect(prisma.tradingAccount.update).not.toHaveBeenCalled();
    });

    it('réactivation (ARCHIVED → ACTIVE) sous le quota → applique', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'ARCHIVED' });
      prisma.tradingAccount.count.mockResolvedValue(0); // 0/1 → reste de la place
      prisma.tradingAccount.update.mockResolvedValue({ id: 'a1', status: 'ACTIVE' });
      await svc.update('u1', 'a1', { status: 'ACTIVE' } as never, ctx('FREE', { trialEndsAt: null }));
      expect(prisma.tradingAccount.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { status: 'ACTIVE' },
      });
    });

    it('réactivation PREMIUM (illimité) → applique sans comptage', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'FAILED' });
      prisma.tradingAccount.update.mockResolvedValue({ id: 'a1', status: 'ACTIVE' });
      await svc.update('u1', 'a1', { status: 'ACTIVE' } as never, ctx('PREMIUM'));
      expect(prisma.tradingAccount.count).not.toHaveBeenCalled();
      expect(prisma.tradingAccount.update).toHaveBeenCalled();
    });

    it('passage ACTIVE → FAILED (libère un slot) → aucune vérif de quota', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'ACTIVE' });
      prisma.tradingAccount.update.mockResolvedValue({ id: 'a1', status: 'FAILED' });
      await svc.update('u1', 'a1', { status: 'FAILED' } as never, ctx('FREE', { trialEndsAt: null }));
      expect(prisma.tradingAccount.count).not.toHaveBeenCalled();
      expect(prisma.tradingAccount.update).toHaveBeenCalled();
    });

    it('update sans changement de statut (label) → aucune vérif de quota', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'ACTIVE' });
      prisma.tradingAccount.update.mockResolvedValue({ id: 'a1' });
      await svc.update('u1', 'a1', { label: 'Renommé' } as never, ctx('FREE', { trialEndsAt: null }));
      expect(prisma.tradingAccount.count).not.toHaveBeenCalled();
      expect(prisma.tradingAccount.update).toHaveBeenCalled();
    });

    it('déjà ACTIVE, dto ACTIVE (no-op statut) → aucune vérif de quota', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'ACTIVE' });
      prisma.tradingAccount.update.mockResolvedValue({ id: 'a1' });
      await svc.update('u1', 'a1', { status: 'ACTIVE' } as never, ctx('FREE', { trialEndsAt: null }));
      expect(prisma.tradingAccount.count).not.toHaveBeenCalled();
      expect(prisma.tradingAccount.update).toHaveBeenCalled();
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
      prisma.user.findUnique.mockResolvedValue(null); // capital profil inconnu
      prisma.tradingAccount.create.mockResolvedValue({ id: 'created' });
      expect(await svc.ensureDefaultAccountId('u1')).toBe('created');
      expect(prisma.tradingAccount.create).toHaveBeenCalledWith({
        data: { userId: 'u1', label: 'Compte principal', startingBalance: null },
        select: { id: true },
      });
    });
  });

  describe('computeRuleMetrics — règles prop firm estimées', () => {
    const t = (pnl: number, day: number) => ({ pnl, tradedAt: new Date(2026, 5, day) });
    // Trades : +1000, +2000, -500 → realizedPnl 2500, currentBalance 52500.
    const trades = [t(1000, 1), t(2000, 2), t(-500, 3)];

    it('realizedPnl / solde NET des frais (commission soustraite par trade)', () => {
      const tc = (pnl: number, commission: number, day: number) => ({ pnl, commission, tradedAt: new Date(2026, 5, day) });
      const m = svc.computeRuleMetrics(
        { startingBalance: 50000, accountSize: null, profitTarget: null, maxDrawdown: null, drawdownType: 'STATIC' },
        [tc(1000, 10, 1), tc(500, 5, 2)],
      );
      expect(m.realizedPnl).toBe(1485); // (1000 - 10) + (500 - 5)
      expect(m.currentBalance).toBe(51485);
    });

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

    it('winRate / bestDay / worstDay : PnL groupé par jour UTC (somme intra-jour)', () => {
      // Dates UTC explicites → indépendant du fuseau de la machine de test.
      const u = (pnl: number, day: number, h = 12) => ({ pnl, tradedAt: new Date(Date.UTC(2026, 5, day, h)) });
      const m = svc.computeRuleMetrics(
        { startingBalance: 50000, accountSize: null, profitTarget: null, maxDrawdown: null, drawdownType: 'STATIC' },
        [u(1000, 1, 9), u(500, 1, 15), u(-800, 2)], // jour 1 = +1500, jour 2 = -800
      );
      expect(m.winRate).toBeCloseTo(2 / 3, 3); // 2 gagnants (pnl > 0) sur 3 trades
      expect(m.bestDay).toBe(1500);
      expect(m.worstDay).toBe(-800);
    });

    it('0 trade → winRate / bestDay / worstDay null', () => {
      const m = svc.computeRuleMetrics(
        { startingBalance: 50000, accountSize: null, profitTarget: null, maxDrawdown: null, drawdownType: 'STATIC' },
        [],
      );
      expect(m.tradesCount).toBe(0);
      expect(m.winRate).toBeNull();
      expect(m.bestDay).toBeNull();
      expect(m.worstDay).toBeNull();
    });
  });
});
