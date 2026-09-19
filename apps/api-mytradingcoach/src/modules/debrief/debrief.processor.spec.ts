import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { DebriefProcessor } from './debrief.processor';

const mockService = { generateForUser: vi.fn() };
const mockPrisma = {
  user: { findUnique: vi.fn() },
  // Devise de l'email = celle des comptes (PROMPT-214).
  tradingAccount: { findMany: vi.fn().mockResolvedValue([{ currency: 'USD' }]) },
};
const mockResend = { sendDebriefReady: vi.fn() };

const proc = new DebriefProcessor(
  mockService as never,
  mockPrisma as never,
  mockResend as never,
);

const job = (data: unknown) => ({ data }) as Job;
const DEBRIEF = { weekNumber: 26, stats: { winRate: 50, totalPnl: 10, totalTrades: 2 } };

describe('DebriefProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ email: 'a@b.c', name: 'A', notificationsEmail: true });
  });

  it('débrief créé + notificationsEmail → envoie l\'email', async () => {
    mockService.generateForUser.mockResolvedValue({ debrief: DEBRIEF, created: true });

    await proc.process(job({ userId: 'u1' }));

    expect(mockResend.sendDebriefReady).toHaveBeenCalledOnce();
  });

  it('débrief déjà existant (created=false) → PAS d\'email (idempotence)', async () => {
    mockService.generateForUser.mockResolvedValue({ debrief: DEBRIEF, created: false });

    await proc.process(job({ userId: 'u1' }));

    expect(mockResend.sendDebriefReady).not.toHaveBeenCalled();
  });

  it('créé mais notificationsEmail=false → pas d\'email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ email: 'a@b.c', name: 'A', notificationsEmail: false });
    mockService.generateForUser.mockResolvedValue({ debrief: DEBRIEF, created: true });

    await proc.process(job({ userId: 'u1' }));

    expect(mockResend.sendDebriefReady).not.toHaveBeenCalled();
  });

  it('propage refDate et force au service', async () => {
    mockService.generateForUser.mockResolvedValue({ debrief: DEBRIEF, created: true });

    await proc.process(job({ userId: 'u1', refDate: '2026-06-22T12:00:00.000Z', force: true }));

    expect(mockService.generateForUser).toHaveBeenCalledWith('u1', {
      refDate: new Date('2026-06-22T12:00:00.000Z'),
      force: true,
    });
  });
});
