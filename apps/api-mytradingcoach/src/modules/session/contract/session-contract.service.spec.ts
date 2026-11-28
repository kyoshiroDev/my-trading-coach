import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionContractService, editsBetween, mergeRules, normalizeAssets } from './session-contract.service';

const NOW = new Date('2026-11-27T16:02:00.000Z');
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

function setup(o: { contract?: object | null; status?: 'ACTIVE' | 'CLOSED'; last?: object | null; phases?: unknown[]; type?: string } = {}) {
  const prisma = {
    tradeSession: { findFirst: vi.fn(async () => (o.status === undefined && o.contract === undefined ? null : { status: o.status ?? 'ACTIVE', contract: o.contract ?? null })) },
    sessionContract: {
      findFirst: vi.fn(async () => o.last ?? null),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({ ...create, createdAt: NOW, updatedAt: NOW })),
      create: vi.fn(async () => ({})),
    },
    user: { findUnique: vi.fn(async () => ({ tradesPerDayMax: 4, newsShieldMinutes: 0, tradingAssets: ['MNQ'] })) },
    tradingAccount: { findFirst: vi.fn(async () => ({ type: o.type ?? 'EVALUATION', propFirmPlan: o.phases ? { phases: o.phases } : null })) },
    trade: { aggregate: vi.fn(async () => ({ _sum: { pnl: 0, commission: 0 } })) },
  };
  const accounts = { accountWhere: vi.fn(async () => ({ accountId: 'acc' })), ensureDefaultAccountId: vi.fn(async () => 'acc') };
  return { svc: new SessionContractService(prisma as never, accounts as never), prisma };
}

describe('SessionContractService (#667)', () => {
  it('préremplissage : dernière séance du compte, perte max plus large que la firm signalée', async () => {
    const phases = [{ phase: 'evaluation', daily_loss_limit: { amount: 2000 } }];
    const { svc } = setup({ last: { ...EMPTY, maxDailyLoss: 2500, session: { startedAt: NOW } }, phases });
    expect(await svc.defaults('u', 'acc', NOW)).toMatchObject({
      source: 'last_session', rules: { maxDailyLoss: 2500 }, firmDailyLossLimit: 2000, looserThanFirm: true,
    });
  });

  it('préremplissage du profil : bouclier coupé = pas de règle des annonces ; sans plan, rien à comparer', async () => {
    const { svc } = setup();
    expect(await svc.defaults('u', undefined, NOW)).toMatchObject({
      source: 'profile', rules: { maxTrades: 4, newsMinutes: null, allowedAssets: ['MNQ'] }, firmDailyLossLimit: null, looserThanFirm: false,
    });
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
});
