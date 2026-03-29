import { Injectable, NotFoundException } from '@nestjs/common';
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
    return this.prisma.weeklyDebrief.findUnique({
      where: { userId_weekNumber_year: { userId, weekNumber, year } },
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

  async generate(userId: string) {
    const now = new Date();
    const { weekNumber, year, startDate, endDate } = this.getWeekInfo(now);

    const trades = await this.prisma.trade.findMany({
      where: { userId, tradedAt: { gte: startDate, lte: endDate } },
      select: {
        asset: true, side: true, pnl: true, emotion: true,
        setup: true, session: true, tradedAt: true,
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

    const aiResult = await this.aiService.generateDebrief({
      trades,
      stats,
      previousObjectives,
      weekNumber,
      year,
    });

    return this.prisma.weeklyDebrief.upsert({
      where: { userId_weekNumber_year: { userId, weekNumber, year } },
      create: {
        userId,
        weekNumber,
        year,
        startDate,
        endDate,
        aiSummary: aiResult.summary,
        insights: aiResult,
        objectives: aiResult.objectives,
        stats,
      },
      update: {
        aiSummary: aiResult.summary,
        insights: aiResult,
        objectives: aiResult.objectives,
        stats,
        generatedAt: new Date(),
      },
    });
  }

  async generateForUser(userId: string) {
    return this.generate(userId);
  }

  private getWeekInfo(date: Date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNumber = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
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