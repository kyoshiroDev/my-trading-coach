import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersService } from './users.service';
import { freezeClock } from '../../test/freeze-clock';
import { subscriptionStateWhere, subscriptionStatesWhere } from '../../common/stats/subscription-state-where';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AmbassadorService } from '../ambassador/ambassador.service';
import { isDeepStrictEqual } from 'node:util';

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
    // Plus de `total` (#1102) : l'admin ne le lit plus, il mêlait payants et accès manuels.
    expect(res).not.toHaveProperty('total');
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

  // #1102 : la liste des accès manuels n'avait pas de limite, contrairement aux essais et aux pauses.
  it('accès manuels bornés comme les essais et les pauses (200 au plus, les plus récents)', async () => {
    await service.adminSubscriptions();
    const manual = callWhere((w) => isDeepStrictEqual(w, {
      AND: [{ isDemo: false }, { role: { not: 'ADMIN' } }, subscriptionStatesWhere(['role', 'manual'], NOW)],
    }));
    expect(manual.take).toBe(200);
    expect(manual.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('A10 : abonnements en pause listés à part', async () => {
    prisma.user.findMany.mockImplementation(async (a: { where: unknown }) =>
      isDeepStrictEqual(a.where, { isDemo: false, role: { not: 'ADMIN' }, ...subscriptionStateWhere('paused', NOW) }) ? [{ id: 'p1' }] : []);
    const res = await service.adminSubscriptions();
    expect(res.pausedUsers).toEqual([{ id: 'p1' }]);
  });

  // Relecteur (#1065), règle 9 de plans.md : comme les accès manuels et le MRR (REAL_USERS_WHERE), les
  // payants, leur total (KPI « Stripe actifs ») et les comptes en pause excluent les ADMIN.
  it('payants, total et pause : jamais un ADMIN', async () => {
    await service.adminSubscriptions();
    const paying = callWhere((w) => JSON.stringify(w).includes('"stripeSubscriptionStatus":"active"'));
    expect(paying.where.role).toEqual({ not: 'ADMIN' });
    // Le KPI compte exactement les comptes de la liste.
    expect(prisma.user.count).toHaveBeenCalledWith({ where: paying.where });
  });

  it('essais et offerts : jamais un ADMIN', async () => {
    await service.adminSubscriptions();
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ isDemo: false }, { role: { not: 'ADMIN' } }, subscriptionStatesWhere(['signup_trial', 'subscription_trial', 'offered'], NOW)] },
    }));
  });
});
