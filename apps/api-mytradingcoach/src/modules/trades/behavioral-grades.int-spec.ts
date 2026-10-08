/**
 * Écriture groupée des notes comportementales (SCA-B5-04) sur une vraie base : l'`UPDATE … FROM
 * (VALUES …)` brut (types enum, valeurs nulles) qu'un double Prisma ne valide pas.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { behavioralGradeUpdates, recomputeBehavioralGrades, writeGradeUpdates } from './behavioral-grades';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const SELECT = {
  id: true, pnl: true, quantity: true, tradedAt: true, stopLoss: true,
  executionScore: true, executionGrade: true, executionMethod: true,
} as const;

let app: INestApplication;
let prisma: PrismaService;
let userId: string;
let accountId: string;
let otherAccountId: string;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  userId = (await prisma.user.create({ data: { email: `int-b5-grades-${RUN}@test.local`, password: 'x' } })).id;
  [accountId, otherAccountId] = await Promise.all(
    ['A', 'B'].map(async (label) => (await prisma.tradingAccount.create({ data: { userId, label } })).id),
  );
  const setupId = (await prisma.setup.create({ data: { userId, title: 'S', color: '#000' } })).id;
  const t0 = Date.UTC(2026, 6, 10, 12);
  const base = { userId, asset: 'NQ', side: 'LONG' as const, entry: 1, setupId, session: 'LONDON' as const, timeframe: '5m' };
  await prisma.trade.createMany({
    data: [
      ...Array.from({ length: 30 }, (_, i) => ({
        ...base,
        accountId,
        pnl: i % 3 === 0 ? 150 : -(80 + (i % 5) * 40),
        quantity: 1 + (i % 4),
        tradedAt: new Date(t0 + i * 25 * 60_000),
      })),
      // Barème A : stop présent, note intrinsèque → jamais touchée par le recalcul.
      { ...base, accountId, pnl: -50, stopLoss: 10, executionScore: 70, executionGrade: 'BON' as const, executionMethod: 'STOP_BASED' as const, tradedAt: new Date(t0 + 31 * 25 * 60_000) },
      { ...base, accountId: otherAccountId, pnl: -100, tradedAt: new Date(t0) },
    ],
  });
}, 120_000);

afterAll(async () => {
  if (prisma && userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await app?.close().catch(() => undefined);
});

describe('Notes comportementales — écriture groupée (base réelle)', () => {
  it('la base contient exactement les notes calculées, barème A intact, second passage sans écriture', async () => {
    const before = await prisma.trade.findMany({ where: { accountId, pnl: { not: null } }, select: SELECT, orderBy: { tradedAt: 'asc' } });
    const expected = new Map(behavioralGradeUpdates(before).map((u) => [u.id, u]));
    expect(expected.size).toBeGreaterThan(0);

    await recomputeBehavioralGrades(prisma, accountId);

    const after = await prisma.trade.findMany({ where: { accountId }, select: SELECT, orderBy: { tradedAt: 'asc' } });
    for (const t of after) {
      const e = expected.get(t.id);
      if (t.stopLoss != null) {
        expect(t).toMatchObject({ executionScore: 70, executionGrade: 'BON', executionMethod: 'STOP_BASED' });
      } else if (e) {
        expect({ score: t.executionScore, grade: t.executionGrade, method: t.executionMethod }).toEqual({ score: e.score, grade: e.grade, method: e.method });
      }
    }
    expect(behavioralGradeUpdates(after.filter((t) => t.pnl != null))).toEqual([]);
  });

  it('un id d’un autre compte n’est jamais réécrit (filtre accountId), nulls acceptés', async () => {
    const other = await prisma.trade.findFirstOrThrow({ where: { accountId: otherAccountId }, select: { id: true } });
    await writeGradeUpdates(prisma, accountId, [{ id: other.id, score: 90, grade: 'EXCELLENT', method: 'BEHAVIORAL' }]);
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: other.id }, select: { executionGrade: true } })).toEqual({ executionGrade: null });

    const mine = await prisma.trade.findFirstOrThrow({ where: { accountId, stopLoss: null }, select: { id: true } });
    await writeGradeUpdates(prisma, accountId, [{ id: mine.id, score: null, grade: null, method: null }]);
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: mine.id }, select: { executionScore: true, executionGrade: true, executionMethod: true } }))
      .toEqual({ executionScore: null, executionGrade: null, executionMethod: null });
  });
});
