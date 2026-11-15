/**
 * A4 (#1013) : une commission `canceled` (1er paiement du filleul remboursé) ne compte nulle part :
 * ni gains, ni « à verser », ni relevé, et l'admin ne peut pas la marquer payée.
 */
import { describe, it, expect, vi } from 'vitest';
import { AmbassadorService } from './ambassador.service';
import { ReferralService } from '../referral/referral.service';
import { AdminService } from '../admin/admin.service';

const NOT_CANCELED = { not: 'canceled' };

describe('commission annulée exclue partout (A4)', () => {
  it('stats de l’ambassadeur : commissions lues sans les annulées', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ referralCode: 'AMB' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      referralCommission: { findMany: vi.fn().mockResolvedValue([]) },
    };
    await new AmbassadorService(prisma as never).getStats('amb');
    expect(prisma.referralCommission.findMany.mock.calls[0][0].where).toEqual({ ambassadorId: 'amb', status: NOT_CANCELED });
  });

  it('liste des ambassadeurs : totaux sans les annulées', async () => {
    const prisma = {
      user: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    };
    await new AmbassadorService(prisma as never).listAmbassadors();
    expect(prisma.user.findMany.mock.calls[0][0].select.referrals.where).toEqual({ status: NOT_CANCELED });
  });

  it('stats admin de parrainage : totaux sans les annulées', async () => {
    const prisma = { user: { findMany: vi.fn().mockResolvedValue([]) } };
    await new AdminService(prisma as never, {} as never, {} as never).getReferralStats();
    expect(prisma.user.findMany.mock.calls[0][0].select.referrals.where).toEqual({ status: NOT_CANCELED });
  });

  it('relevé PDF : sans les annulées', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ name: 'A', email: 'a@t.com' }), findMany: vi.fn().mockResolvedValue([]) },
      referralCommission: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const svc = new ReferralService(prisma as never, {} as never, {} as never);
    await svc.generateStatement('amb').catch(() => undefined);
    expect(prisma.referralCommission.findMany.mock.calls[0][0].where).toMatchObject({ ambassadorId: 'amb', status: NOT_CANCELED });
  });

  it('admin « marquer payée » : jamais une commission annulée', async () => {
    const prisma = { referralCommission: { update: vi.fn().mockResolvedValue({}) } };
    await new AdminService(prisma as never, {} as never, {} as never).markCommissionPaid('c1');
    expect(prisma.referralCommission.update.mock.calls[0][0].where).toEqual({ id: 'c1', status: NOT_CANCELED });
  });
});
