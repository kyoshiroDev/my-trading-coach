import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { newsWindowStats, type NewsWindowStats } from './debrief-news-window';
import { NEWS_SHIELD_DEFAULT_MINUTES, type NewsEvent, newsLabel, newsShieldMinutes } from '../behavior/behavior-news';
import { parisDate } from '../eco-calendar/eco-calendar.schedule';
import { Plan, Prisma, Role, WeeklyDebrief } from '@prisma/client';
import { effectiveEmotion } from '../../common/utils/effective-emotion.util';
import { averageKnownRiskReward, computeTradeStats, netPnl, type DebriefHistoryItem } from '@mtc/shared';
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
import { PropRiskContextService } from '../accounts/prop-risk-context';
import { accountKeys, analysesById, tradesByKey } from './debrief-account-keys';
import { activeAccountsWhere, inactiveAccountsTradeWhere } from '../accounts/account-status-scope';
import type { DebriefAccountSection, DebriefBadgeItem, DebriefObjective } from '@mtc/shared';
import { debriefStats } from './debrief-stats';
import { parisWallTimeToUtc } from '../eco-calendar/eco-calendar.schedule';

@Injectable()
export class DebriefService {
  private readonly logger = new Logger(DebriefService.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private analyticsService: AnalyticsService,
    private sessionService: SessionService,
    /** Bloc « prop firm » du prompt (#374) ; optionnel pour garder les tests légers. */
    @Optional() private propRisk?: PropRiskContextService,
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

  /** 52 dernières semaines, sans le contenu (#959) : le sélecteur de l'écran Débrief. */
  async getHistory(userId: string): Promise<DebriefHistoryItem[]> {
    const rows = await this.prisma.weeklyDebrief.findMany({
      where: { userId },
      orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
      take: 52,
      select: { id: true, year: true, weekNumber: true, startDate: true, endDate: true, stats: true },
    });
    return rows.map((r) => {
      const total = (r.stats as { totalTrades?: unknown } | null)?.totalTrades;
      return {
        id: r.id, year: r.year, weekNumber: r.weekNumber,
        startDate: r.startDate.toISOString(), endDate: r.endDate.toISOString(),
        totalTrades: typeof total === 'number' ? total : 0,
      };
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
    // C1 (#1048) : un débrief généré AVANT le dimanche 23:00 de sa semaine (bouton « Générer » en
    // milieu de semaine) ne couvre que quelques jours. Une fois ce seuil passé, le cron et le
    // rattrapage le refont sur la semaine complète (created=true → l'e-mail « débrief prêt » part).
    // Un débrief produit par le cron (≥ 23:00) n'est jamais refait : pas de 2e e-mail le lundi.
    const cutoff = this.weeklyCutoff(opts?.refDate ?? new Date());
    const partial = !!existing && existing.generatedAt < cutoff && Date.now() >= cutoff.getTime();
    if (existing && !opts?.force && !partial) {
      return { debrief: existing, created: false };
    }

    const trades = (
      await this.prisma.trade.findMany({
        where: { userId, tradedAt: { gte: startDate, lte: endDate }, ...inactiveAccountsTradeWhere() }, // hors comptes perdus
        select: {
          asset: true,
          side: true,
          pnl: true,
          commission: true, // stats sur le net
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

    // Trades clôturés seulement pour les stats par compte et l'IA (C13 #1046, convention #947) :
    // une position ouverte gonflait « N trades » sans résultat.
    const closedTrades = trades.filter((t) => t.pnl !== null);

    // C8 (#1046, #1056) : semaine sans trade clôturé (lundi matin, positions encore ouvertes) → pas
    // d'appel IA facturé ni de débrief vide qui remplacerait à l'écran le vrai débrief de la semaine passée.
    if (closedTrades.length === 0) {
      throw new BadRequestException(
        'Aucun trade clôturé cette semaine pour l’instant. Le débrief se génère dès ton premier trade clôturé de la semaine.',
      );
    }

    // Comptes actifs et validés (avec leurs règles prop firm) pour l'analyse par compte.
    const accounts = await this.prisma.tradingAccount.findMany({
      where: { userId, ...activeAccountsWhere() },
      select: {
        id: true, label: true, type: true, status: true, currency: true,
        startingBalance: true, profitTarget: true, maxDrawdown: true, drawdownType: true,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });

    // Trades groupés par compte (accountId null → bucket « unassigned »).
    const tradesByAccount: Record<string, typeof trades> = {};
    for (const t of closedTrades) {
      const key = t.accountId ?? 'unassigned';
      (tradesByAccount[key] ??= []).push(t);
    }

    // Stats de la semaine du débrief seulement (mêmes bornes que les trades ci-dessus, #934) : elles
    // partent dans le prompt IA, dans WeeklyDebrief.stats et dans l'e-mail « débrief prêt ».
    // Format (`debriefStats`) partagé avec le script de recalcul des anciens débriefs (#943).
    const stats = debriefStats(await this.analyticsService.getSummary(userId, undefined, startDate, endDate));
    // Bouclier annonces (#670) : trades autour des annonces fortes, enregistré avec le débrief seulement
    // (pas dans le prompt IA). Fenêtre du trader, sinon le défaut (constat, pas une alerte).
    const newsWindow = await this.newsWindow(userId, closedTrades, startDate, endDate);

    // C5 (#1046) : le débrief immédiatement AVANT la semaine visée, à cheval sur l'année. Avant,
    // `{ userId, year }` trié par semaine renvoyait le débrief de la semaine elle-même en
    // régénération, une semaine plus récente pour une semaine passée, et rien en semaine 1.
    const previousDebrief = await this.prisma.weeklyDebrief.findFirst({
      where: { userId, OR: [{ year: { lt: year } }, { year, weekNumber: { lt: weekNumber } }] },
      orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
    });
    const previousObjectives = previousDebrief
      ? (previousDebrief.objectives as unknown[])
      : [];

    const limited = role !== Role.ADMIN && !skipLimit;
    if (limited) {
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

    // Séances jusqu'à la fin de la semaine visée seulement (C5 #1046).
    const recentSessions = await this.sessionService.getSessionHistory(userId, 5, 0, { before: endDate });

    // Comptes désignés à l'IA par une clé courte (compte-1, compte-2…), jamais par leur id interne.
    const keys = accountKeys(accounts.map((a) => a.id));

    // Inputs comptes pour l'IA (avec règles + nb de trades de la semaine).
    const accountInputs: DebriefAccountInput[] = accounts.map((a) => ({
      accountId: keys.toKey(a.id),
      name: a.label,
      type: a.type,
      currency: a.currency,
      startingBalance: a.startingBalance,
      profitTarget: a.profitTarget,
      maxDrawdown: a.maxDrawdown,
      drawdownType: a.drawdownType,
      tradesCount: tradesByAccount[a.id]?.length ?? 0,
    }));

    // Séances prop firm vues en direct dans la semaine (marges, alertes, tilt) : faits calculés (#374).
    const propContext = (await this.propRisk?.forWeek(userId, startDate, endDate).catch((err: unknown) => {
      this.logger.warn(`Contexte prop firm ignoré : ${(err as Error).message}`);
      return null;
    })) ?? null;

    let aiResult: DebriefAiResult;
    try {
      aiResult = (await this.aiService.generateDebrief({
        propContext,
        trades: closedTrades,
        stats,
        previousObjectives,
        weekNumber,
        year,
        userProfile: userProfile ?? undefined,
        recentSessions,
        accounts: accountInputs,
        tradesByAccount: tradesByKey(tradesByAccount, keys),
      }, userId)) as DebriefAiResult;
    } catch (err) {
      // C2 (#1045) : aucun débrief produit → la génération manuelle du jour est rendue.
      if (limited) await this.aiService.releaseDailyLimit(userId, 'debrief');
      throw err;
    }

    const normalizedObjectives = this.normalizeObjectives(aiResult.objectives);
    // Colonne JSON Prisma : nos interfaces n'ont pas de signature d'index, d'où le cast explicite.
    const objectivesJson = normalizedObjectives as unknown as Prisma.InputJsonArray;

    // Vue d'ensemble (rétrocompat : ancien `summary` à plat si pas d'overview).
    const overviewSummary = aiResult.overview?.summary ?? aiResult.summary ?? '';

    // Analyse IA indexée par compte pour la fusion.
    const aiByAccount = analysesById<DebriefAccountAi>(aiResult.accounts ?? [], keys);

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
        stats: { ...stats, ...(newsWindow ? { newsWindow } : {}) } as unknown as Prisma.InputJsonValue,
      },
      update: {
        aiSummary: overviewSummary,
        insights: JSON.parse(JSON.stringify(structuredInsights)),
        objectives: objectivesJson,
        stats: { ...stats, ...(newsWindow ? { newsWindow } : {}) } as unknown as Prisma.InputJsonValue,
        generatedAt: new Date(),
      },
    });
    return { debrief, created: true };
  }

  /** Stat « Tes trades autour des annonces » (#670) : annonces fortes de la semaine, heure de Paris → UTC. */
  private async newsWindow(
    userId: string,
    trades: { asset: string; tradedAt: Date; pnl: number | null; commission?: number | null; accountId?: string | null }[],
    startDate: Date,
    endDate: Date,
  ): Promise<NewsWindowStats | null> {
    // Stat secondaire : un échec ne bloque jamais la génération du débrief (bloc masqué).
    try {
      return await this.computeNewsWindow(userId, trades, startDate, endDate);
    } catch (err: unknown) {
      this.logger.warn(`Stat « autour des annonces » non calculée : ${err instanceof Error ? err.name : 'Error'}`);
      return null;
    }
  }

  private async computeNewsWindow(
    userId: string,
    trades: { asset: string; tradedAt: Date; pnl: number | null; commission?: number | null; accountId?: string | null }[],
    startDate: Date,
    endDate: Date,
  ): Promise<NewsWindowStats | null> {
    const [user, rows] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { newsShieldMinutes: true } }),
      this.prisma.ecoEvent.findMany({
        where: { impact: 'high', date: { gte: parisDate(startDate), lte: parisDate(endDate) } },
        select: { date: true, time: true, name: true, nameFr: true, currency: true },
      }),
    ]);
    const events = rows
      .map((r) => ({ at: parisWallTimeToUtc(r.date, r.time), label: newsLabel(r), currency: r.currency }))
      .filter((e): e is NewsEvent => e.at !== null);
    return newsWindowStats(trades, events, newsShieldMinutes(user?.newsShieldMinutes) || NEWS_SHIELD_DEFAULT_MINUTES);
  }

  /** Stats déterministes d'un compte sur la semaine (jamais l'IA pour les chiffres). */
  private accountStats(trades: { pnl: number | null; commission?: number | null }[]) {
    // Helper unique : BE exclus du win rate.
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
   * le Weekly Debrief automatique est une feature Premium.
   * → plan PREMIUM, rôle ADMIN/BETA_TESTER, ou essai (trial) en cours.
   */
  /**
   * Destinataires du débrief automatique de la semaine de `refDate` : seulement ceux qui ont clôturé
   * un trade cette semaine-là (SCA-B5-08, décision du 2026-10-07 ; clôturé : #1056) — une semaine vide
   * coûtait un appel IA et un e-mail sans contenu. Mêmes bornes que `generate` (getWeekInfo).
   */
  getEligibleUsers(refDate: Date) {
    const { startDate, endDate } = this.getWeekInfo(refDate);
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
        // Même filtre que `generate` (comptes perdus exclus, #681 ; trades clôturés seulement, #1056) :
        // un trader dont tous les trades de la semaine sont sur un compte échoué ou archivé, ou encore
        // ouverts, recevait un débrief à 0 trade (#947).
        trades: {
          some: { tradedAt: { gte: startDate, lte: endDate }, pnl: { not: null }, ...inactiveAccountsTradeWhere() },
        },
      },
      select: { id: true },
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

    // Trades clôturés seulement (C13 #1046, convention des agrégats #947 : `pnl IS NOT NULL`) : une
    // position ouverte comptait dans le total et apparaissait « meilleur trade » à 0 $.
    const trades = await this.prisma.trade.findMany({
      where: {
        userId,
        pnl: { not: null },
        tradedAt: { gte: debrief.startDate, lte: debrief.endDate }, ...inactiveAccountsTradeWhere(),
      },
      orderBy: { pnl: 'desc' },
    });

    // Montants en NET (frais déduits), comme le win rate. Tri par net décroissant
    // pour le top 5 (l'orderBy SQL trie sur le brut).
    trades.sort((a, b) => (netPnl(b) ?? 0) - (netPnl(a) ?? 0));
    const pnlValues = trades.map((t) => netPnl(t) ?? 0);
    // Win rate via le helper unique (BE exclus du dénominateur).
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
        // Moyenne des R/R CONNUS : un trade sans stop ni objectif (synchronisé) n'a pas de R/R,
        // le compter pour 0 tirait la moyenne vers 0. Aucun R/R connu → null (« — » dans le PDF).
        avgRR: averageKnownRiskReward(trades),
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

  /**
   * Dimanche 23:00 HEURE DE PARIS de la semaine de `date` : l'heure du cron hebdo
   * (`@Cron('0 23 * * 0', { timeZone: 'Europe/Paris' })`), quel que soit le fuseau du serveur. En
   * heure locale, une API en UTC aurait placé le seuil après le cron, et le rattrapage du lundi
   * aurait refait (et re-mailé) tous les débriefs du dimanche.
   */
  weeklyCutoff(date: Date): Date {
    const sunday = this.getWeekInfo(date).endDate;
    const day = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
    return parisWallTimeToUtc(day, '23:00') ?? new Date(sunday.getTime() - 59 * 60_000 - 59_999);
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
