import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getAiUsage() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);

    const [todayLogs, weekLogs] = await Promise.all([
      this.prisma.aiUsageLog.findMany({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.aiUsageLog.findMany({
        where: { createdAt: { gte: startOfWeek } },
        include: { user: { select: { email: true, name: true } } },
      }),
    ]);

    const sum = (logs: typeof todayLogs) => ({
      inputTokens:  logs.reduce((a, l) => a + l.inputTokens, 0),
      outputTokens: logs.reduce((a, l) => a + l.outputTokens, 0),
      costUsd:      logs.reduce((a, l) => a + l.costUsd, 0),
      calls:        logs.length,
    });

    // By feature
    const featureMap = new Map<string, { tokens: number; cost: number }>();
    const weekTotal = weekLogs.reduce((a, l) => a + l.inputTokens + l.outputTokens, 0);
    for (const l of weekLogs) {
      const prev = featureMap.get(l.feature) ?? { tokens: 0, cost: 0 };
      featureMap.set(l.feature, {
        tokens: prev.tokens + l.inputTokens + l.outputTokens,
        cost: prev.cost + l.costUsd,
      });
    }
    const byFeature = [...featureMap.entries()].map(([feature, v]) => ({
      feature,
      tokens: v.tokens,
      cost: v.cost,
      pct: weekTotal > 0 ? Math.round((v.tokens / weekTotal) * 100) : 0,
    }));

    // Top users
    const userMap = new Map<string, { email: string; name: string; tokens: number; cost: number }>();
    for (const l of weekLogs as (typeof weekLogs[0] & { user?: { email: string; name: string | null } })[]) {
      const key = l.userId;
      const prev = userMap.get(key) ?? { email: l.user?.email ?? '', name: l.user?.name ?? '', tokens: 0, cost: 0 };
      userMap.set(key, {
        ...prev,
        tokens: prev.tokens + l.inputTokens + l.outputTokens,
        cost: prev.cost + l.costUsd,
      });
    }
    const topUsers = [...userMap.entries()]
      .map(([userId, v]) => ({ userId, ...v }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10);

    return {
      today: sum(todayLogs),
      week: sum(weekLogs),
      byFeature,
      topUsers,
    };
  }
}
