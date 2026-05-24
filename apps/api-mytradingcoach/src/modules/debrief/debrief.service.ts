import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DebriefPdfData } from '../pdf/pdf.service';

interface DebriefAiResult {
  summary: string;
  insights: unknown;
  objectives: { title: string; reason: string }[];
}
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class DebriefService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private analyticsService: AnalyticsService,
  ) {}

  async getCurrent(userId: string) {
    const now = new Date();
    const { weekNumber, year } = this.getWeekInfo(now);

    const current = await this.prisma.weeklyDebrief.findUnique({
      where: { userId_weekNumber_year: { userId, weekNumber, year } },
    });
    if (current) return current;

    // Pas encore de débrief cette semaine → retourner le plus récent
    return this.prisma.weeklyDebrief.findFirst({
      where: { userId },
      orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
    });
  }

  async getByWeek(userId: string, year: number, weekNumber: number) {
    const debrief = await this.prisma.weeklyDebrief.findUnique({
      where: { userId_weekNumber_year: { userId, weekNumber, year } },
    });
    if (!debrief) throw new NotFoundException('Débrief introuvable');
    return debrief;
  }

  async getHistory(userId: string) {
    return this.prisma.weeklyDebrief.findMany({
      where: { userId },
      orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
      take: 52,
    });
  }

  async generate(userId: string, role: Role = Role.USER, skipLimit = false) {
    const now = new Date();
    const { weekNumber, year, startDate, endDate } = this.getWeekInfo(now);

    const trades = await this.prisma.trade.findMany({
      where: { userId, tradedAt: { gte: startDate, lte: endDate } },
      select: {
        asset: true,
        side: true,
        pnl: true,
        emotion: true,
        setup: true,
        session: true,
        tradedAt: true,
      },
    });

    const stats = await this.analyticsService.getSummary(userId);

    const previousDebrief = await this.prisma.weeklyDebrief.findFirst({
      where: { userId, year },
      orderBy: { weekNumber: 'desc' },
    });
    const previousObjectives = previousDebrief
      ? (previousDebrief.objectives as unknown[])
      : [];

    if (role !== Role.ADMIN && !skipLimit) {
      await this.aiService.checkDailyLimit(userId, 'debrief', 1);
    }

    const userProfile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        market: true, goal: true,
        tradingStyle: true, tradingStrategy: true,
        tradingSessions: true, tradesPerDayMin: true,
        tradesPerDayMax: true, strategyDescription: true,
      },
    });

    const aiResult = (await this.aiService.generateDebrief({
      trades,
      stats,
      previousObjectives,
      weekNumber,
      year,
      userProfile: userProfile ?? undefined,
    }, userId)) as DebriefAiResult;

    return this.prisma.weeklyDebrief.upsert({
      where: { userId_weekNumber_year: { userId, weekNumber, year } },
      create: {
        userId,
        weekNumber,
        year,
        startDate,
        endDate,
        aiSummary: aiResult.summary,
        insights: JSON.parse(JSON.stringify(aiResult)),
        objectives: aiResult.objectives,
        stats,
      },
      update: {
        aiSummary: aiResult.summary,
        insights: JSON.parse(JSON.stringify(aiResult)),
        objectives: aiResult.objectives,
        stats,
        generatedAt: new Date(),
      },
    });
  }

  async generateForUser(userId: string) {
    return this.generate(userId, Role.USER, true);
  }

  async addNoteToObjective(userId: string, debriefId: string, index: number, note: string) {
    const debrief = await this.prisma.weeklyDebrief.findUnique({ where: { id: debriefId } });
    if (!debrief) throw new NotFoundException('Débrief introuvable');
    if (debrief.userId !== userId) throw new ForbiddenException();

    const objectives = (debrief.objectives as { title: string; reason: string; note?: string }[]);
    if (index < 0 || index >= objectives.length) throw new NotFoundException('Objectif introuvable');

    const updated = [...objectives];
    updated[index] = { ...updated[index], note };

    return this.prisma.weeklyDebrief.update({ where: { id: debriefId }, data: { objectives: updated } });
  }

  async getPDFData(
    userId: string,
    year: number,
    weekNumber: number,
  ): Promise<DebriefPdfData> {
    const debrief = await this.getByWeek(userId, year, weekNumber);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    const trades = await this.prisma.trade.findMany({
      where: {
        userId,
        tradedAt: { gte: debrief.startDate, lte: debrief.endDate },
      },
      orderBy: { pnl: 'desc' },
    });

    const pnlValues = trades.map((t) => t.pnl ?? 0);
    const wins = pnlValues.filter((p) => p > 0);

    const storedInsights = debrief.insights as {
      strengths?: { badge: string; text: string }[];
      weaknesses?: { badge: string; text: string }[];
    } | null;

    const insights: DebriefPdfData['insights'] = [
      ...(storedInsights?.strengths ?? []).map((s) => ({
        title: s.badge,
        description: s.text,
        type: 'positive' as const,
      })),
      ...(storedInsights?.weaknesses ?? []).map((w) => ({
        title: w.badge,
        description: w.text,
        type: 'negative' as const,
      })),
    ];

    const objectives =
      (debrief.objectives as { title: string; reason: string }[]) ?? [];

    return {
      weekNumber,
      year,
      startDate: debrief.startDate.toLocaleDateString('fr-FR'),
      endDate: debrief.endDate.toLocaleDateString('fr-FR'),
      userName: user?.name ?? 'Trader',
      summary: debrief.aiSummary ?? '',
      stats: {
        totalTrades: trades.length,
        winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
        totalPnl: pnlValues.reduce((a, b) => a + b, 0),
        avgRR:
          trades.reduce((acc, t) => acc + (t.riskReward ?? 0), 0) /
          (trades.length || 1),
        bestTrade: pnlValues.length > 0 ? Math.max(...pnlValues) : 0,
        worstTrade: pnlValues.length > 0 ? Math.min(...pnlValues) : 0,
      },
      insights,
      objectives,
      topTrades: trades.slice(0, 5).map((t) => ({
        asset: t.asset,
        side: t.side,
        pnl: t.pnl ?? 0,
        tradedAt: t.tradedAt.toISOString(),
      })),
    };
  }

  private getWeekInfo(date: Date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNumber = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );
    const year = d.getFullYear();

    const monday = new Date(date);
    monday.setDate(date.getDate() - (date.getDay() || 7) + 1);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { weekNumber, year, startDate: monday, endDate: sunday };
  }
}
