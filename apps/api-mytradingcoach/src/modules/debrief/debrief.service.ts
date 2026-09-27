import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { Plan, Prisma, Role, WeeklyDebrief } from '@prisma/client';
import { effectiveEmotion } from '../../common/utils/effective-emotion.util';
import { computeTradeStats, netPnl } from '@mtc/shared';
import { userAmountsCurrency } from '../../common/utils/user-currency.util';
import { DebriefPdfData } from '../pdf/pdf.service';
import { OBJECTIVE_CHECK_TYPES, DebriefAccountInput } from '../ai/prompts/debrief.prompt';

/** Analyse qualitative IA d'un compte (avant fusion avec les stats backend). */
interface DebriefAccountAi {
  accountId: string;
  summary?: string;
  strengths?: DebriefBadgeItem[];
  weaknesses?: DebriefBadgeItem[];
  objectives?: { title: string; reason: string }[];
  propNote?: string | null;
}

interface DebriefAiResult {
  summary?: string;
  overview?: { summary: string };
  accounts?: DebriefAccountAi[];
  emotionInsight?: string;
  objectives: DebriefObjective[];
}
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { SessionService } from '../session/session.service';
import type { DebriefAccountSection, DebriefBadgeItem, DebriefObjective } from '@mtc/shared';

@Injectable()
export class DebriefService {
  private readonly logger = new Logger(DebriefService.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private analyticsService: AnalyticsService,
    private sessionService: SessionService,
  ) {}

  /**
   * Valide chaque objectif contre le catalogue de checks.
   * check hors catalogue / absent → check:null (objectif manuel côté front), warning loggé.
   */
  private normalizeObjectives(
    objectives: DebriefObjective[] | undefined,
  ): DebriefObjective[] {
    if (!Array.isArray(objectives)) return [];
    const allowed = OBJECTIVE_CHECK_TYPES as readonly string[];
    return objectives.map((o) => {
      const type = o.check?.type;
      if (type && allowed.includes(type)) {
        return { title: o.title, reason: o.reason, check: { type, params: o.check?.params ?? {} } };
      }
      if (type) {
        this.logger.warn(`Objectif IA avec check hors catalogue ignoré : "${type}" (titre: ${o.title})`);
      }
      return { title: o.title, reason: o.reason, check: null };
    });
  }

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

  async generate(
    userId: string,
    role: Role = Role.USER,
    skipLimit = false,
    opts?: { refDate?: Date; force?: boolean },
  ): Promise<{ debrief: WeeklyDebrief; created: boolean }> {
    // La semaine cible vient de refDate (par défaut maintenant) → permet de viser une semaine passée.
    const { weekNumber, year, startDate, endDate } = this.getWeekInfo(opts?.refDate ?? new Date());

    // Idempotence : si le débrief de cette semaine existe et qu'on ne force pas, on le renvoie
    // tel quel : zéro appel IA, zéro doublon. created=false → le processor n'enverra pas d'email.
    const existing = await this.prisma.weeklyDebrief.findUnique({
      where: { userId_weekNumber_year: { userId, weekNumber, year } },
    });
    if (existing && !opts?.force) {
      return { debrief: existing, created: false };
    }

    const trades = (
      await this.prisma.trade.findMany({
        where: { userId, tradedAt: { gte: startDate, lte: endDate } },
        select: {
          asset: true,
          side: true,
          pnl: true,
          commission: true, // stats sur le net (PROMPT-213)
          emotion: true,
          tradeSession: { select: { moodStart: true } },
          setup: { select: { title: true } },
          session: true,
          tradedAt: true,
          accountId: true,
        },
      })
      // Émotion effective (override sinon humeur de session ; null = non renseignée).
    ).map((t) => ({ ...t, setup: t.setup?.title ?? null, emotion: effectiveEmotion(t) }));

    // Comptes non archivés (avec leurs règles prop firm) pour l'analyse par compte.
    const accounts = await this.prisma.tradingAccount.findMany({
      where: { userId, status: { not: 'ARCHIVED' } },
      select: {
        id: true, label: true, type: true, status: true, currency: true,
        startingBalance: true, profitTarget: true, maxDrawdown: true, drawdownType: true,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });

    // Trades groupés par compte (accountId null → bucket « unassigned »).
    const tradesByAccount: Record<string, typeof trades> = {};
    for (const t of trades) {
      const key = t.accountId ?? 'unassigned';
      (tradesByAccount[key] ??= []).push(t);
    }

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

    const recentSessions = await this.sessionService.getSessionHistory(userId, 5, 0);

    // Inputs comptes pour l'IA (avec règles + nb de trades de la semaine).
    const accountInputs: DebriefAccountInput[] = accounts.map((a) => ({
      accountId: a.id,
      name: a.label,
      type: a.type,
      currency: a.currency,
      startingBalance: a.startingBalance,
      profitTarget: a.profitTarget,
      maxDrawdown: a.maxDrawdown,
      drawdownType: a.drawdownType,
      tradesCount: tradesByAccount[a.id]?.length ?? 0,
    }));

    const aiResult = (await this.aiService.generateDebrief({
      trades,
      stats,
      previousObjectives,
      weekNumber,
      year,
      userProfile: userProfile ?? undefined,
      recentSessions,
      accounts: accountInputs,
      tradesByAccount,
    }, userId)) as DebriefAiResult;

    const normalizedObjectives = this.normalizeObjectives(aiResult.objectives);
    // Colonne JSON Prisma : nos interfaces n'ont pas de signature d'index, d'où le cast explicite.
    const objectivesJson = normalizedObjectives as unknown as Prisma.InputJsonArray;

    // Vue d'ensemble (rétrocompat : ancien `summary` à plat si pas d'overview).
    const overviewSummary = aiResult.overview?.summary ?? aiResult.summary ?? '';

    // Analyse IA indexée par compte pour la fusion.
    const aiByAccount = new Map<string, DebriefAccountAi>();
    for (const a of aiResult.accounts ?? []) {
      if (a?.accountId) aiByAccount.set(a.accountId, a);
    }

    // Onglets : tous les comptes non archivés + bucket « unassigned » si trades orphelins.
    const accountSections: DebriefAccountSection[] = accounts.map((a) =>
      this.buildAccountSection(
        a.id, a.label, a.type, a.status,
        tradesByAccount[a.id] ?? [],
        a.maxDrawdown != null || a.profitTarget != null
          ? { startingBalance: a.startingBalance, profitTarget: a.profitTarget, maxDrawdown: a.maxDrawdown, drawdownType: a.drawdownType }
          : null,
        aiByAccount.get(a.id),
      ),
    );
    if (tradesByAccount['unassigned']?.length) {
      accountSections.push(
        this.buildAccountSection(
          'unassigned', 'Non attribué', 'PERSONAL', 'ACTIVE',
          tradesByAccount['unassigned'], null, aiByAccount.get('unassigned'),
        ),
      );
    }

    const structuredInsights = {
      overview: { summary: overviewSummary },
      accounts: accountSections,
      // Champs à plat conservés pour la rétrocompat (PDF / anciens lecteurs).
      summary: overviewSummary,
      emotionInsight: aiResult.emotionInsight ?? '',
    };

    const debrief = await this.prisma.weeklyDebrief.upsert({
      where: { userId_weekNumber_year: { userId, weekNumber, year } },
      create: {
        userId,
        weekNumber,
        year,
        startDate,
        endDate,
        aiSummary: overviewSummary,
        insights: JSON.parse(JSON.stringify(structuredInsights)),
        objectives: objectivesJson,
        stats,
      },
      update: {
        aiSummary: overviewSummary,
        insights: JSON.parse(JSON.stringify(structuredInsights)),
        objectives: objectivesJson,
        stats,
        generatedAt: new Date(),
      },
    });
    return { debrief, created: true };
  }

  /** Stats déterministes d'un compte sur la semaine (jamais l'IA pour les chiffres). */
  private accountStats(trades: { pnl: number | null; commission?: number | null }[]) {
    // Helper unique : BE exclus du win rate (PROMPT-160).
    const stats = computeTradeStats(trades);
    return {
      totalTrades: stats.total,
      winRate: stats.winRate,
      totalPnl: stats.totalPnl,
    };
  }

  /** Fusionne métadonnées + stats backend (autoritaires) et analyse qualitative IA. */
  private buildAccountSection(
    accountId: string,
    name: string,
    type: string,
    status: string,
    trades: { pnl: number | null; commission?: number | null }[],
    rules: DebriefAccountSection['rules'],
    ai: DebriefAccountAi | undefined,
  ): DebriefAccountSection {
    return {
      accountId,
      name,
      type,
      status,
      stats: this.accountStats(trades),
      rules,
      summary: ai?.summary ?? '',
      strengths: Array.isArray(ai?.strengths) ? ai!.strengths : [],
      weaknesses: Array.isArray(ai?.weaknesses) ? ai!.weaknesses : [],
      objectives: Array.isArray(ai?.objectives) ? ai!.objectives : [],
      propNote: ai?.propNote ?? null,
    };
  }

  async generateForUser(
    userId: string,
    opts?: { refDate?: Date; force?: boolean },
  ): Promise<{ debrief: WeeklyDebrief; created: boolean }> {
    return this.generate(userId, Role.USER, true, opts);
  }

  /**
   * Éligibles au débrief auto : non-démo, opt-in, accès Premium.
   * Doit matcher le PremiumGuard du controller ET la promesse landing/front :
   * le Weekly Debrief automatique est une feature Premium (PROMPT-169).
   * → plan PREMIUM, rôle ADMIN/BETA_TESTER, ou essai (trial) en cours.
   */
  getEligibleUsers() {
    return this.prisma.user.findMany({
      where: {
        isDemo: false,
        debriefAutomatic: true,
        OR: [
          { plan: Plan.PREMIUM },
          { role: Role.ADMIN },
          { role: Role.BETA_TESTER },
          { trialEndsAt: { gt: new Date() } },
        ],
      },
      select: { id: true, email: true },
    });
  }

  /** Date dans la semaine précédente (pour le rattrapage du lundi). */
  lastCompletedWeekRef(now: Date = new Date()): Date {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  /** Lundi midi de la semaine ISO (year, week) : à passer en refDate pour cibler cette semaine. */
  weekRefDate(year: number, week: number): Date {
    const jan4 = new Date(year, 0, 4); // toujours en semaine ISO 1
    const dow = jan4.getDay() || 7; // 1 (lun) .. 7 (dim)
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - (dow - 1) + (week - 1) * 7);
    monday.setHours(12, 0, 0, 0);
    return monday;
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

    // Montants en NET (frais déduits), comme le win rate (PROMPT-213). Tri par net décroissant
    // pour le top 5 (l'orderBy SQL trie sur le brut).
    trades.sort((a, b) => (netPnl(b) ?? 0) - (netPnl(a) ?? 0));
    const pnlValues = trades.map((t) => netPnl(t) ?? 0);
    // Win rate via le helper unique (BE exclus du dénominateur, PROMPT-160).
    const pdfStats = computeTradeStats(trades);

    const storedInsights = debrief.insights as {
      strengths?: { badge: string; text: string }[];
      weaknesses?: { badge: string; text: string }[];
      accounts?: {
        name?: string;
        strengths?: { badge: string; text: string }[];
        weaknesses?: { badge: string; text: string }[];
      }[];
    } | null;

    // Nouveau format (par compte) : on aplatit forces/faiblesses de tous les comptes,
    // préfixées du nom du compte. Ancien format à plat : rétrocompat directe.
    const flatStrengths =
      storedInsights?.strengths ??
      (storedInsights?.accounts ?? []).flatMap((a) =>
        (a.strengths ?? []).map((s) => ({ badge: s.badge, text: a.name ? `[${a.name}] ${s.text}` : s.text })),
      );
    const flatWeaknesses =
      storedInsights?.weaknesses ??
      (storedInsights?.accounts ?? []).flatMap((a) =>
        (a.weaknesses ?? []).map((w) => ({ badge: w.badge, text: a.name ? `[${a.name}] ${w.text}` : w.text })),
      );

    const insights: DebriefPdfData['insights'] = [
      ...flatStrengths.map((s) => ({
        title: s.badge,
        description: s.text,
        type: 'positive' as const,
      })),
      ...flatWeaknesses.map((w) => ({
        title: w.badge,
        description: w.text,
        type: 'negative' as const,
      })),
    ];

    const objectives =
      (debrief.objectives as { title: string; reason: string }[]) ?? [];

    return {
      currency: await userAmountsCurrency(this.prisma, userId),
      weekNumber,
      year,
      startDate: debrief.startDate.toLocaleDateString('fr-FR'),
      endDate: debrief.endDate.toLocaleDateString('fr-FR'),
      userName: user?.name ?? 'Trader',
      summary: debrief.aiSummary ?? '',
      stats: {
        totalTrades: trades.length,
        winRate: pdfStats.winRate,
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
        pnl: netPnl(t) ?? 0,
        tradedAt: t.tradedAt.toISOString(),
      })),
    };
  }

  getWeekInfo(date: Date) {
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
