import { describe, it, expect, vi } from 'vitest';
import { PropRiskJournalService } from './prop-risk-journal.service';

function setup(prev: Record<string, unknown> | null) {
  const prisma = {
    accountRiskDay: { findUnique: vi.fn(async () => prev), upsert: vi.fn(async () => ({})) },
    propRiskEvent: { create: vi.fn(async () => ({})) },
  };
  return { svc: new PropRiskJournalService(prisma as never), prisma };
}
const NOW = new Date('2026-06-02T15:00:00.000Z');

describe('PropRiskJournalService.recordReading', () => {
  it('1er relevé : marges et plancher de début posés', async () => {
    const { svc, prisma } = setup(null);
    await svc.recordReading('a', '2026-06-02', { drawdownMargin: 1200, dailyLossRemaining: 700, floor: 48500 }, NOW);
    expect(prisma.accountRiskDay.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        accountId: 'a', tradeDate: new Date('2026-06-02T00:00:00.000Z'), floorStart: 48500, floorEnd: 48500,
        minDrawdownMargin: 1200, minDrawdownAt: NOW, minDailyLossRemaining: 700, minDailyLossAt: NOW,
      }),
    }));
  });

  it('relevé suivant : ne garde que les marges plus basses ; plancher de début inchangé, de fin à jour', async () => {
    const { svc, prisma } = setup({ minDrawdownMargin: 900, minDailyLossRemaining: 300, floorStart: 48500 });
    await svc.recordReading('a', '2026-06-02', { drawdownMargin: 1100, dailyLossRemaining: 250, floor: 48700 }, NOW);
    const update = (prisma.accountRiskDay.upsert.mock.calls[0] as unknown as [{ update: Record<string, unknown> }])[0].update;
    expect(update).toEqual({ minDailyLossRemaining: 250, minDailyLossAt: NOW, floorEnd: 48700 });
  });

  it('aucune marge connue : rien à retenir', async () => {
    const { svc, prisma } = setup(null);
    await svc.recordReading('a', '2026-06-02', { drawdownMargin: null, dailyLossRemaining: null, floor: null }, NOW);
    expect(prisma.accountRiskDay.upsert).not.toHaveBeenCalled();
  });
});

describe('PropRiskJournalService.recordEvent', () => {
  it('écrit l’événement sur la journée de trading', async () => {
    const { svc, prisma } = setup(null);
    await svc.recordEvent('u', 'a', '2026-06-02', 'tilt', 'revenge', { minutes: 1.2 });
    expect(prisma.propRiskEvent.create).toHaveBeenCalledWith({
      data: { userId: 'u', accountId: 'a', tradeDate: new Date('2026-06-02T00:00:00.000Z'), kind: 'tilt', level: 'revenge', data: { minutes: 1.2 } },
    });
  });
});
