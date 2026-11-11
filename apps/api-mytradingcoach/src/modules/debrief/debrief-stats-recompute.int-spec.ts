/**
 * Recalcul des stats des anciens débriefs (#943) sur le VRAI Postgres : les stats d'un débrief
 * enregistré avec tout l'historique (#934) deviennent celles de SA semaine, le texte IA ne bouge
 * pas, les comptes démo ne sont pas touchés, une sauvegarde permet le retour arrière.
 * Le recalcul est limité aux users du test (`userId`) : la base d'intégration est partagée.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { TradeSide, TradingSession } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { computeSummary } from '../analytics/analytics-summary';
import { DebriefService } from './debrief.service';
import { debriefStats } from './debrief-stats';
import { recomputeDebriefStats, restoreDebriefStats, type DebriefStatsBackupRow } from './debrief-stats-recompute';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

let app: INestApplication;
let prisma: PrismaService;
let debriefs: DebriefService;
let userId: string;
let demoId: string;

/** Semaine du lundi 9 au dimanche 15/11/2026, mêmes bornes que la génération. */
let week: { weekNumber: number; year: number; startDate: Date; endDate: Date };
/** Stats enregistrées avant #934 : tout l'historique (3 trades). */
let historyStats: ReturnType<typeof debriefStats>;

async function trades(owner: string) {
  const at = (iso: string) => new Date(iso);
  const rows = [
    { pnl: 100, tradedAt: at('2026-11-03T10:00:00') }, // semaine précédente
    { pnl: -50, tradedAt: at('2026-11-04T10:00:00') }, // semaine précédente
    { pnl: -200, tradedAt: at('2026-11-10T10:00:00') }, // semaine du débrief
  ];
  const setup = await prisma.setup.create({ data: { userId: owner, title: 'Breakout', color: '#10b981' } });
  await prisma.trade.createMany({
    data: rows.map((r, i) => ({
      setupId: setup.id,
      id: `${RUN}-${owner.slice(-6)}-t${i}`,
      userId: owner,
      asset: 'MNQ',
      side: TradeSide.LONG,
      entry: 20000,
      pnl: r.pnl,
      session: TradingSession.NEW_YORK,
      timeframe: '5M',
      tradedAt: r.tradedAt,
    })),
  });
}

async function staleDebrief(owner: string) {
  return prisma.weeklyDebrief.create({
    data: {
      userId: owner,
      ...week,
      aiSummary: 'Texte écrit par l’IA',
      insights: [{ type: 'pattern', text: 'insight' }],
      objectives: [{ text: 'objectif' }],
      stats: historyStats,
    },
  });
}

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  debriefs = app.get(DebriefService);
  week = debriefs.getWeekInfo(new Date('2026-11-11T15:00:00'));
  userId = (await prisma.user.create({ data: { email: `int-943-${RUN}@test.local`, password: 'x' } })).id;
  demoId = (await prisma.user.create({ data: { email: `int-943-demo-${RUN}@test.local`, password: 'x', isDemo: true } })).id;
  await trades(userId);
  await trades(demoId);
  historyStats = debriefStats(await computeSummary(prisma, { userId }));
  await staleDebrief(userId);
  await staleDebrief(demoId);
}, 120_000);

afterAll(async () => {
  await prisma.trade.deleteMany({ where: { id: { startsWith: RUN } } });
  await prisma.setup.deleteMany({ where: { userId: { in: [userId, demoId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, demoId] } } });
  await app.close();
});

const read = (owner: string) => prisma.weeklyDebrief.findFirstOrThrow({ where: { userId: owner } });

describe('recomputeDebriefStats (#943), vrai Postgres', () => {
  it('l’état de départ reproduit le bug : 3 trades de tout l’historique', () => {
    expect(historyStats).toMatchObject({ totalTrades: 3, totalPnl: -150 });
  });

  it('simulation : rien n’est écrit', async () => {
    const report = await recomputeDebriefStats(prisma, { apply: false, userId });
    expect(report).toMatchObject({ lus: 1, modifies: 1, inchanges: 0 });
    expect(report.champs).toMatchObject({ totalTrades: 1, totalPnl: 1 });
    expect((await read(userId)).stats).toEqual(historyStats);
  });

  it('écriture : stats de la semaine, texte IA intact, sauvegarde avant, démo exclue, retour arrière', async () => {
    const backup: DebriefStatsBackupRow[] = [];
    // Le démo n'est jamais lu, même ciblé.
    expect(await recomputeDebriefStats(prisma, { apply: false, userId: demoId })).toMatchObject({ lus: 0 });

    const before = await read(userId);
    await recomputeDebriefStats(prisma, { apply: true, userId, backup: (r) => backup.push(r) });
    const after = await read(userId);

    const expected = debriefStats(await computeSummary(prisma, { userId, from: week.startDate, to: week.endDate }));
    expect(after.stats).toEqual(expected);
    expect(after.stats).toMatchObject({ totalTrades: 1, totalPnl: -200, maxDrawdown: 200 });
    expect(after.stats).not.toHaveProperty('maxDrawdownAccountId');
    expect({ aiSummary: after.aiSummary, insights: after.insights, objectives: after.objectives, generatedAt: after.generatedAt })
      .toEqual({ aiSummary: before.aiSummary, insights: before.insights, objectives: before.objectives, generatedAt: before.generatedAt });
    expect(backup).toEqual([{ id: before.id, stats: historyStats }]);
    expect((await read(demoId)).stats).toEqual(historyStats);

    // Second passage : plus rien à changer.
    expect(await recomputeDebriefStats(prisma, { apply: false, userId })).toMatchObject({ modifies: 0, inchanges: 1 });

    // Retour arrière depuis la sauvegarde (aller-retour JSON, comme le fichier).
    const rows = JSON.parse(JSON.stringify(backup)) as DebriefStatsBackupRow[];
    expect(await restoreDebriefStats(prisma, rows, true)).toEqual({ lignes: 1, restaures: 1, introuvables: 0 });
    expect((await read(userId)).stats).toEqual(historyStats);
  });

  it('même résultat que la génération d’un débrief neuf (une seule définition des stats)', async () => {
    const viaService = debriefStats(
      await (app.get(DebriefService) as unknown as { analyticsService: { getSummary: (...a: unknown[]) => Promise<never> } })
        .analyticsService.getSummary(userId, undefined, week.startDate, week.endDate),
    );
    const viaScript = debriefStats(await computeSummary(prisma, { userId, from: week.startDate, to: week.endDate }));
    expect(viaScript).toEqual(viaService);
  });
});
