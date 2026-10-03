/**
 * Équivalence des statistiques avant / après le passage en SQL (SCA-B2-01).
 *
 * Étalon : `LegacyAnalyticsService` (src/test/analytics-legacy.service.ts), copie figée du service
 * qui chargeait tous les trades et calculait en JavaScript. Même base, mêmes 5 000 trades
 * aléatoires (graine fixe), chaque calcul est comparé champ par champ : écart toléré ≤ 0,01 sur
 * les montants, égalité stricte sur les comptes, les clés et les libellés.
 *
 * Le jeu de données vise les pièges : trades ouverts (pnl null), break-even exacts, frais absents
 * ou négatifs, R:R nul ou absent, émotion héritée de l'humeur de session ou absente, deux comptes
 * + trades sans compte, setup archivé, dates à cheval sur les changements d'heure (heure et jour
 * dans le fuseau du processus, dates d'activité à Paris).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';
import { LegacyAnalyticsService } from '../../test/analytics-legacy.service';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const EMAIL = `int-b2-equiv-${RUN}@test.local`;
const N = 5000;

// Générateur pseudo-aléatoire à graine fixe (mulberry32) : un échec se rejoue à l'identique.
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
let next: AnalyticsService;
let legacy: LegacyAnalyticsService;
let userId: string;
let accA: string;
let accB: string;

type AnyFn = (...a: unknown[]) => Promise<unknown>;
const call = (svc: unknown, m: string, ...a: unknown[]) => ((svc as Record<string, AnyFn>)[m]).apply(svc, a);

/** Compare deux valeurs JSON : nombres à 0,01 près, le reste à l'identique. */
function expectClose(actual: unknown, expected: unknown, path = '$'): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    expect(Math.abs(actual - expected), `${path} : ${actual} ≠ ${expected}`).toBeLessThanOrEqual(0.01);
    return;
  }
  if (expected instanceof Date || actual instanceof Date) {
    expect(new Date(actual as Date).toISOString(), path).toBe(new Date(expected as Date).toISOString());
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, `${path}.length`).toBe(expected.length);
    expected.forEach((e, i) => expectClose((actual as unknown[])[i], e, `${path}[${i}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    expect(Object.keys(actual as object).sort(), `${path} (clés)`).toEqual(Object.keys(expected).sort());
    for (const k of Object.keys(expected)) expectClose((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  expect(actual, path).toEqual(expected);
}

/** Les deux versions, pour un même calcul. */
async function both(m: string, ...a: unknown[]) {
  const [n, l] = await Promise.all([call(next, m, ...a), call(legacy, m, ...a)]);
  return { n, l };
}
const byKey = <T,>(rows: T[], key: (r: T) => string) => [...rows].sort((a, b) => key(a).localeCompare(key(b)));

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  next = app.get(AnalyticsService);
  legacy = new LegacyAnalyticsService(prisma, app.get(AnalyticsService)['redisService']);

  const r = rng(20261002);
  const user = await prisma.user.create({ data: { email: EMAIL, password: 'x', name: 'B2', startingCapital: 25000 } });
  userId = user.id;
  [accA, accB] = await Promise.all(['A', 'B'].map(async (l) => (await prisma.tradingAccount.create({ data: { userId, label: l } })).id));
  const setups = await Promise.all(
    ['S1', 'S2', 'S3', 'ARCHIVÉ'].map((title, i) =>
      prisma.setup.create({ data: { userId, title, color: '#10b981', sortOrder: i, archived: title === 'ARCHIVÉ' } }),
    ),
  );
  const moods = ['FOCUSED', 'TIRED', null] as const;
  const sessions = await Promise.all(
    moods.map((moodStart) => prisma.tradeSession.create({ data: { userId, moodStart: moodStart ?? undefined } as never })),
  );

  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const t0 = Date.UTC(2024, 0, 1);
  const span = 2 * 365 * 24 * 3600 * 1000;
  const used = new Set<number>();
  const data = Array.from({ length: N }, (_, i) => {
    let ts = t0 + Math.floor(r() * span);
    // Quelques trades autour des passages heure d'été / d'hiver (Europe/Paris).
    if (i % 97 === 0) ts = pick([Date.UTC(2024, 2, 31, 0, 30), Date.UTC(2024, 9, 27, 0, 30), Date.UTC(2025, 2, 30, 1, 15)]) + i * 1000;
    while (used.has(ts)) ts += 1000; // dates distinctes : l'ordre chronologique est sans ambiguïté
    used.add(ts);
    const roll = r();
    // Un trade sur deux à 3 décimales : demi-centimes (10,575…), arrondis identiques JS ≡ SQL.
    const pnl = roll < 0.04 ? null : roll < 0.08 ? 0 : Math.round((r() - 0.45) * 600000) / (i % 2 ? 100 : 1000);
    return {
      userId,
      asset: pick(['NQ', 'ES', 'MNQ', 'EURUSD', 'BTCUSD', 'GC', 'CL', 'YM', 'RTY', 'SI', 'ZB', 'MES']),
      side: pick(['LONG', 'SHORT'] as const),
      entry: 100,
      pnl,
      commission: pick([null, 0, 2.5, 4.08, 1.9, -1.25, 1.905, 0.755]),
      riskReward: pick([null, 0, 1.5, 2, 0.75, 3.2]),
      emotion: pick([null, null, 'CONFIDENT', 'STRESSED', 'REVENGE', 'FEAR', 'FOCUSED', 'NEUTRAL'] as const),
      sessionId: r() < 0.5 ? pick(sessions).id : null,
      setupId: pick(setups).id,
      session: pick(['LONDON', 'NEW_YORK', 'ASIAN'] as const),
      timeframe: '5m',
      accountId: pick([accA, accB, null]),
      tradedAt: new Date(ts),
    };
  });
  await prisma.trade.createMany({ data: data as never });
}, 180_000);

afterAll(async () => {
  if (prisma && userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await app?.close().catch(() => undefined);
});

describe('B2-01 — statistiques SQL ≡ calculs JavaScript d’avant (5 000 trades)', () => {
  const RANGE_FROM = new Date(Date.UTC(2024, 5, 1));
  const RANGE_TO = new Date(Date.UTC(2025, 2, 31, 12));

  it('résumé : tout l’historique, une période, un compte', async () => {
    for (const args of [[userId], [userId, undefined, RANGE_FROM, RANGE_TO], [userId, accA], [userId, accB, RANGE_FROM]]) {
      const { n, l } = await both('computeSummary', ...args);
      expectClose(n, l);
    }
  });

  it('résumé sans aucun trade dans la période', async () => {
    const { n, l } = await both('computeSummary', userId, undefined, new Date(Date.UTC(2030, 0, 1)), new Date(Date.UTC(2030, 1, 1)));
    expectClose(n, l);
  });

  it('par setup : setups actifs dans l’ordre, puis les archivés', async () => {
    for (const acc of [undefined, accA]) {
      const { n, l } = await both('computeBySetup', userId, acc);
      const nn = n as { setupId: string }[];
      const ll = l as { setupId: string }[];
      expectClose(nn.slice(0, 3), ll.slice(0, 3)); // actifs : même ordre (sortOrder)
      expectClose(byKey(nn.slice(3), (x) => x.setupId), byKey(ll.slice(3), (x) => x.setupId));
    }
  });

  it('par émotion (émotion effective, absente exclue)', async () => {
    for (const acc of [undefined, accB]) {
      const { n, l } = await both('computeByEmotion', userId, acc);
      expectClose(byKey(n as { emotion: string }[], (x) => x.emotion), byKey(l as { emotion: string }[], (x) => x.emotion));
    }
  });

  it('par jour et heure (fuseau du processus)', async () => {
    const { n, l } = await both('computeByHour', userId);
    const k = (x: { day: string; hour: number }) => `${x.day}:${String(x.hour).padStart(2, '0')}`;
    expectClose(byKey(n as never[], k), byKey(l as never[], k));
  });

  it('top actifs', async () => {
    for (const acc of [undefined, accA]) {
      const { n, l } = await both('computeTopAssets', userId, acc);
      expectClose(n, l);
    }
  });

  it('courbe d’équité par trade (réduite) et journalière', async () => {
    const eq = await both('computeEquityCurve', userId);
    expectClose(eq.n, eq.l);
    for (const args of [[userId], [userId, RANGE_FROM, RANGE_TO], [userId, RANGE_FROM, RANGE_TO, accA]]) {
      const { n, l } = await both('computeEquityCurveDaily', ...args);
      expectClose(n, l);
    }
  });

  it('activité mensuelle (dont les mois de changement d’heure) et plage glissante', async () => {
    for (const [y, m] of [[2024, 3], [2024, 10], [2025, 3], [2025, 7]]) {
      const { n, l } = await both('computeMonthlyActivity', userId, y, m);
      expectClose(n, l);
    }
    // Calculs appelés directement : les méthodes get* passent par le cache Redis, que les deux
    // versions partageraient (le test serait vrai par construction).
    const [n, l] = await Promise.all([
      call(next, 'computeDailyActivity', userId, { from: RANGE_FROM, to: RANGE_TO }, accB),
      call(legacy, 'computeDailyActivity', userId, { tradedAt: { gte: RANGE_FROM, lte: RANGE_TO } }, accB),
    ]);
    expectClose(n, l);
  });
});
