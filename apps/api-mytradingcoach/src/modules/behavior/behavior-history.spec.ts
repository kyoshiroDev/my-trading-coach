import { describe, it, expect, vi } from 'vitest';
import { freezeClock } from '../../test/freeze-clock';
import { alertAftermath } from './behavior-history';
import { BehaviorHistoryService } from './behavior-history.service';

// Mardi 24/11/2026, séance CME du jour (15:00 UTC = 9:00 CT).
const NOW = new Date('2026-11-24T21:00:00Z');
freezeClock(NOW);
const t = (iso: string, pnl: number, accountId = 'a', commission = 2) => ({ accountId, tradedAt: new Date(iso), pnl, commission });

describe('alertAftermath (#671)', () => {
  it('trades clôturés après l’alerte, jusqu’à l’alerte suivante du même compte, P&L net', () => {
    const alerts = [
      { id: 'x1', accountId: 'a', createdAt: new Date('2026-11-24T15:00:00Z') },
      { id: 'x2', accountId: 'a', createdAt: new Date('2026-11-24T16:00:00Z') },
    ];
    const trades = [
      t('2026-11-24T14:59:00Z', -50), // avant : ignoré
      t('2026-11-24T15:10:00Z', -100),
      t('2026-11-24T15:40:00Z', 40),
      t('2026-11-24T16:30:00Z', -30),
      t('2026-11-24T15:20:00Z', 500, 'b'), // autre compte
    ];
    const after = alertAftermath(alerts, trades);
    expect(after.get('x1')).toEqual({ count: 2, pnl: -64 });
    expect(after.get('x2')).toEqual({ count: 1, pnl: -32 });
  });

  it('séance suivante (autre journée CME) : pas compté', () => {
    const after = alertAftermath(
      [{ id: 'x', accountId: 'a', createdAt: new Date('2026-11-24T20:00:00Z') }],
      [t('2026-11-25T15:00:00Z', -100)],
    );
    expect(after.get('x')).toEqual({ count: 0, pnl: 0 });
  });

  it('trade sans P&L (ouvert) : ignoré', () => {
    const after = alertAftermath(
      [{ id: 'x', accountId: 'a', createdAt: new Date('2026-11-24T15:00:00Z') }],
      [{ accountId: 'a', tradedAt: new Date('2026-11-24T15:30:00Z'), pnl: null, commission: 0 }],
    );
    expect(after.get('x')).toEqual({ count: 0, pnl: 0 });
  });
});

describe('BehaviorHistoryService.list (#671)', () => {
  it('hors types signal et comptes perdus ; ce qui a suivi par alerte', async () => {
    const prisma = {
      behaviorAlert: {
        findMany: vi.fn(async () => [{
          id: 'x1', accountId: 'a', type: 'B_REVENGE', severity: 'medium', message: 'm', createdAt: new Date('2026-11-24T15:00:00Z'), mutedByUser: false,
        }]),
      },
      trade: { findMany: vi.fn(async () => [t('2026-11-24T15:10:00Z', -100)]) },
    };
    const res = await new BehaviorHistoryService(prisma as never).list('u', '2026-11-23', '2026-11-29');
    const where = (prisma.behaviorAlert.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where['type']).toEqual({ notIn: ['F1_EMOTION_AFTER_LOSS'] });
    expect(where['account']).toEqual({ status: { notIn: ['FAILED', 'ARCHIVED'] } });
    expect(res).toEqual([{
      id: 'x1', accountId: 'a', type: 'B_REVENGE', severity: 'medium', message: 'm',
      createdAt: '2026-11-24T15:00:00.000Z', mutedByUser: false, after: { count: 1, pnl: -102 },
    }]);
  });

  it('aucune alerte : aucune lecture des trades', async () => {
    const prisma = { behaviorAlert: { findMany: vi.fn(async () => []) }, trade: { findMany: vi.fn() } };
    expect(await new BehaviorHistoryService(prisma as never).list('u', '2026-11-23', '2026-11-29')).toEqual([]);
    expect(prisma.trade.findMany).not.toHaveBeenCalled();
  });
});
