/**
 * Métriques des comptes en SQL (SCA-B2-03) ≡ calcul JavaScript d'avant.
 *
 * `list()` (agrégats SQL) est comparé, compte par compte, à l'ancien chemin : chargement des trades
 * fermés puis `computeRuleMetrics` (= `aggregateRuleTrades`, l'étalon). Comptes aux règles variées
 * (drawdown STATIC / TRAILING, objectif ou non, compte sans trade), 4 000 trades avec commissions
 * absentes, nulles, positives et NÉGATIVES (la règle des comptes les lit signées), plusieurs trades
 * par jour UTC, trades hors compte. Graine fixe.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountsService } from './accounts.service';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let app: INestApplication;
let prisma: PrismaService;
let service: AccountsService;
let userId: string;

function close(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    expect(Math.abs(actual - expected), `${path} : ${actual} ≠ ${expected}`).toBeLessThanOrEqual(0.01);
  } else if (expected && typeof expected === 'object') {
    expect(Object.keys(actual as object).sort(), path).toEqual(Object.keys(expected).sort());
    for (const k of Object.keys(expected)) close((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`);
  } else {
    expect(actual, path).toEqual(expected);
  }
}

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  service = app.get(AccountsService);
  const r = rng(20261002 + 3);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  userId = (await prisma.user.create({ data: { email: `int-b2-acc-${RUN}@test.local`, password: 'x' } })).id;
  const setup = await prisma.setup.create({ data: { userId, title: 'S', color: '#000' } });
  const configs = [
    { label: 'Static', accountSize: 50000, profitTarget: 3000, maxDrawdown: 2000, drawdownType: 'STATIC' },
    { label: 'Trailing', accountSize: 50000, profitTarget: 3000, maxDrawdown: 2500, drawdownType: 'TRAILING' },
    { label: 'Trailing départ', startingBalance: 25000, maxDrawdown: 1500, drawdownType: 'TRAILING' },
    { label: 'Sans règle', accountSize: 10000 },
    { label: 'Vide', accountSize: 100000, maxDrawdown: 3000, drawdownType: 'TRAILING', profitTarget: 6000 },
  ];
  const ids: string[] = [];
  for (const c of configs) ids.push((await prisma.tradingAccount.create({ data: { userId, ...c } as never })).id);
  const withTrades = ids.slice(0, 4);
  const t0 = Date.UTC(2025, 0, 2, 13);
  await prisma.trade.createMany({
    data: Array.from({ length: 4000 }, (_, i) => {
      const roll = r();
      return {
        userId,
        asset: 'NQ',
        side: 'LONG' as const,
        entry: 1,
        pnl: roll < 0.05 ? null : roll < 0.1 ? 0 : Math.round((r() - 0.47) * 800000) / (i % 2 ? 100 : 1000),
        commission: pick([null, 0, 4.2, 2.5, -1.75, 1.905]),
        setupId: setup.id,
        session: 'NEW_YORK' as const,
        timeframe: '1m',
        accountId: r() < 0.08 ? null : pick(withTrades),
        tradedAt: new Date(t0 + i * 37 * 60_000 + Math.floor(r() * 30) * 1000), // ~1 h : plusieurs trades par jour
      };
    }) as never,
  });
}, 180_000);

afterAll(async () => {
  if (prisma && userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await app?.close().catch(() => undefined);
});

describe('B2-03 — métriques des comptes : SQL ≡ calcul JavaScript d’avant', () => {
  it('list() égale computeRuleMetrics(trades chargés) pour chaque compte', async () => {
    const listed = await service.list(userId);
    expect(listed).toHaveLength(5);
    for (const a of listed) {
      const trades = await prisma.trade.findMany({
        where: { userId, accountId: a.id, pnl: { not: null } },
        select: { pnl: true, commission: true, tradedAt: true },
        orderBy: { tradedAt: 'asc' },
      });
      close(a.metrics, service.computeRuleMetrics(a, trades), a.label);
    }
    const empty = listed.find((a) => a.label === 'Vide')!;
    expect(empty.metrics).toMatchObject({ tradesCount: 0, winRate: null, bestDay: null, worstDay: null, realizedPnl: 0 });
    const trailing = listed.find((a) => a.label === 'Trailing')!;
    expect(trailing.metrics.tradesCount).toBeGreaterThan(500); // le jeu exerce vraiment les comptes
  });
});
