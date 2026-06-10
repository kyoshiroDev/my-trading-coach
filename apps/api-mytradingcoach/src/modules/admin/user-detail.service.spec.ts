import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { UserDetailService } from './user-detail.service';
import { PrismaService } from '../../prisma/prisma.service';

const DAY = 86_400_000;

describe('UserDetailService', () => {
  let service: UserDetailService;
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn> };
    userDailyActivity: { findMany: ReturnType<typeof vi.fn> };
    aiUsageLog: { groupBy: ReturnType<typeof vi.fn> };
    tradeSession: { findMany: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: vi.fn() },
      userDailyActivity: { findMany: vi.fn().mockResolvedValue([]) },
      aiUsageLog: { groupBy: vi.fn().mockResolvedValue([]) },
      tradeSession: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new UserDetailService(prisma as unknown as PrismaService);
  });

  it('404 si utilisateur introuvable', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getUserDetail('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('agrège IA par feature (triées desc), active days, sessions, ref ambassadeur', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', name: 'Val', email: 'val@test.com', plan: 'PREMIUM', role: 'AMBASSADOR',
      stripeSubscriptionStatus: 'active', referralCode: 'VAL',
      createdAt: new Date(Date.now() - 10 * DAY), lastSeenAt: new Date(),
    });
    prisma.userDailyActivity.findMany.mockResolvedValue([
      { date: new Date('2026-06-01T00:00:00Z') },
      { date: new Date('2026-06-02T00:00:00Z') },
      { date: new Date('2026-06-05T00:00:00Z') },
    ]);
    prisma.aiUsageLog.groupBy.mockResolvedValue([
      { feature: 'chat', _sum: { inputTokens: 100, outputTokens: 50, costUsd: 0.2 } },
      { feature: 'eco_calendar', _sum: { inputTokens: 1000, outputTokens: 200, costUsd: 2.5 } },
    ]);
    prisma.tradeSession.findMany
      .mockResolvedValueOnce([
        { startedAt: new Date('2026-06-05T09:00:00Z'), endedAt: new Date('2026-06-05T10:30:00Z'), totalTrades: 3, totalPnl: 120, winRate: 66, moodStart: 'FOCUSED', moodEnd: 'CONFIDENT' },
      ])
      .mockResolvedValueOnce([
        { startedAt: new Date('2026-06-05T09:00:00Z'), endedAt: new Date('2026-06-05T10:30:00Z') },
      ]);

    const r = await service.getUserDetail('u1');

    expect(r.kpis.activeDays).toBe(3);
    expect(r.kpis.activeDays).toBe(r.activeDates.length);
    expect(r.activeDates).toEqual(['2026-06-01', '2026-06-02', '2026-06-05']);
    // tri desc par tokens : eco_calendar (1200) avant chat (150)
    expect(r.aiByFeature.map((f) => f.feature)).toEqual(['eco_calendar', 'chat']);
    expect(r.kpis.ai.tokens).toBe(1350);
    expect(r.kpis.ai.usd).toBeCloseTo(2.7, 5);
    expect(r.identity.ambassadorRefCode).toBe('VAL');
    expect(r.sessions[0]).toMatchObject({ trades: 3, pnl: 120, winRate: 66, emotion: 'CONFIDENT', durationMinutes: 90 });
    expect(r.kpis.sessionTimeMinutes).toBe(90);
  });

  it('FREE sans IA ni session : ai à zéro, listes vides, pas de ref pill', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u2', name: null, email: 'free@test.com', plan: 'FREE', role: 'USER',
      stripeSubscriptionStatus: null, referralCode: null,
      createdAt: new Date(Date.now() - 3 * DAY), lastSeenAt: null,
    });

    const r = await service.getUserDetail('u2');

    expect(r.kpis.ai).toEqual({ usd: 0, tokens: 0 });
    expect(r.aiByFeature).toEqual([]);
    expect(r.kpis.activeDays).toBe(0);
    expect(r.activeDates).toEqual([]);
    expect(r.sessions).toEqual([]);
    expect(r.kpis.sessionTimeMinutes).toBeNull();
    expect(r.identity.ambassadorRefCode).toBeNull();
    expect(r.kpis.lastConnection).toBeNull();
  });
});