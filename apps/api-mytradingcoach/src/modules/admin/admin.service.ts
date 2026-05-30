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

    const [todayAgg, weekAgg, byFeatureRaw, topUsersRaw] = await Promise.all([
      // Totaux aujourd'hui — aggregate (pas de chargement en RAM)
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: startOfToday } },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _count: true,
      }),
      // Totaux semaine — aggregate
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: startOfWeek } },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _count: true,
      }),
      // Par feature — groupBy (PostgreSQL fait le calcul)
      this.prisma.aiUsageLog.groupBy({
        by: ['feature'],
        where: { createdAt: { gte: startOfWeek } },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _count: true,
      }),
      // Top users — groupBy avec userId
      this.prisma.aiUsageLog.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: startOfWeek } },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        orderBy: { _sum: { inputTokens: 'desc' } },
        take: 10,
      }),
    ]);

    const today = {
      inputTokens:  todayAgg._sum.inputTokens  ?? 0,
      outputTokens: todayAgg._sum.outputTokens ?? 0,
      costUsd:      todayAgg._sum.costUsd       ?? 0,
      calls:        todayAgg._count,
    };
    const week = {
      inputTokens:  weekAgg._sum.inputTokens  ?? 0,
      outputTokens: weekAgg._sum.outputTokens ?? 0,
      costUsd:      weekAgg._sum.costUsd       ?? 0,
      calls:        weekAgg._count,
    };

    const weekTotal = week.inputTokens + week.outputTokens;
    const byFeature = byFeatureRaw.map(f => ({
      feature: f.feature,
      tokens:  (f._sum.inputTokens ?? 0) + (f._sum.outputTokens ?? 0),
      cost:    f._sum.costUsd ?? 0,
      pct:     weekTotal > 0 ? Math.round(((f._sum.inputTokens ?? 0) + (f._sum.outputTokens ?? 0)) / weekTotal * 100) : 0,
    }));

    // Enrichir avec email/name depuis users
    const userIds = topUsersRaw.map(u => u.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true },
    });
    const userById = new Map(users.map(u => [u.id, u]));
    const topUsers = topUsersRaw.map(u => ({
      userId:  u.userId,
      email:   userById.get(u.userId)?.email ?? '',
      name:    userById.get(u.userId)?.name  ?? '',
      tokens:  (u._sum.inputTokens ?? 0) + (u._sum.outputTokens ?? 0),
      cost:    u._sum.costUsd ?? 0,
    }));

    return { today, week, byFeature, topUsers };
  }
}
