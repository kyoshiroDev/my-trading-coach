/**
 * S2 (#1063) : `GET /ambassador/stats` renvoyait à l'ambassadeur (un tiers externe) l'id, le nom et
 * l'e-mail en clair de chaque filleul. Comme le parrainage grand public et le relevé PDF : pseudo
 * masqué. La vue admin (fiche ambassadeur) garde le détail.
 */
import { describe, it, expect, vi } from 'vitest';
import { AmbassadorService } from './ambassador.service';
import { freezeClock } from '../../test/freeze-clock';

function service() {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ referralCode: 'AMB' }),
      findMany: vi.fn().mockResolvedValue([{
        id: 'f1', name: 'Alice Martin', email: 'alice.martin@gmail.com', plan: 'FREE',
        createdAt: new Date('2026-11-01T10:00:00Z'), _count: { trades: 2 },
        stripeInterval: null, stripeSubscriptionStatus: null, founderSeat: null, partnerRedemption: null,
      }]),
    },
    referralCommission: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return new AmbassadorService(prisma as never);
}

describe('stats ambassadeur : filleuls masqués (S2 #1063)', () => {
  freezeClock('2026-11-16T10:00:00Z');
  it('vue ambassadeur : pseudo masqué, ni id, ni nom, ni e-mail', async () => {
    const stats = await service().getStats('amb');
    const [f] = stats.referrals;
    expect(f).toMatchObject({ pseudo: 'AL******', plan: 'FREE', isActive: true });
    expect(f).not.toHaveProperty('email');
    expect(f).not.toHaveProperty('name');
    expect(f).not.toHaveProperty('id');
    expect(JSON.stringify(stats)).not.toContain('alice');
  });

  it('vue admin : détail gardé (fiche ambassadeur)', async () => {
    const stats = await service().getStats('amb', 'admin');
    expect(stats.referrals[0]).toMatchObject({ id: 'f1', name: 'Alice Martin', email: 'alice.martin@gmail.com' });
  });
});
