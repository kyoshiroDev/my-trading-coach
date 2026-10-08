import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';
import { SignupDigestCron } from './signup-digest.cron';

const prisma = { user: { findMany: vi.fn() } };
const resend = { sendAdminAlert: vi.fn().mockResolvedValue(undefined) };
const cron = new SignupDigestCron(prisma as never, resend as never);
const NOW = new Date('2026-10-01T06:00:00Z'); // 8 h à Paris

beforeEach(() => vi.clearAllMocks());

describe('SignupDigestCron — un récap par jour au lieu d’un e-mail par inscription', () => {
  it('personne ne s’est inscrit → aucun e-mail', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    expect(await cron.sendDigest(NOW)).toBe(0);
    expect(resend.sendAdminAlert).not.toHaveBeenCalled();
  });

  it('plusieurs inscrits → un seul e-mail qui les liste tous', async () => {
    prisma.user.findMany.mockResolvedValue([
      { email: 'a@test.local', name: 'A', createdAt: new Date('2026-09-30T10:00:00Z') },
      { email: 'b@test.local', name: null, createdAt: new Date('2026-09-30T18:00:00Z') },
    ]);

    expect(await cron.sendDigest(NOW)).toBe(2);
    expect(resend.sendAdminAlert).toHaveBeenCalledTimes(1);
    const [subject, body] = resend.sendAdminAlert.mock.calls[0];
    expect(subject).toContain('2 inscriptions');
    expect(body).toContain('a@test.local');
    expect(body).toContain('b@test.local');
  });

  it('fenêtre des 24 dernières heures, sans compte démo ni admin', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await cron.sendDigest(NOW);
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      createdAt: { gte: new Date(NOW.getTime() - 24 * 3600_000), lt: NOW },
      isDemo: false,
      role: { not: Role.ADMIN },
    });
  });
});

describe('SignupDigestCron — offres (#525)', () => {
  const withOffers = (o: { taken: number; before: number }) => ({
    user: { findMany: vi.fn().mockResolvedValue([]) },
    founderOfferConfig: { findUnique: vi.fn().mockResolvedValue({ open: true }) },
    founderSeat: {
      count: vi.fn().mockImplementation(({ where }) =>
        Promise.resolve(where.takenAt ? o.before : o.taken)),
    },
    partnerCode: { findMany: vi.fn().mockResolvedValue([]) },
    partnerRedemption: { groupBy: vi.fn().mockResolvedValue([]) },
  });

  it('aucun inscrit mais un palier franchi → e-mail du palier avec la ligne fondateurs', async () => {
    const p = withOffers({ taken: 100, before: 97 });
    const c = new SignupDigestCron(p as never, resend as never);
    await c.sendDigest(NOW);
    const [subject, body] = resend.sendAdminAlert.mock.calls[0];
    expect(subject).toContain('palier atteint');
    expect(body).toContain('Fondateurs : 100 / 200');
    expect(body).toContain('Palier atteint : 100 places');
  });

  it('aucun inscrit, aucun palier → toujours aucun e-mail', async () => {
    const c = new SignupDigestCron(withOffers({ taken: 40, before: 40 }) as never, resend as never);
    expect(await c.sendDigest(NOW)).toBe(0);
    expect(resend.sendAdminAlert).not.toHaveBeenCalled();
  });
});
