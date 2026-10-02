import { describe, it, expect, vi } from 'vitest';
import { SessionService } from './session.service';

const session = (id: string, startedAt: string) => ({
  id, startedAt: new Date(startedAt), endedAt: null, moodStart: null, moodEnd: null, totalPnl: 10, totalTrades: 2,
  winRate: 50, notes: null, reflectionNote: null, reflectionQuestion: null, planNote: null, marketContext: null,
  maxDrawdown: null, bestTradePnl: null, bestTradeAsset: null, trades: [{ asset: 'NQ' }],
});

function serviceWith(rows: unknown[], recaps: unknown[]) {
  const recapFindMany = vi.fn().mockResolvedValue(recaps);
  const prisma = {
    tradeSession: { findMany: vi.fn().mockResolvedValue(rows) },
    dailyRecap: { findMany: recapFindMany },
  };
  return { service: new SessionService(prisma as never, {} as never, {} as never, {} as never), recapFindMany };
}

describe('SessionService.getSessionHistory — résumé IA du jour', () => {
  it('rattache à chaque session le résumé IA du récap du même jour (heure de Paris)', async () => {
    const { service } = serviceWith(
      [session('s1', '2026-09-24T07:30:00.000Z'), session('s2', '2026-09-25T07:30:00.000Z')],
      // Récap du 24 : minuit de Paris = 22:00 UTC la veille (heure d'été).
      [{ date: new Date('2026-09-23T22:00:00.000Z'), aiOneLiner: 'Belle discipline.' }],
    );
    const history = await service.getSessionHistory('u1');
    expect(history.find((h) => h.id === 's1')?.aiOneLiner).toBe('Belle discipline.');
    expect(history.find((h) => h.id === 's2')?.aiOneLiner).toBeNull();
  });

  it("aucune session → aucune requête sur les récaps", async () => {
    const { service, recapFindMany } = serviceWith([], []);
    await service.getSessionHistory('u1');
    expect(recapFindMany).not.toHaveBeenCalled();
  });
});
