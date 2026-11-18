import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersService } from './users.service';
import { freezeClock } from '../../test/freeze-clock';
import { subscriptionStateWhere, subscriptionStatesWhere } from '../../common/stats/subscription-state-where';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AmbassadorService } from '../ambassador/ambassador.service';

/**
 * Page Abonnements de l'admin (#1065) :
 * - A8 : seules 20 lignes revenaient et le KPI « Stripe actifs » comptait ces 20 lignes ;
 * - A9 : un abonné résilié (fin programmée) s'affichait « actif » avec une date de renouvellement ;
 * - A10 : « Accès manuels » exigeait le plan PREMIUM (bêta-testeurs FREE absents, ADMIN présent),
 *   et les abonnements en pause n'apparaissaient nulle part.
 */
const NOW = new Date('2026-11-18T12:00:00.000Z');
const prisma = { user: { findMany: vi.fn(), count: vi.fn() } };
const service = new UsersService(prisma as unknown as PrismaService, {} as AmbassadorService, {} as never);

freezeClock(NOW);
beforeEach(() => {
  vi.resetAllMocks();
  prisma.user.findMany.mockResolvedValue([]);
  prisma.user.count.mockResolvedValue(57);
});

const callWhere = (pred: (w: unknown) => boolean) =>
  prisma.user.findMany.mock.calls.map((c) => c[0]).find((a) => pred(a.where));

describe('UsersService.adminSubscriptions (#1065)', () => {
  it('A8 : renvoie le total des abonnés payants (KPI), pas seulement la page', async () => {
    const res = await service.adminSubscriptions(2, 20);
    expect(res.stripeTotal).toBe(57);
    expect(res.page).toBe(2);
  });

  it('A9 : la fin programmée et le statut Stripe sont lus pour les abonnés payants', async () => {
    await service.adminSubscriptions();
    const paying = callWhere((w) => JSON.stringify(w).includes('"stripeSubscriptionStatus":"active"'));
    expect(paying.select.stripeCancelAt).toBe(true);
    expect(paying.select.stripeSubscriptionStatus).toBe(true);
  });

  it('A10 : accès manuels = état « rôle » (bêta) ou « manuel », jamais un ADMIN', async () => {
    await service.adminSubscriptions();
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ isDemo: false }, { role: { not: 'ADMIN' } }, subscriptionStatesWhere(['role', 'manual'], NOW)] },
    }));
  });

  it('A10 : abonnements en pause listés à part', async () => {
    prisma.user.findMany.mockImplementation(async (a: { where: unknown }) =>
      JSON.stringify(a.where) === JSON.stringify({ isDemo: false, ...subscriptionStateWhere('paused', NOW) }) ? [{ id: 'p1' }] : []);
    const res = await service.adminSubscriptions();
    expect(res.pausedUsers).toEqual([{ id: 'p1' }]);
  });
});
