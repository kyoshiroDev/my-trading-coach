import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccountStatus, AccountType, DrawdownType, Plan, Role } from '@prisma/client';
import { AccountsService } from './accounts.service';
import { isFloorReached } from './account-retry';

/**
 * Compte perdu côté comptes : nouvelle tentative (POST /accounts/:id/retry), et invalidation du
 * cache des statistiques quand un statut change (les trades du compte entrent ou sortent des
 * agrégats « tous les comptes »).
 */
function makePrisma() {
  const prisma = {
    tradingAccount: {
      findMany: vi.fn(async () => [] as { id?: string; label: string }[]),
      findUnique: vi.fn(),
      create: vi.fn(async ({ data }: { data: unknown }) => ({ id: 'acc-new', ...(data as object) })),
      update: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
      delete: vi.fn(),
    },
    trade: { count: vi.fn(async () => 3) },
    tradeSession: { count: vi.fn(async () => 0) },
    propFirmPlan: { count: vi.fn(async () => 1) },
    brokerConnection: { count: vi.fn(async () => 0) },
    // Nouvelle tentative sous verrou transactionnel (B3) : la transaction rejoue sur le même client.
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return prisma;
}

const failed = {
  id: 'acc-old', userId: 'u1', label: 'Apex 50K #1', broker: 'Apex', type: AccountType.EVALUATION,
  status: AccountStatus.FAILED, accountSize: 50_000, currency: 'USD', startingBalance: 50_000,
  profitTarget: 3_000, maxDrawdown: 2_500, drawdownType: DrawdownType.TRAILING, platform: 'tradovate',
  lastPayoutAt: null, propFirmPlanId: 'plan-apex-50k', planLinkChoice: null, unlistedFirm: null,
};

const FREE = { plan: Plan.FREE, role: Role.USER, trialEndsAt: null };
const PREMIUM = { plan: Plan.PREMIUM, role: Role.USER, trialEndsAt: null };

describe('AccountsService.retry — nouvelle tentative', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: AccountsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new AccountsService(prisma as never);
  });

  it('compte échoué : nouveau compte même firme / plan / taille, libellé incrémenté côté serveur', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue(failed);
    prisma.tradingAccount.findMany.mockResolvedValue([{ label: 'Apex 50K #1' }, { label: 'Topstep 150K' }]);

    await svc.retry('u1', 'acc-old', PREMIUM);

    const data = prisma.tradingAccount.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({
      userId: 'u1', label: 'Apex 50K #2', broker: 'Apex', type: AccountType.EVALUATION, accountSize: 50_000,
      propFirmPlanId: 'plan-apex-50k', maxDrawdown: 2_500, drawdownType: DrawdownType.TRAILING, platform: 'tradovate',
    });
    expect(data).not.toHaveProperty('status'); // ACTIVE par défaut
    expect(data).not.toHaveProperty('lastPayoutAt');
    // Libellés lus pour CET utilisateur seulement.
    expect(prisma.tradingAccount.findMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, select: { id: true, label: true } });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1); // verrou pris avant la lecture
  });

  it('libellé : plus grand numéro existant + 1', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue({ ...failed, label: 'Apex 50K #3' });
    prisma.tradingAccount.findMany.mockResolvedValue([{ label: 'Apex 50K #1' }, { label: 'Apex 50K #2' }, { label: 'Apex 50K #3' }]);
    await svc.retry('u1', 'acc-old', PREMIUM);
    expect(prisma.tradingAccount.create.mock.calls[0][0].data).toMatchObject({ label: 'Apex 50K #4' });
  });

  it.each([AccountStatus.ACTIVE, AccountStatus.PASSED, AccountStatus.ARCHIVED])('compte %s → 409, rien créé', async (status) => {
    prisma.tradingAccount.findUnique.mockResolvedValue({ ...failed, status });
    await expect(svc.retry('u1', 'acc-old', PREMIUM)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tradingAccount.create).not.toHaveBeenCalled();
  });

  it('tentative plus récente déjà créée (B3) : 409 RETRY_EXISTS avec son id, rien créé, avant le quota', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue(failed);
    prisma.tradingAccount.findMany.mockResolvedValue([{ id: 'acc-old', label: 'Apex 50K #1' }, { id: 'acc-2', label: 'Apex 50K #2' }]);
    prisma.tradingAccount.count.mockResolvedValue(1); // FREE au quota : le quota n'est même pas lu
    const err = await svc.retry('u1', 'acc-old', FREE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'RETRY_EXISTS', accountId: 'acc-2', label: 'Apex 50K #2' });
    expect(prisma.tradingAccount.count).not.toHaveBeenCalled();
    expect(prisma.tradingAccount.create).not.toHaveBeenCalled();
  });

  it('compte d’un autre utilisateur → 404, rien créé', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue({ ...failed, userId: 'u2' });
    await expect(svc.retry('u1', 'acc-old', PREMIUM)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tradingAccount.create).not.toHaveBeenCalled();
  });

  it('compte inconnu → 404', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue(null);
    await expect(svc.retry('u1', 'nope', PREMIUM)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('FREE sans compte actif (l’échoué a libéré sa place) → créé', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue(failed);
    prisma.tradingAccount.count.mockResolvedValue(0);
    await svc.retry('u1', 'acc-old', FREE);
    expect(prisma.tradingAccount.count).toHaveBeenCalledWith({ where: { userId: 'u1', status: AccountStatus.ACTIVE } });
    expect(prisma.tradingAccount.create).toHaveBeenCalledTimes(1);
  });

  it('FREE avec déjà un compte actif → quota (403), rien créé', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue(failed);
    prisma.tradingAccount.count.mockResolvedValue(1);
    await expect(svc.retry('u1', 'acc-old', FREE)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tradingAccount.create).not.toHaveBeenCalled();
  });
});

describe('AccountsService — statistiques à recalculer quand un statut change', () => {
  let prisma: ReturnType<typeof makePrisma>;
  const multi = { incr: vi.fn(), expire: vi.fn(), exec: vi.fn() };
  const redis = { client: { multi: vi.fn(() => multi) } };
  let svc: AccountsService;

  beforeEach(() => {
    prisma = makePrisma();
    multi.incr.mockReset().mockReturnValue(multi);
    multi.expire.mockReset().mockReturnValue(multi);
    multi.exec.mockReset().mockResolvedValue([]);
    redis.client.multi.mockClear();
    svc = new AccountsService(prisma as never, redis as never);
  });

  it('marqué échoué → cache analytics de l’utilisateur invalidé', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue({ ...failed, status: AccountStatus.ACTIVE });
    await svc.update('u1', 'acc-old', { status: AccountStatus.FAILED } as never, PREMIUM);
    expect(multi.incr).toHaveBeenCalledWith('analytics:v:u1');
  });

  it('statut inchangé ou autre champ → pas d’invalidation', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue(failed);
    await svc.update('u1', 'acc-old', { label: 'Apex' } as never, PREMIUM);
    await svc.update('u1', 'acc-old', { status: AccountStatus.FAILED } as never, PREMIUM);
    expect(multi.incr).not.toHaveBeenCalled();
  });

  it('archivage par suppression d’un compte avec historique → invalidé', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValue(failed);
    expect(await svc.remove('u1', 'acc-old')).toEqual({ archived: true });
    expect(multi.incr).toHaveBeenCalledWith('analytics:v:u1');
  });

  it('sans Redis (tests, appels internes) : aucune erreur', async () => {
    const bare = new AccountsService(prisma as never);
    prisma.tradingAccount.findUnique.mockResolvedValue({ ...failed, status: AccountStatus.ACTIVE });
    await expect(bare.update('u1', 'acc-old', { status: AccountStatus.ARCHIVED } as never, PREMIUM)).resolves.toBeDefined();
  });
});

// Détection du plancher sur des règles SAISIES À LA MAIN (sans plan du catalogue) : même calcul de
// marge que pour un plan, donc même signal.
describe('plancher atteint : règles de perte maximale saisies à la main', () => {
  const svc = new AccountsService({} as never);
  const manual = { accountSize: 50_000, startingBalance: 50_000, profitTarget: null, maxDrawdown: 2_000, drawdownType: DrawdownType.STATIC };
  const loss = (pnl: number) => [{ pnl, commission: 0, tradedAt: new Date('2026-10-01T15:00:00.000Z') }];

  it('perte au-delà du drawdown saisi → marge ≤ 0, floorReached', () => {
    const m = svc.computeRuleMetrics(manual, loss(-2_100));
    expect(m.drawdown).toMatchObject({ source: 'manual', breached: true });
    expect(isFloorReached({ status: AccountStatus.ACTIVE }, m.drawdown)).toBe(true);
  });

  it('perte en deçà → pas de signal', () => {
    const m = svc.computeRuleMetrics(manual, loss(-1_500));
    expect(isFloorReached({ status: AccountStatus.ACTIVE }, m.drawdown)).toBe(false);
  });

  it('aucune règle de perte maximale → pas de signal, même en forte perte', () => {
    const m = svc.computeRuleMetrics({ ...manual, maxDrawdown: null }, loss(-9_000));
    expect(m.drawdown).toBeNull();
    expect(isFloorReached({ status: AccountStatus.ACTIVE }, m.drawdown)).toBe(false);
  });
});

describe('AccountsService.purge — suppression définitive', () => {
  it.each([undefined, false, 'true', 1, {}])('confirm=%j → 400, aucune lecture ni écriture', async (confirm) => {
    const prisma = { ...makePrisma(), $transaction: vi.fn() };
    const svc = new AccountsService(prisma as never);
    await expect(svc.purge('u1', 'acc-old', confirm)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tradingAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('compte d’un autre utilisateur → 404, aucune transaction', async () => {
    const prisma = { ...makePrisma(), $transaction: vi.fn() };
    prisma.tradingAccount.findUnique.mockResolvedValue({ ...failed, userId: 'u2' });
    await expect(new AccountsService(prisma as never).purge('u1', 'acc-old', true)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trades, séances et connexion broker effacés AVANT le compte, dans la transaction ; cache vidé', async () => {
    const calls: string[] = [];
    const tx = {
      trade: { deleteMany: vi.fn(async () => { calls.push('trades'); return { count: 12 }; }) },
      tradeSession: { deleteMany: vi.fn(async () => { calls.push('sessions'); return { count: 3 }; }) },
      brokerConnection: { deleteMany: vi.fn(async () => { calls.push('connexion'); return { count: 1 }; }) },
      tradingAccount: { delete: vi.fn(async () => { calls.push('compte'); return {}; }) },
    };
    const prisma = { ...makePrisma(), $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
    prisma.tradingAccount.findUnique.mockResolvedValue(failed);
    const multi = { incr: vi.fn(), expire: vi.fn(), exec: vi.fn(async () => []) };
    multi.incr.mockReturnValue(multi);
    multi.expire.mockReturnValue(multi);

    const res = await new AccountsService(prisma as never, { client: { multi: () => multi } } as never).purge('u1', 'acc-old', true);

    expect(res).toEqual({ deleted: true, tradesDeleted: 12 });
    expect(calls).toEqual(['trades', 'sessions', 'connexion', 'compte']);
    expect(tx.trade.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', accountId: 'acc-old' } });
    expect(tx.brokerConnection.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', accountId: 'acc-old' } });
    expect(multi.incr).toHaveBeenCalledWith('analytics:v:u1');
  });
});
