import { afterEach, describe, it, expect, vi } from 'vitest';
import { BehaviorSignalsService } from './behavior-signals.service';

const AT = new Date('2026-11-24T15:10:00Z');

function setup(opts: { demo?: boolean; last?: object | null } = {}) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ isDemo: !!opts.demo })) },
    trade: { findFirst: vi.fn(async () => (opts.last === undefined ? { tradedAt: new Date('2026-11-24T15:02:00Z'), pnl: -100, commission: 2 } : opts.last)) },
    behaviorAlert: { create: vi.fn(async (a: { data: Record<string, unknown> }) => (created.push(a.data), {})) },
  };
  return { svc: new BehaviorSignalsService(prisma as never), created, prisma };
}
const trade = { id: 't9', accountId: 'a', emotion: 'REVENGE', tradedAt: AT };

afterEach(() => {
  delete process.env['BEHAVIOR_ALERTS_RECORD'];
});

describe('BehaviorSignalsService.recordEmotionAfterLoss (#671)', () => {
  it('enregistre F1 sur le trade, journée CME, jamais émis', async () => {
    const { svc, created, prisma } = setup();
    expect(await svc.recordEmotionAfterLoss('u', trade)).toBe(true);
    expect(created[0]).toMatchObject({ userId: 'u', accountId: 'a', tradeId: 't9', type: 'F1_EMOTION_AFTER_LOSS', tradeDay: new Date('2026-11-24T00:00:00.000Z') });
    expect(prisma.trade.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: 't9' }, accountId: 'a' }) }));
  });

  it('compte démo, pas de perte avant, enregistrement coupé : rien', async () => {
    expect(await setup({ demo: true }).svc.recordEmotionAfterLoss('u', trade)).toBe(false);
    expect(await setup({ last: null }).svc.recordEmotionAfterLoss('u', trade)).toBe(false);
    process.env['BEHAVIOR_ALERTS_RECORD'] = 'false';
    expect(await setup().svc.recordEmotionAfterLoss('u', trade)).toBe(false);
  });

  it('erreur de base : jamais propagée', async () => {
    const { svc, prisma } = setup();
    prisma.behaviorAlert.create.mockRejectedValueOnce(new Error('db'));
    await expect(svc.recordEmotionAfterLoss('u', trade)).resolves.toBe(false);
  });
});
