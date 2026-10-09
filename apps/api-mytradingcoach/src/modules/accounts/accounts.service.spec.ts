import type { PropFirmPhaseRules } from '@mtc/shared';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { aggregateRuleTrades, previousSession, sessionPnls } from './account-rules';
import { AccountsService, brokerReferenceMismatch, type RuleBroker, type RulePayouts, type RulePlan } from './accounts.service';

// Le AccountsController n'est gardé que par JwtAuthGuard : le multi-comptes
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
    propFirmPlan: { count: vi.fn() },
    brokerDailyClose: { groupBy: vi.fn(async () => []) },
    brokerPayout: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
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

    it('inscrit du jour (0 compte) → son 1er compte prop firm passe avec ses règles', async () => {
      // Cas de l'onboarding : le wizard crée le compte au checkpoint de
      // l'étape Stratégie. Un FREE fraîchement inscrit est à 0 compte, donc sous le
      // quota — vérifié plutôt que supposé, et les règles doivent traverser jusqu'à
      // Prisma (le ValidationPipe global est en forbidNonWhitelisted : un champ hors
      // DTO ferait un 400 invisible en unitaire côté front).
      prisma.tradingAccount.count.mockResolvedValue(0);
      prisma.tradingAccount.create.mockResolvedValue({ id: 'acc-1' });

      const dto = {
        label: 'Apex #1',
        broker: 'Apex',
        type: 'EVALUATION',
        accountSize: 50000,
        startingBalance: 50000,
        currency: 'USD',
        profitTarget: 3000,
        maxDrawdown: 2500,
        drawdownType: 'TRAILING',
      };
      await svc.create('u-new', dto as never, ctx('FREE', { trialEndsAt: null }));

      expect(prisma.tradingAccount.create).toHaveBeenCalledWith({
        data: { userId: 'u-new', ...dto },
      });
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

  describe('plan du catalogue prop firm (propFirmPlanId)', () => {
    it('create — plan actif du catalogue → relie le compte', async () => {
      prisma.propFirmPlan.count.mockResolvedValue(1);
      prisma.tradingAccount.create.mockResolvedValue({ id: 'a1' });
      await svc.create('u1', { label: 'Apex 50k', propFirmPlanId: 'apex-eod-50k' } as never);
      expect(prisma.propFirmPlan.count).toHaveBeenCalledWith({ where: { id: 'apex-eod-50k', active: true } });
      expect(prisma.tradingAccount.create).toHaveBeenCalledWith({
        data: { userId: 'u1', label: 'Apex 50k', propFirmPlanId: 'apex-eod-50k' },
      });
    });

    it('create — plan inconnu ou retiré → 400, rien de créé (pas de 500 sur la FK)', async () => {
      prisma.propFirmPlan.count.mockResolvedValue(0);
      await expect(
        svc.create('u1', { label: 'X', propFirmPlanId: 'apex-retire-50k' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.tradingAccount.create).not.toHaveBeenCalled();
    });

    it('update — même plan qu’avant → aucun contrôle (un plan retiré reste sur le compte)', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'ACTIVE', propFirmPlanId: 'apex-retire-50k' });
      prisma.tradingAccount.update.mockResolvedValue({ id: 'a1' });
      await svc.update('u1', 'a1', { propFirmPlanId: 'apex-retire-50k', label: 'Renommé' } as never);
      expect(prisma.propFirmPlan.count).not.toHaveBeenCalled();
      expect(prisma.tradingAccount.update).toHaveBeenCalled();
    });

    it('update — null détache le compte du plan', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'ACTIVE', propFirmPlanId: 'apex-eod-50k' });
      prisma.tradingAccount.update.mockResolvedValue({ id: 'a1' });
      await svc.update('u1', 'a1', { propFirmPlanId: null } as never);
      expect(prisma.propFirmPlan.count).not.toHaveBeenCalled();
      expect(prisma.tradingAccount.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { propFirmPlanId: null } });
    });
  });

  it('list — scope user + actifs avant archivés', async () => {
    prisma.tradingAccount.findMany.mockResolvedValue([]);
    await svc.list('u1');
    expect(prisma.tradingAccount.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: {
        propFirmPlan: { select: expect.objectContaining({ phases: true }) },
        // Solde du broker : seulement une connexion qui en a un.
        // Toutes les connexions : solde du broker, et plateforme connue si Tradovate.
        brokerConnections: { select: expect.objectContaining({ provider: true, brokerNetLiq: true }) },
      },
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

  describe('computeRuleMetrics — règles du plan du catalogue', () => {
    // Trades à 15:00 UTC (= 10:00 heure de Chicago) : une journée de trading CME par jour.
    const d = (pnl: number, day: number, h = 15) => ({ pnl, tradedAt: new Date(Date.UTC(2026, 5, day, h)) });
    const md = (o: Partial<PropFirmPhaseRules['max_drawdown']>) =>
      ({ amount: 2000, type: 'trailing_eod', trails_on: 'balance', locks_at: null, locked_floor: null,
        enforced_on: 'equity_realtime', basis_notes: null, ...o }) as PropFirmPhaseRules['max_drawdown'];
    const ph = (phase: PropFirmPhaseRules['phase'], m: PropFirmPhaseRules['max_drawdown'], starting?: number) =>
      ({ phase, starting_balance: starting, max_drawdown: m }) as PropFirmPhaseRules;
    const manual = { accountSize: 50000, profitTarget: null, maxDrawdown: 9999, drawdownType: 'STATIC' as const };
    const topstep: RulePlan = {
      firmName: 'Topstep', planName: 'Trading Combine', accountSize: 50000,
      phases: [
        ph('evaluation', md({ locks_at: 52000, locked_floor: 50000 })),
        ph('funded', md({ locks_at: 2000, locked_floor: 0 }), 0),
      ],
    };

    describe('perte journalière (Premium, #370)', () => {
      const dll = { amount: 1000, basis: 'equity', resets_at: '17:00 America/Chicago', breach: 'trading_paused_for_day', scaling_rule: null } as const;
      const withDll: RulePlan = { ...topstep, phases: [{ ...topstep.phases[0], daily_loss_limit: dll }] };
      const acct = { ...manual, startingBalance: 50000, type: 'EVALUATION' as const };
      // 2 juin, 16:00 UTC = 11:00 à Chicago : journée de trading du 2 juin, la veille = 1er juin.
      const now = new Date(Date.UTC(2026, 5, 2, 16));
      const agg = { count: 2, wins: 1, losses: 1, realized: 400, maxCumulative: 1200, maxEodCumulative: 1200, bestDay: 1200, worstDay: -800 };
      const sessions = [{ day: '2026-06-01', pnl: 1200 }, { day: '2026-06-02', pnl: -800 }];

      it('hors Premium : non calculée', () => {
        const m = svc.ruleMetricsFromAgg(acct, agg, withDll, null, null, null, now, sessions, null);
        expect(m.dailyLoss).toBeNull();
      });

      it('sans clôture officielle : référence = solde − trades du jour', () => {
        const m = svc.ruleMetricsFromAgg(acct, agg, withDll, null, null, null, now, sessions, null, { premium: true });
        expect(m.dailyLoss).toMatchObject({ limit: 1000, startOfDay: 51200, used: 800, remaining: 200, source: 'trades', breached: false });
      });

      it('clôture officielle de la veille + latent du broker : elle fait foi, le latent compte', () => {
        const broker = { cashBalance: 50400, cashBalanceAt: now, netLiq: 50100, openPnl: -300, equityAt: now, openPositions: 1 };
        const official = { peakClose: 51200, lastTradeDate: '2026-06-01', lastClose: 51200 };
        const m = svc.ruleMetricsFromAgg(acct, agg, withDll, broker, 'tradovate', official, now, sessions, null, { premium: true });
        expect(m.dailyLoss).toMatchObject({ startOfDay: 51200, used: 1100, breached: true, source: 'broker' });
      });

      it('plan sans perte journalière : null', () => {
        const m = svc.ruleMetricsFromAgg(acct, agg, topstep, null, null, null, now, sessions, null, { premium: true });
        expect(m.dailyLoss).toBeNull();
      });
    });

    it('évaluation : le plan remplace la saisie manuelle (montant, type)', () => {
      const m = svc.computeRuleMetrics({ ...manual, startingBalance: 50000, type: 'EVALUATION' }, [d(500, 1), d(700, 2)], topstep);
      expect(m.drawdown).toMatchObject({ source: 'plan', type: 'TRAILING', maxDrawdown: 2000, floor: 49200, margin: 2000, breached: false });
      expect(m.drawdown?.rule).toMatchObject({ firmName: 'Topstep', phase: 'evaluation', kind: 'trailing_eod', locked: false, realtimeEquity: true });
      expect(m.disclaimer).toContain('positions ouvertes comprises : elles ne sont pas incluses ici');
    });

    it('trailing EOD : seul le solde de clôture de la journée de trading fait monter le seuil', () => {
      // Jour 1 : +1 500 puis -1 000 → clôture +500. Le pic intraday (+1 500) ne compte pas.
      const m = svc.computeRuleMetrics({ ...manual, startingBalance: 50000, type: 'EVALUATION' }, [d(1500, 1, 14), d(-1000, 1, 19)], topstep);
      expect(m.drawdown?.floor).toBe(48500); // 50 000 + 500 − 2 000
    });

    it('trailing intraday : le plus haut atteint après chaque trade fait monter le seuil', () => {
      const intraday: RulePlan = { ...topstep, phases: [ph('evaluation', md({ type: 'trailing_intraday', trails_on: 'equity' }))] };
      const m = svc.computeRuleMetrics({ ...manual, startingBalance: 50000, type: 'EVALUATION' }, [d(1500, 1, 14), d(-1000, 1, 19)], intraday);
      expect(m.drawdown?.floor).toBe(49500); // 50 000 + 1 500 − 2 000
      expect(m.disclaimer).toContain('pics atteints pendant un trade ouvert');
    });

    it('verrouillage : une fois le seuil de déclenchement atteint, le plancher est figé', () => {
      const m = svc.computeRuleMetrics({ ...manual, startingBalance: 50000, type: 'EVALUATION' }, [d(2500, 1), d(1000, 2)], topstep);
      expect(m.drawdown).toMatchObject({ floor: 50000, margin: 3500 });
      expect(m.drawdown?.rule).toMatchObject({ locked: true, locksAt: 52000, lockedFloor: 50000 });
    });

    it('funded qui démarre à 0 $ (XFA Topstep) : seuil à −2 000 $, figé à 0 $', () => {
      const xfa = { ...manual, startingBalance: 0, type: 'FUNDED' as const };
      expect(svc.computeRuleMetrics(xfa, [d(300, 1)], topstep).drawdown).toMatchObject({ floor: -1700, margin: 2000 });
      expect(svc.computeRuleMetrics(xfa, [d(2100, 1)], topstep).drawdown).toMatchObject({ floor: 0, margin: 2100 });
    });

    it('solde de départ saisi différent : les seuils du plan sont décalés d\'autant', () => {
      const m = svc.computeRuleMetrics({ ...manual, startingBalance: 51000, type: 'EVALUATION' }, [d(2000, 1)], topstep);
      expect(m.drawdown?.rule).toMatchObject({ locksAt: 53000, lockedFloor: 51000, locked: true });
      expect(m.drawdown?.floor).toBe(51000);
    });

    it('plan sans verrouillage chiffré (déclenché par un payout) : le seuil continue de suivre', () => {
      const pro: RulePlan = { ...topstep, phases: [ph('funded', md({ locks_at: null, locked_floor: 50100 }))] };
      const m = svc.computeRuleMetrics({ ...manual, startingBalance: 50000, type: 'FUNDED' }, [d(5000, 1)], pro);
      expect(m.drawdown).toMatchObject({ floor: 53000 });
      expect(m.drawdown?.rule).toMatchObject({ locksAt: null, lockedFloor: null, locked: false });
    });

    it('statique : plancher fixe sous le solde de départ', () => {
      const st: RulePlan = { ...topstep, phases: [ph('direct', md({ type: 'static', trails_on: null, enforced_on: null }))] };
      const m = svc.computeRuleMetrics({ ...manual, startingBalance: 50000, type: 'FUNDED' }, [d(3000, 1)], st);
      expect(m.drawdown).toMatchObject({ type: 'STATIC', floor: 48000 });
      expect(m.disclaimer).not.toContain('positions ouvertes comprises');
    });

    it('montant non publié : aucun chiffre, drawdownUnconfirmed', () => {
      const unk: RulePlan = { ...topstep, phases: [ph('evaluation', md({ amount: null as unknown as number }))] };
      const m = svc.computeRuleMetrics({ ...manual, startingBalance: 50000, type: 'EVALUATION' }, [d(100, 1)], unk);
      expect(m.drawdown).toBeNull();
      expect(m.drawdownUnconfirmed).toBe(true);
    });

    it('type de compte sans phase correspondante (perso) → saisie manuelle', () => {
      const m = svc.computeRuleMetrics({ ...manual, startingBalance: 50000, type: 'PERSONAL' }, [d(100, 1)], topstep);
      expect(m.drawdown).toMatchObject({ source: 'manual', maxDrawdown: 9999, rule: null });
      expect(m.disclaimer).toContain('Estimation basée uniquement sur les trades loggés');
    });
  });

  describe('dismissPayout — « ce n\'était pas un payout »', () => {
    it('compte d\'un autre utilisateur → 404, rien modifié', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'autre' });
      await expect(svc.dismissPayout('u1', 'a1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.brokerPayout.updateMany).not.toHaveBeenCalled();
    });

    it('écarte le payout de CE compte, jamais supprimé', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1' });
      prisma.brokerPayout.updateMany.mockResolvedValue({ count: 1 });
      await expect(svc.dismissPayout('u1', 'a1', 'p1')).resolves.toEqual({ dismissed: true });
      expect(prisma.brokerPayout.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', accountId: 'a1', dismissedAt: null }, data: { dismissedAt: expect.any(Date) },
      });
    });

    it('payout inconnu ou déjà écarté → 404', async () => {
      prisma.tradingAccount.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1' });
      prisma.brokerPayout.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.dismissPayout('u1', 'a1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('computeRuleMetrics — cycle de payout : détecté chez le broker ou saisi', () => {
    const at = (pnl: number, iso: string) => ({ pnl, tradedAt: new Date(iso) });
    const funded: RulePlan = { firmName: 'Lucid Trading', planName: 'LucidFlex', accountSize: 50_000, phases: [
      { phase: 'funded', profit_target: null, consistency: null, min_trading_days: null,
        max_drawdown: { amount: 2_000, type: 'trailing_eod', trails_on: 'balance', locks_at: null, locked_floor: null, basis_notes: null },
        payout: { min_days: 5, min_daily_profit: 150, min_cycle_profit: null, min_cycle_profit_schedule: null, safety_net_balance: null, min_amount: 500 },
      } as unknown as PropFirmPhaseRules,
    ] };
    const acc = { startingBalance: 50_000, accountSize: 50_000, profitTarget: null, maxDrawdown: null, drawdownType: 'TRAILING' as const, type: 'FUNDED' as const };
    const trades = [at(200, '2026-09-28T15:00:00Z'), at(200, '2026-09-29T15:00:00Z'), at(200, '2026-09-30T15:00:00Z')];
    const progressOf = (lastPayoutAt: Date | null, payouts: RulePayouts | null) =>
      svc.ruleMetricsFromAgg({ ...acc, lastPayoutAt }, aggregateRuleTrades(trades), funded, null, null, null, new Date(), sessionPnls(trades), payouts).progress!;

    it('payout détecté plus récent que la date saisie : il fixe le cycle et donne le rang', () => {
      const p = progressOf(new Date('2026-09-20T00:00:00Z'), { last: '2026-09-28', count: 3 });
      expect(p).toMatchObject({ cycleAfter: '2026-09-28', cycleSource: 'broker', payoutsReceived: 3 });
      expect(p.requirements[0]).toMatchObject({ key: 'winning_days', current: 2 });
    });

    it('date saisie plus récente que le dernier payout détecté : la saisie l\'emporte, rang inconnu', () => {
      expect(progressOf(new Date('2026-09-29T00:00:00Z'), { last: '2026-09-10', count: 1 }))
        .toMatchObject({ cycleAfter: '2026-09-29', cycleSource: 'user', payoutsReceived: null });
    });

    it('payout probable qui fixe le cycle : exposé (id, montant, certitude) pour être confirmé ou écarté', () => {
      expect(progressOf(null, { last: '2026-10-01', count: 3, lastId: 'p3', lastAmount: 1_085, lastConfidence: 'probable' }))
        .toMatchObject({ cycleSource: 'broker', lastPayout: { id: 'p3', amount: 1_085, confidence: 'probable' } });
    });

    it('ni détecté ni saisi : cycle depuis le début', () => {
      expect(progressOf(null, null)).toMatchObject({ cycleAfter: null, cycleSource: null });
    });
  });

  describe('computeRuleMetrics — plus haut de clôture officiel (trailing EOD)', () => {
    // Vendredi 2 octobre 2026, 15:00 UTC : séance du 2 en cours, la précédente est le 1er.
    const now = new Date('2026-10-02T15:00:00Z');
    const at = (pnl: number, iso: string) => ({ pnl, tradedAt: new Date(iso) });
    const eod: RulePlan = { firmName: 'Lucid Trading', planName: 'LucidFlex', accountSize: 50_000, phases: [
      { phase: 'evaluation', max_drawdown: {
        amount: 2_000, type: 'trailing_eod', trails_on: 'balance', locks_at: 52_100, locked_floor: 50_100,
        enforced_on: null, basis_notes: null,
      } } as unknown as PropFirmPhaseRules,
    ] };
    const acc = { startingBalance: 50_000, accountSize: 50_000, profitTarget: null, maxDrawdown: null, drawdownType: 'TRAILING' as const, type: 'EVALUATION' as const };
    const broker = (cash: number): RuleBroker => ({ cashBalance: cash, cashBalanceAt: now, netLiq: cash, openPnl: 0, equityAt: now, openPositions: 0 });
    // MTC ne voit qu'un trade (+500) ; le broker a clôturé à 51 400 le 30/09 (des trades manquent).
    const trades = [at(500, '2026-09-30T15:00:00Z')];

    it('clôtures à jour (séance précédente couverte) : elles font foi, même au-dessus des trades', () => {
      const m = svc.computeRuleMetrics(acc, trades, eod, broker(51_000), null, { peakClose: 51_400, lastTradeDate: '2026-10-01' }, now);
      expect(m.drawdown).toMatchObject({ floor: 49_400 });
      expect(m.drawdown?.rule).toMatchObject({ peakSource: 'broker', peakBalance: 51_400, officialThrough: '2026-10-01' });
    });

    it('clôtures à jour : un plus haut reconstitué trop haut (pertes non loggées) est écarté', () => {
      const m = svc.computeRuleMetrics(acc, [at(3_000, '2026-09-29T15:00:00Z')], eod, broker(50_800), null,
        { peakClose: 51_200, lastTradeDate: '2026-10-01' }, now);
      expect(m.drawdown?.rule).toMatchObject({ peakSource: 'broker', peakBalance: 51_200 });
    });

    it('clôtures en retard (séance précédente absente) : le plus prudent des deux', () => {
      const m = svc.computeRuleMetrics(acc, [at(3_000, '2026-09-29T15:00:00Z')], eod, broker(50_800), null,
        { peakClose: 51_200, lastTradeDate: '2026-09-29' }, now);
      expect(m.drawdown?.rule).toMatchObject({ peakSource: 'trades', peakBalance: 53_000, officialThrough: '2026-09-29' });
    });

    it('verrouillage atteint grâce au plus haut officiel', () => {
      const m = svc.computeRuleMetrics(acc, trades, eod, broker(51_900), null, { peakClose: 52_300, lastTradeDate: '2026-10-01' }, now);
      expect(m.drawdown).toMatchObject({ floor: 50_100 });
      expect(m.drawdown?.rule).toMatchObject({ locked: true });
    });

    it('sans solde broker, ou référentiel incompatible : clôtures ignorées', () => {
      const off = { peakClose: 51_400, lastTradeDate: '2026-10-01' };
      expect(svc.computeRuleMetrics(acc, trades, eod, null, null, off, now).drawdown?.rule).toMatchObject({ peakSource: 'trades', officialThrough: null });
      const m = svc.computeRuleMetrics({ ...acc, startingBalance: 0, accountSize: null }, trades, eod, broker(51_000), null, off, now);
      expect(m.broker?.referenceMismatch).toBe(true);
      expect(m.drawdown?.rule?.officialThrough).toBeNull();
    });

    it('previousSession : lundi → vendredi, mardi → lundi', () => {
      expect(previousSession('2026-10-05')).toBe('2026-10-02');
      expect(previousSession('2026-10-06')).toBe('2026-10-05');
    });
  });

  describe('computeRuleMetrics — verrouillage propre à la plateforme', () => {
    const d = (pnl: number, day: number) => ({ pnl, tradedAt: new Date(Date.UTC(2026, 5, day, 15)) });
    // Apex EOD 50K : pas de verrouillage par défaut ni sur Tradovate, figé à 53 000 $ sur Rithmic
    // quand le solde de clôture atteint 55 000 $.
    const apex: RulePlan = { firmName: 'Apex Trader Funding', planName: 'EOD Trail', accountSize: 50_000, phases: [
      { phase: 'evaluation', max_drawdown: {
        amount: 2_000, type: 'trailing_eod', trails_on: 'balance', locks_at: null, locked_floor: null,
        enforced_on: 'equity_realtime', basis_notes: null,
        platform_overrides: {
          tradovate: { locks_at: null, locked_floor: null },
          rithmic: { locks_at: 55_000, locked_floor: 53_000 },
          wealthcharts: { locks_at: 55_000, locked_floor: 53_000 },
        },
      } } as unknown as PropFirmPhaseRules,
    ] };
    const evalAcc = { startingBalance: 50_000, accountSize: 50_000, profitTarget: null, maxDrawdown: null, drawdownType: 'TRAILING' as const, type: 'EVALUATION' as const };
    const trades = [d(5_500, 1), d(-1_000, 2)]; // clôtures 55 500 puis 54 500

    it('Rithmic (saisi) : seuil figé à 53 000 $ une fois 55 000 $ atteints', () => {
      const m = svc.computeRuleMetrics({ ...evalAcc, platform: 'rithmic' }, trades, apex);
      expect(m.drawdown).toMatchObject({ floor: 53_000, margin: 1_500 });
      expect(m.drawdown?.rule).toMatchObject({ locked: true, platform: 'rithmic', platformChoices: [] });
    });

    it('connecté via Tradovate : jamais figé, même si une autre plateforme a été saisie', () => {
      const m = svc.computeRuleMetrics({ ...evalAcc, platform: 'rithmic' }, trades, apex, null, 'tradovate');
      expect(m.drawdown).toMatchObject({ floor: 53_500, margin: 1_000 }); // 55 500 − 2 000
      expect(m.drawdown?.rule).toMatchObject({ locked: false, platform: 'tradovate' });
    });

    it('plateforme inconnue : règle par défaut (la plus prudente) et choix proposés', () => {
      const m = svc.computeRuleMetrics(evalAcc, trades, apex);
      expect(m.drawdown?.floor).toBe(53_500);
      expect(m.drawdown?.rule).toMatchObject({ platform: null, platformChoices: ['rithmic', 'tradovate', 'wealthcharts'] });
    });

    it('plateforme sans règle particulière (ex. NinjaTrader) : règle par défaut, choix toujours proposés', () => {
      const m = svc.computeRuleMetrics({ ...evalAcc, platform: 'ninjatrader' }, trades, apex);
      expect(m.drawdown?.rule).toMatchObject({ platform: null, platformChoices: ['rithmic', 'tradovate', 'wealthcharts'] });
    });
  });

  describe('computeRuleMetrics — solde et equity lus chez le broker', () => {
    const d = (pnl: number, day: number) => ({ pnl, tradedAt: new Date(Date.UTC(2026, 5, day, 15)) });
    const manual = { startingBalance: 50_000, accountSize: 50_000, profitTarget: 3_000, maxDrawdown: 2_000, drawdownType: 'STATIC' as const };
    const broker = (o: Partial<RuleBroker> = {}): RuleBroker => ({
      cashBalance: 50_400, cashBalanceAt: new Date(), netLiq: null, openPnl: null, equityAt: null, openPositions: 0, ...o,
    });

    it('le solde du broker fait foi (trade ou frais manquant côté MTC) : solde, P&L et objectif', () => {
      // MTC ne voit que +500 ; le broker dit 50 400 (un trade de -100 n'a pas été loggé).
      const m = svc.computeRuleMetrics(manual, [d(500, 1)], null, broker());
      expect(m.currentBalance).toBe(50_400);
      expect(m.realizedPnl).toBe(400);
      expect(m.objective?.current).toBe(400);
      expect(m.broker).toMatchObject({ cashBalance: 50_400, equity: 50_400, openPnl: 0, referenceMismatch: false });
      expect(m.disclaimer).toContain('lus chez le broker');
    });

    it('position ouverte : la marge se calcule sur l\'equity du broker, latent compris', () => {
      const m = svc.computeRuleMetrics(manual, [d(500, 1)], null, broker({ cashBalance: 50_500, netLiq: 48_700, openPnl: -1_800, openPositions: 1 }));
      expect(m.currentBalance).toBe(50_500);
      expect(m.broker?.equity).toBe(48_700);
      expect(m.drawdown).toMatchObject({ floor: 48_000, margin: 700 }); // et non 2 500 sur le seul solde
    });

    it('position ouverte au latent jamais lu : 0 pour l\'equity, mais signalé inconnu à l\'écran', () => {
      const m = svc.computeRuleMetrics(manual, [d(500, 1)], null, broker({ cashBalance: 50_500, openPnl: null, openPositions: 1 }));
      expect(m.broker).toMatchObject({ openPnl: 0, openPnlKnown: false, equity: 50_500 });
      const flat = svc.computeRuleMetrics(manual, [d(500, 1)], null, broker({ openPnl: null, openPositions: 0 }));
      expect(flat.broker).toMatchObject({ openPnl: 0, openPnlKnown: true });
    });

    it('trailing intraday : un nouveau plus haut en direct fait monter le seuil', () => {
      const intraday: RulePlan = { firmName: 'F', planName: 'P', accountSize: 50_000, phases: [
        { phase: 'evaluation', max_drawdown: { amount: 2_000, type: 'trailing_intraday', trails_on: 'equity', locks_at: null, locked_floor: null, enforced_on: 'equity_realtime', basis_notes: null } } as PropFirmPhaseRules,
      ] };
      const m = svc.computeRuleMetrics({ ...manual, type: 'EVALUATION' }, [d(500, 1)], intraday,
        broker({ cashBalance: 50_500, netLiq: 51_200, openPnl: 700, openPositions: 1 }));
      expect(m.drawdown).toMatchObject({ floor: 49_200, margin: 2_000 });
    });

    it('référentiel incompatible (funded saisi à 0 $, broker à 50 000 $) : calcul MTC + latent, signalé', () => {
      const m = svc.computeRuleMetrics({ ...manual, startingBalance: 0, accountSize: null }, [d(300, 1)], null,
        broker({ cashBalance: 50_300, openPnl: -200, openPositions: 1, netLiq: 50_100 }));
      expect(m.currentBalance).toBe(300);
      expect(m.broker).toMatchObject({ referenceMismatch: true, equity: 100 });
    });

    it('brokerReferenceMismatch : petit écart = trades manquants, gros écart = autre référentiel', () => {
      expect(brokerReferenceMismatch(-1_500, 50_000)).toBe(false);
      expect(brokerReferenceMismatch(50_000, 0)).toBe(true);
      expect(brokerReferenceMismatch(15_000, 50_000)).toBe(true);
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
