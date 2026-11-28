import { describe, it, expect, vi, afterEach } from 'vitest';
import { freezeClock } from '../../../test/freeze-clock';
import { SessionContractService, editsBetween, mergeRules, normalizeAssets } from './session-contract.service';

const NOW = new Date('2026-11-27T16:02:00.000Z');
freezeClock(NOW);
const EMPTY = { maxDailyLoss: null, maxConsecutiveLosses: null, maxTrades: null, newsMinutes: null, allowedAssets: [] as string[] };

afterEach(() => {
  delete process.env['SESSION_CONTRACT_ENABLED'];
});

describe('règles du contrat de session (#667)', () => {
  it('actifs : racine en majuscules, sans doublon', () => {
    expect(normalizeAssets(['mnqz6', 'MNQ', 'mes', ' ES '])).toEqual(['MNQ', 'MES', 'ES']);
  });

  it('fusion : champ absent = inchangé, null = retiré', () => {
    const base = { ...EMPTY, maxTrades: 5, maxDailyLoss: 300 };
    expect(mergeRules(base, { maxTrades: 6, maxDailyLoss: null })).toEqual({ ...EMPTY, maxTrades: 6, maxDailyLoss: null });
  });

  it('trace : un changement par champ modifié, à l’instant donné', () => {
    const edits = editsBetween({ ...EMPTY, maxTrades: 5 }, { ...EMPTY, maxTrades: 6, allowedAssets: ['MNQ'] }, NOW);
    expect(edits).toEqual([
      { at: NOW.toISOString(), field: 'maxTrades', from: 5, to: 6 },
      { at: NOW.toISOString(), field: 'allowedAssets', from: [], to: ['MNQ'] },
    ]);
    expect(editsBetween({ ...EMPTY, maxTrades: 5 }, { ...EMPTY, maxTrades: 5 }, NOW)).toEqual([]);
  });
});

function setup(o: { contract?: object | null; status?: 'ACTIVE' | 'CLOSED'; last?: object | null; firmLimit?: number | null; free?: boolean } = {}) {
  const prisma = {
    tradeSession: { findFirst: vi.fn(async () => (o.status === undefined && o.contract === undefined ? null : { status: o.status ?? 'ACTIVE', contract: o.contract ?? null })) },
    sessionContract: {
      findFirst: vi.fn(async () => o.last ?? null),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({ ...create, createdAt: NOW, updatedAt: NOW })),
      create: vi.fn(async () => ({})),
    },
    user: { findUnique: vi.fn(async () => ({ tradesPerDayMax: 4, newsShieldMinutes: 0, tradingAssets: ['MNQ'], plan: o.free ? 'FREE' : 'PREMIUM', role: 'USER', trialEndsAt: null })) },
    tradingAccount: { findFirst: vi.fn(async () => ({ id: 'acc' })) },
  };
  const accounts = {
    accountWhere: vi.fn(async () => ({ accountId: 'acc' })),
    ensureDefaultAccountId: vi.fn(async () => 'acc'),
    findDefaultAccountId: vi.fn(async () => 'acc' as string | undefined),
    // Limite de Mes comptes (palier déjà résolu par AccountsService), jamais recalculée par le contrat.
    list: vi.fn(async () => [{ id: 'acc', metrics: { dailyLoss: o.firmLimit != null ? { limit: o.firmLimit } : null } }]),
  };
  return { svc: new SessionContractService(prisma as never, accounts as never), prisma };
}

describe('SessionContractService (#667)', () => {
  it('préremplissage : dernière séance du compte, perte max plus large que la firm signalée', async () => {
    const { svc } = setup({ last: { ...EMPTY, maxDailyLoss: 2500, session: { startedAt: NOW } }, firmLimit: 2000 });
    expect(await svc.defaults('u', 'acc', NOW)).toMatchObject({
      source: 'last_session', rules: { maxDailyLoss: 2500 }, firmDailyLossLimit: 2000, looserThanFirm: true,
    });
  });

  it('limite de la firm : celle de Mes comptes, Premium seulement (perte du jour #370)', async () => {
    const free = setup({ last: { ...EMPTY, maxDailyLoss: 2500, session: { startedAt: NOW } }, firmLimit: 2000, free: true });
    expect(await free.svc.defaults('u', 'acc', NOW)).toMatchObject({ firmDailyLossLimit: null, looserThanFirm: false });
    const accounts = (free.svc as unknown as { accounts: { list: ReturnType<typeof vi.fn> } }).accounts;
    expect(accounts.list).not.toHaveBeenCalled();
  });

  it('préremplissage du profil : bouclier coupé = pas de règle des annonces ; sans plan, rien à comparer', async () => {
    const { svc } = setup();
    expect(await svc.defaults('u', undefined, NOW)).toMatchObject({
      source: 'profile', rules: { maxTrades: 4, newsMinutes: null, allowedAssets: ['MNQ'] }, firmDailyLossLimit: null, looserThanFirm: false,
    });
  });

  it('préremplissage sans compte choisi : compte par défaut lu, jamais créé ; aucun compte : profil, compte à null', async () => {
    const { svc } = setup();
    const accounts = (svc as unknown as { accounts: { ensureDefaultAccountId: ReturnType<typeof vi.fn> } }).accounts;
    await svc.defaults('u', undefined, NOW);
    expect(accounts.ensureDefaultAccountId).not.toHaveBeenCalled();
    (svc as unknown as { accounts: { findDefaultAccountId: ReturnType<typeof vi.fn> } }).accounts.findDefaultAccountId.mockResolvedValue(undefined);
    expect(await svc.defaults('u', undefined, NOW)).toMatchObject({ accountId: null, source: 'profile', firmDailyLossLimit: null });
  });

  it('démarrage : rien d’enregistré flag éteint', async () => {
    const { svc, prisma } = setup();
    await svc.createForSession('u', 's', { maxTrades: 3 });
    expect(prisma.sessionContract.create).not.toHaveBeenCalled();
    process.env['SESSION_CONTRACT_ENABLED'] = 'true';
    await svc.createForSession('u', 's', { maxTrades: 3, allowedAssets: ['mnq'] });
    expect(prisma.sessionContract.create).toHaveBeenCalledWith({ data: expect.objectContaining({ maxTrades: 3, allowedAssets: ['MNQ'], edits: [] }) });
  });

  it('modification : séance introuvable 404, clôturée 400, plafond de 50 modifications', async () => {
    await expect(setup().svc.update('u', 's', { maxTrades: 2 }, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(setup({ status: 'CLOSED' }).svc.update('u', 's', { maxTrades: 2 }, NOW)).rejects.toMatchObject({ status: 400 });
    const full = { ...EMPTY, maxTrades: 5, edits: Array.from({ length: 50 }, () => ({ at: NOW.toISOString(), field: 'maxTrades', from: 5, to: 5 })) };
    await expect(setup({ contract: full }).svc.update('u', 's', { maxTrades: 6 }, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it('modification d’une séance sans contrat : création, trace depuis « non fixé »', async () => {
    const { svc } = setup({ status: 'ACTIVE', contract: null });
    const view = await svc.update('u', 's', { maxTrades: 2 }, NOW);
    expect(view.edits).toEqual([{ at: NOW.toISOString(), field: 'maxTrades', from: null, to: 2 }]);
  });

  it('évaluation : perte max du jour avec les trades du compte d’avant la séance, journée CME (bascule à 17 h Chicago)', async () => {
    process.env['SESSION_CONTRACT_ENABLED'] = 'true';
    // Séance démarrée à 18 h 30 ET (23 h 30 UTC) : la journée CME a commencé à 17 h Chicago (23 h UTC).
    const startedAt = new Date('2026-11-27T23:30:00.000Z');
    const row = { sessionId: 's', userId: 'u', ...EMPTY, maxDailyLoss: 300, edits: [], createdAt: startedAt, updatedAt: startedAt };
    const trades = [
      { id: 'veille', pnl: -500, commission: 0, tradedAt: new Date('2026-11-27T22:30:00.000Z') }, // journée précédente
      { id: 'avant', pnl: -250, commission: 2, tradedAt: new Date('2026-11-27T23:10:00.000Z') }, // même journée, autre séance
      { id: 's1', asset: 'MNQ', pnl: -60, commission: 0, tradedAt: new Date('2026-11-27T23:40:00.000Z') },
    ];
    const prisma = {
      sessionContract: { findUnique: vi.fn(async () => row) },
      trade: {
        findMany: vi.fn(async ({ where }: { where: { sessionId?: string; tradedAt: { gte: Date; lt?: Date } } }) =>
          where.sessionId
            ? trades.filter((t) => t.id === 's1')
            : trades.filter((t) => t.tradedAt >= where.tradedAt.gte && (!where.tradedAt.lt || t.tradedAt < where.tradedAt.lt))),
      },
    };
    const svc = new SessionContractService(prisma as never, {} as never);
    const out = await svc.forSession('u', { id: 's', accountId: 'acc', startedAt, endedAt: null }, new Date('2026-11-28T00:30:00.000Z'));
    expect(out?.evaluation.rules[0]).toMatchObject({ rule: 'maxDailyLoss', status: 'breached', breachTradeId: 's1', measure: -312 });
  });
});

