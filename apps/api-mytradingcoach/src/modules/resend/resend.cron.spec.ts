import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ResendCron } from './resend.cron';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from './resend.service';

const mockSendRenewal = vi.fn().mockResolvedValue(undefined);

const mockPrisma = {
  user: { findMany: vi.fn() },
};

const mockResend = {
  sendRenewalReminder: mockSendRenewal,
};

describe('ResendCron', () => {
  let cron: ResendCron;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        ResendCron,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ResendService, useValue: mockResend },
      ],
    }).compile();

    cron = module.get(ResendCron);
  });

  it("envoie un email à chaque user dont l'abo expire dans 7 jours", async () => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    mockPrisma.user.findMany.mockResolvedValue([
      { email: 'a@test.com', name: 'Alice', stripeCancelAt: expiresAt },
      { email: 'b@test.com', name: 'Bob', stripeCancelAt: expiresAt },
    ]);

    await cron.checkRenewalReminders();

    expect(mockSendRenewal).toHaveBeenCalledTimes(2);
    expect(mockSendRenewal).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@test.com', userName: 'Alice' }),
    );
  });

  // A2 (#1013, décision du 14/11) : le rappel « tu passeras au gratuit » partait chaque mois à tout
  // abonné mensuel qui se renouvelle (et aux réservations fondateur). Seulement une fin RÉELLE :
  // résiliation programmée (`stripeCancelAt`), mensuel comme annuel.
  it('cible la fin réelle (stripeCancelAt à J+7), plus la date de renouvellement', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await cron.checkRenewalReminders();
    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where.stripeCancelAt).toEqual({ gte: expect.any(Date), lte: expect.any(Date) });
    expect(where.stripeCurrentPeriodEnd).toBeUndefined();
    expect(where.OR).toBeUndefined(); // annuels résiliés compris (aucun invoice.upcoming pour eux)
  });

  it('date de fin passée à l’e-mail = stripeCancelAt', async () => {
    const end = new Date('2026-11-22T10:00:00Z');
    mockPrisma.user.findMany.mockResolvedValue([{ email: 'a@test.com', name: 'A', stripeCancelAt: end }]);
    await cron.checkRenewalReminders();
    expect(mockSendRenewal).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: end }));
  });

  it("ne fait rien si aucun user n'expire dans 7 jours", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await cron.checkRenewalReminders();
    expect(mockSendRenewal).not.toHaveBeenCalled();
  });

  it('requête Prisma filtre uniquement PREMIUM + notifActivées + fin programmée à J+7', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await cron.checkRenewalReminders();

    const call = mockPrisma.user.findMany.mock.calls[0][0];
    expect(call.where.plan).toBe('PREMIUM');
    expect(call.where.notificationsEmail).toBe(true);
    expect(call.where.stripeCancelAt).toBeDefined();
  });
});
