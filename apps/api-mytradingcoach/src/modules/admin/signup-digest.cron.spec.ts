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
