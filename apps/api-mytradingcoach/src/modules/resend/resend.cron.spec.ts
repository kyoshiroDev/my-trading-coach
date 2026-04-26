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

  it('envoie un email à chaque user dont l\'abo expire dans 7 jours', async () => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    mockPrisma.user.findMany.mockResolvedValue([
      { email: 'a@test.com', name: 'Alice', stripeCurrentPeriodEnd: expiresAt },
      { email: 'b@test.com', name: 'Bob', stripeCurrentPeriodEnd: expiresAt },
    ]);

    await cron.checkRenewalReminders();

    expect(mockSendRenewal).toHaveBeenCalledTimes(2);
    expect(mockSendRenewal).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@test.com', userName: 'Alice' }),
    );
  });

  it('ne fait rien si aucun user n\'expire dans 7 jours', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await cron.checkRenewalReminders();
    expect(mockSendRenewal).not.toHaveBeenCalled();
  });

  it('requête Prisma filtre uniquement PREMIUM + notifActivées + expiration J+7', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await cron.checkRenewalReminders();

    const call = mockPrisma.user.findMany.mock.calls[0][0];
    expect(call.where.plan).toBe('PREMIUM');
    expect(call.where.notificationsEmail).toBe(true);
    expect(call.where.stripeCurrentPeriodEnd).toBeDefined();
  });
});
