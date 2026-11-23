import type { PropFirmPhaseRules } from '@mtc/shared';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MANUAL_PAYOUT_TYPE, manualPayoutError, summarizePayouts } from './account-payouts';
import { aggregateRuleTrades, sessionPnls } from './account-rules';
import { AccountsService, firstPayoutDay, type RulePlan } from './accounts.service';

const row = (id: string, day: string, amount: number, changeType = 'challengepayout', confidence = 'certain') =>
  ({ id, tradeDate: new Date(`${day}T00:00:00Z`), amount, changeType, confidence });

describe('summarizePayouts', () => {
  it('dernier payout, nombre, et total des seuls payouts saisis', () => {
    expect(summarizePayouts([
      row('m2', '2026-10-10', 800, MANUAL_PAYOUT_TYPE),
      row('b1', '2026-10-01', 1_000),
      row('m1', '2026-09-20', 500.555, MANUAL_PAYOUT_TYPE),
    ])).toMatchObject({ last: '2026-10-10', count: 3, lastId: 'm2', lastManual: true, manualTotal: 1_300.56 });
  });

  it('payout détecté en dernier : pas « manuel », total saisi à 0 sans payout saisi', () => {
    expect(summarizePayouts([row('b1', '2026-10-01', 1_000, 'manualadjustment', 'probable')]))
      .toMatchObject({ lastManual: false, manualTotal: 0, lastConfidence: 'probable' });
  });

  it('total arrondi par roundCents (comme Postgres) : 1 231,495 → 1 231,50, pas 1 231,49', () => {
    expect(summarizePayouts([row('b1', '2026-10-01', 1_231.495)])?.total).toBe(1_231.5);
  });

  it('aucun payout → null', () => {
    expect(summarizePayouts([])).toBeNull();
  });

  it('plus ancien payout : date du gel au premier payout (#696)', () => {
    expect(summarizePayouts([row('b2', '2026-10-10', 800), row('b1', '2026-10-01', 1_000)])?.first).toBe('2026-10-01');
  });
});

describe('manualPayoutError', () => {
  const today = '2026-10-21';
  it('accepte une date passée ou du jour et un montant positif', () => {
    expect(manualPayoutError({ tradeDate: '2026-10-21', amount: 500 }, today)).toBeNull();
    expect(manualPayoutError({ tradeDate: '2025-01-02', amount: 0.01 }, today)).toBeNull();
  });
  it('refuse une date future, une date invalide, un montant nul ou négatif', () => {
    expect(manualPayoutError({ tradeDate: '2026-10-22', amount: 500 }, today)).toMatch(/futur/);
    expect(manualPayoutError({ tradeDate: '2026-13-40', amount: 500 }, today)).toMatch(/invalide/);
    expect(manualPayoutError({ tradeDate: '21/10/2026', amount: 500 }, today)).toMatch(/invalide/);
    expect(manualPayoutError({ tradeDate: '2026-10-01', amount: 0 }, today)).toMatch(/supérieur à 0/);
    expect(manualPayoutError({ tradeDate: '2026-10-01', amount: -10 }, today)).toMatch(/supérieur à 0/);
  });
});

describe('métriques d\'un compte avec payouts saisis', () => {
  const svc = new AccountsService({} as never);
  const at = (pnl: number, iso: string) => ({ pnl, tradedAt: new Date(iso) });
  const funded: RulePlan = { firmName: 'Lucid Trading', planName: 'LucidFlex', accountSize: 50_000, phases: [
    { phase: 'funded', profit_target: null, consistency: null, min_trading_days: null,
      max_drawdown: { amount: 2_000, type: 'static', trails_on: 'balance', locks_at: null, locked_floor: null, basis_notes: null },
      payout: { min_days: 5, min_daily_profit: 150, min_cycle_profit: null, min_cycle_profit_schedule: null, safety_net_balance: null, min_amount: 500 },
    } as unknown as PropFirmPhaseRules,
  ] };
  const acc = { startingBalance: 50_000, accountSize: 50_000, profitTarget: null, maxDrawdown: null, drawdownType: 'STATIC' as const, type: 'FUNDED' as const, lastPayoutAt: null };
  // +3 000 $ de trades, puis un payout de 1 000 $ le 05/10.
  const trades = [at(1_500, '2026-10-01T15:00:00Z'), at(1_500, '2026-10-02T15:00:00Z')];
  const metrics = (payouts: Parameters<AccountsService['ruleMetricsFromAgg']>[8]) =>
    svc.ruleMetricsFromAgg(acc, aggregateRuleTrades(trades), funded, null, null, null, new Date('2026-10-06T15:00:00Z'), sessionPnls(trades), payouts);

  it('payout saisi : retiré du solde et de la marge (le plancher ne bouge pas)', () => {
    const m = metrics({ last: '2026-10-05', count: 1, lastId: 'm1', lastManual: true, manualTotal: 1_000 });
    expect(m.currentBalance).toBe(52_000);
    expect(m.drawdown).toMatchObject({ floor: 48_000, margin: 4_000 });
  });

  it('payout détecté chez le broker : pas retiré une seconde fois du solde calculé', () => {
    const m = metrics({ last: '2026-10-05', count: 1, lastId: 'b1', lastManual: false, manualTotal: 0 });
    expect(m.currentBalance).toBe(53_000);
  });

  it('le payout saisi démarre le cycle du prochain payout (source « manual », rien à écarter)', () => {
    expect(metrics({ last: '2026-10-05', count: 2, lastId: 'm1', lastManual: true, manualTotal: 1_000 }).progress)
      .toMatchObject({ cycleAfter: '2026-10-05', cycleSource: 'manual', payoutsReceived: 2, lastPayout: null });
  });
});

describe('gel du plancher au premier payout (#696)', () => {
  const svc = new AccountsService({} as never);
  const at = (pnl: number, iso: string) => ({ pnl, tradedAt: new Date(iso) });
  const now = new Date('2026-10-06T15:00:00Z');
  const phase = (md: Record<string, unknown>) =>
    ({
      phase: 'funded', profit_target: null, consistency: null, min_trading_days: null,
      max_drawdown: { amount: 2_000, type: 'trailing_eod', trails_on: 'balance', basis_notes: null, ...md },
      payout: { min_days: 5, min_daily_profit: 150, min_cycle_profit: null, min_cycle_profit_schedule: null, safety_net_balance: null, min_amount: 500 },
    }) as unknown as PropFirmPhaseRules;
  const plan = (md: Record<string, unknown>): RulePlan => ({ firmName: 'Lucid Trading', planName: 'LucidFlex', accountSize: 50_000, phases: [phase(md)] });
  const flex = plan({ locks_at: 52_100, locked_floor: 50_100, locks_on_first_payout: 'request' });
  const acc = (lastPayoutAt: Date | null = null) =>
    ({ startingBalance: 50_000, accountSize: 50_000, profitTarget: null, maxDrawdown: null, drawdownType: 'TRAILING' as const, type: 'FUNDED' as const, lastPayoutAt });
  const trades = [at(500, '2026-10-01T15:00:00Z')];
  const metrics = (p: RulePlan, payouts: Parameters<AccountsService['ruleMetricsFromAgg']>[8], a = acc(), t = trades) =>
    svc.ruleMetricsFromAgg(a, aggregateRuleTrades(t), p, null, null, null, now, sessionPnls(t), payouts);
  const detected = { last: '2026-10-05', first: '2026-10-02', count: 2, lastId: 'b2', lastManual: false, manualTotal: 0 };

  it('sans payout : plancher suiveur, non figé', () => {
    expect(metrics(flex, null).drawdown).toMatchObject({ floor: 48_500, rule: { locked: false, lockedBy: null, payoutLockedSince: null, locksOnFirstPayout: 'request' } });
  });

  it('payout détecté : figé à départ + 100 depuis le premier payout', () => {
    expect(metrics(flex, detected).drawdown).toMatchObject({ floor: 50_100, rule: { locked: true, lockedBy: 'payout', payoutLockedSince: '2026-10-02' } });
  });

  it('payout saisi à la main : même gel', () => {
    const manual = { last: '2026-10-03', first: '2026-10-03', count: 1, lastId: 'm1', lastManual: true, manualTotal: 1_000 };
    expect(metrics(flex, manual).drawdown).toMatchObject({ floor: 50_100, rule: { lockedBy: 'payout', payoutLockedSince: '2026-10-03' } });
  });

  it('seule la date saisie du dernier payout : gelé à cette date', () => {
    expect(metrics(flex, null, acc(new Date('2026-10-04T00:00:00Z'))).drawdown).toMatchObject({ floor: 50_100, rule: { payoutLockedSince: '2026-10-04' } });
  });

  it('date de payout future : pas de gel', () => {
    expect(metrics(flex, null, acc(new Date('2026-10-20T00:00:00Z'))).drawdown).toMatchObject({ floor: 48_500, rule: { locked: false } });
  });

  it('seuil atteint : figé par le seuil, pas par le payout', () => {
    const big = [at(2_500, '2026-10-01T15:00:00Z')];
    expect(metrics(flex, detected, acc(), big).drawdown).toMatchObject({ floor: 50_100, rule: { lockedBy: 'threshold', payoutLockedSince: null } });
  });

  it('plan sans la règle : un payout ne fige rien', () => {
    const plain = plan({ locks_at: 52_100, locked_floor: 50_100 });
    expect(metrics(plain, detected).drawdown).toMatchObject({ floor: 48_500, rule: { locked: false, locksOnFirstPayout: null } });
  });

  it('MFF Pro (pas de locks_at) : niveau figé exposé, gel au payout sans jamais baisser le plancher', () => {
    const pro = plan({ locks_at: null, locked_floor: 50_100, locks_on_first_payout: 'approval' });
    expect(metrics(pro, null).drawdown).toMatchObject({ floor: 48_500, rule: { lockedFloor: 50_100, locked: false } });
    expect(metrics(pro, detected).drawdown).toMatchObject({ floor: 50_100, rule: { lockedBy: 'payout' } });
    const high = [at(3_000, '2026-10-01T15:00:00Z')];
    expect(metrics(pro, detected, acc(), high).drawdown).toMatchObject({ floor: 51_000, rule: { lockedBy: 'payout' } });
  });

  it('firstPayoutDay : minimum des dates connues ≤ aujourd’hui', () => {
    expect(firstPayoutDay(detected, new Date('2026-09-30T00:00:00Z'), '2026-10-06')).toBe('2026-09-30');
    expect(firstPayoutDay(null, null, '2026-10-06')).toBeNull();
    expect(firstPayoutDay({ last: '2026-10-09', count: 1 }, null, '2026-10-06')).toBeNull();
  });
});

describe('AccountsService — payouts saisis à la main', () => {
  function makePrisma() {
    return {
      tradingAccount: { findUnique: vi.fn(async () => ({ id: 'a1', userId: 'u1', type: 'FUNDED' })) },
      brokerConnection: { count: vi.fn(async () => 0) },
      brokerPayout: {
        create: vi.fn(async ({ data }: { data: { amount: number } }) => ({ id: 'p1', amount: data.amount })),
        deleteMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [
          { id: 'm1', tradeDate: new Date('2026-10-05T00:00:00Z'), amount: 1_000, changeType: MANUAL_PAYOUT_TYPE, confidence: 'certain' },
          { id: 'b1', tradeDate: new Date('2026-09-01T00:00:00Z'), amount: 700, changeType: 'manualadjustment', confidence: 'probable' },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
  }
  let prisma: ReturnType<typeof makePrisma>;
  let svc: AccountsService;
  beforeEach(() => {
    prisma = makePrisma();
    svc = new AccountsService(prisma as never);
  });

  it('ajout : payout de type « manual », date et montant arrondi au centime', async () => {
    const res = await svc.addManualPayout('u1', 'a1', { tradeDate: '2026-10-05', amount: 1_000.004 }, '2026-10-21');
    const data = (prisma.brokerPayout.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ accountId: 'a1', changeType: MANUAL_PAYOUT_TYPE, amount: 1_000, confidence: 'certain' });
    expect(String(data['transactionId'])).toMatch(/^manual:/);
    expect((data['tradeDate'] as Date).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(res).toMatchObject({ tradeDate: '2026-10-05', amount: 1_000, manual: true });
  });

  it('compte connecté au broker → 409 (payouts détectés, sinon comptés deux fois)', async () => {
    prisma.brokerConnection.count.mockResolvedValueOnce(1);
    await expect(svc.addManualPayout('u1', 'a1', { tradeDate: '2026-10-05', amount: 500 }, '2026-10-21'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.brokerPayout.create).not.toHaveBeenCalled();
  });

  it('compte non funded → 400 ; date future → 400 ; compte d\'un autre utilisateur → 404', async () => {
    prisma.tradingAccount.findUnique.mockResolvedValueOnce({ id: 'a1', userId: 'u1', type: 'EVALUATION' });
    await expect(svc.addManualPayout('u1', 'a1', { tradeDate: '2026-10-05', amount: 500 }, '2026-10-21'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addManualPayout('u1', 'a1', { tradeDate: '2026-10-22', amount: 500 }, '2026-10-21'))
      .rejects.toBeInstanceOf(BadRequestException);
    prisma.tradingAccount.findUnique.mockResolvedValueOnce({ id: 'a1', userId: 'autre', type: 'FUNDED' });
    await expect(svc.addManualPayout('u1', 'a1', { tradeDate: '2026-10-05', amount: 500 }, '2026-10-21'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.brokerPayout.create).not.toHaveBeenCalled();
  });

  it('suppression : seulement un payout saisi (404 sinon)', async () => {
    await svc.removeManualPayout('u1', 'a1', 'm1');
    expect(prisma.brokerPayout.deleteMany).toHaveBeenCalledWith({ where: { id: 'm1', accountId: 'a1', changeType: MANUAL_PAYOUT_TYPE } });
    prisma.brokerPayout.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.removeManualPayout('u1', 'a1', 'b1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('liste : payouts saisis et détectés, marqués, du plus récent au plus ancien', async () => {
    expect(await svc.listPayouts('u1', 'a1')).toEqual([
      { id: 'm1', tradeDate: '2026-10-05', amount: 1_000, manual: true, confidence: 'certain' },
      { id: 'b1', tradeDate: '2026-09-01', amount: 700, manual: false, confidence: 'probable' },
    ]);
  });

  it('« ce n\'était pas un payout » ne s\'applique pas à un payout saisi', async () => {
    await svc.dismissPayout('u1', 'a1', 'b1');
    expect(prisma.brokerPayout.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ changeType: { not: MANUAL_PAYOUT_TYPE } }),
    }));
  });
});
