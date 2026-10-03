/**
 * `closedTradeStats` (SQL, SCA-B2-04) ≡ `computeTradeStats` sur les trades chargés (calcul d'avant
 * des fiches utilisateur de l'admin). 3 000 trades aléatoires à graine fixe : ouverts, break-even,
 * frais absents / positifs / négatifs, centimes qui s'arrondissent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { computeTradeStats } from '@mtc/shared';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { closedTradeStats } from './analytics.sql';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
let app: INestApplication;
let prisma: PrismaService;
let userId: string;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  let seed = 4242;
  const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  userId = (await prisma.user.create({ data: { email: `int-b2-closed-${RUN}@test.local`, password: 'x' } })).id;
  const setup = await prisma.setup.create({ data: { userId, title: 'S', color: '#000' } });
  await prisma.trade.createMany({
    data: Array.from({ length: 3000 }, (_, i) => {
      const roll = r();
      return {
        userId, asset: 'ES', side: 'LONG' as const, entry: 1, setupId: setup.id, session: 'LONDON' as const, timeframe: '5m',
        pnl: roll < 0.07 ? null : roll < 0.13 ? 0 : Math.round((r() - 0.46) * 100000) / 1000, // 3 décimales : arrondis au centime
        commission: [null, 0, 1.905, 2.5, -0.755][Math.floor(r() * 5)],
        tradedAt: new Date(Date.UTC(2025, 0, 1) + i * 60_000),
      };
    }),
  });
}, 120_000);

afterAll(async () => {
  if (prisma && userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await app?.close().catch(() => undefined);
});

describe('B2-04 — closedTradeStats ≡ computeTradeStats', () => {
  it('P&L total, gagnants, perdants et win rate identiques', async () => {
    const trades = await prisma.trade.findMany({ where: { userId, pnl: { not: null } }, select: { pnl: true, commission: true } });
    const before = computeTradeStats(trades);
    const after = await closedTradeStats(prisma, userId);
    expect(after.closed).toBe(before.closed);
    expect(after.wins).toBe(before.wins);
    expect(after.losses).toBe(before.losses);
    expect(Math.abs(after.totalPnl - before.totalPnl)).toBeLessThanOrEqual(0.01);
    expect(after.winRate).toBeCloseTo(before.winRate, 10);
    expect(before.closed).toBeGreaterThan(2500);
  });

  it('utilisateur sans trade → zéros', async () => {
    expect(await closedTradeStats(prisma, 'inexistant')).toEqual({ closed: 0, wins: 0, losses: 0, totalPnl: 0, winRate: 0 });
  });
});
