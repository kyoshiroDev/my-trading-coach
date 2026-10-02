/**
 * Stats du journal en SQL (SCA-B2-02) ≡ calcul JavaScript d'avant, et filtre SQL ≡ filtre Prisma.
 *
 * 1. Pour chaque filtre seul puis 80 combinaisons aléatoires (graine fixe), `buildTradeFilterSql`
 *    sélectionne EXACTEMENT les mêmes trades que `buildTradeWhere` (la liste paginée) : les stats
 *    ne peuvent pas diverger de la liste affichée.
 * 2. Sur ces mêmes combinaisons, `journalStatsSql` ≡ `summarizeJournal(findMany(where))` (l'ancien
 *    calcul, resté dans le code comme étalon), écart ≤ 0,01.
 * Jeu piégeux : trades ouverts, break-even, frais absents ou négatifs, émotion du trade ou humeur
 * de session (dont TIRED, propre aux humeurs), notes d'exécution absentes, plusieurs comptes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { buildTradeFilterSql, buildTradeWhere } from './trade-filters.util';
import { journalStatsSql, summarizeJournal } from './journal-stats.util';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const N = 3000;

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
let userId: string;
let accounts: string[];
let setups: string[];
type F = Parameters<typeof buildTradeWhere>[1];

const EMOTIONS = ['NONE', 'CONFIDENT', 'STRESSED', 'REVENGE', 'FEAR', 'FOCUSED', 'NEUTRAL', 'TIRED', 'INCONNUE'];
const GRADES = ['NONE', 'EXCELLENT', 'BON', 'MOYEN', 'MAUVAIS'];

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  const r = rng(20261002 + 2);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  userId = (await prisma.user.create({ data: { email: `int-b2-journal-${RUN}@test.local`, password: 'x' } })).id;
  accounts = await Promise.all(['A', 'B'].map(async (label) => (await prisma.tradingAccount.create({ data: { userId, label } })).id));
  setups = await Promise.all(['S1', 'S2'].map(async (title) => (await prisma.setup.create({ data: { userId, title, color: '#000' } })).id));
  const sessions = await Promise.all(
    (['TIRED', 'FOCUSED', 'CONFIDENT', null] as const).map(async (moodStart) =>
      (await prisma.tradeSession.create({ data: { userId, moodStart: moodStart ?? undefined } as never })).id,
    ),
  );
  const t0 = Date.UTC(2025, 0, 1);
  await prisma.trade.createMany({
    data: Array.from({ length: N }, (_, i) => {
      const roll = r();
      return {
        userId,
        asset: 'NQ',
        side: pick(['LONG', 'SHORT'] as const),
        entry: 1,
        pnl: roll < 0.06 ? null : roll < 0.12 ? 0 : Math.round((r() - 0.45) * 40000) / 100,
        commission: pick([null, 0, 2.5, 4.08, -1.25]),
        emotion: pick([null, null, 'CONFIDENT', 'STRESSED', 'REVENGE', 'FEAR', 'FOCUSED', 'NEUTRAL'] as const),
        sessionId: r() < 0.6 ? pick(sessions) : null,
        executionGrade: pick([null, 'EXCELLENT', 'BON', 'MOYEN', 'MAUVAIS'] as const),
        setupId: pick(setups),
        session: 'LONDON' as const,
        timeframe: '5m',
        accountId: pick([...accounts, null]),
        tradedAt: new Date(t0 + i * 3_600_000),
      };
    }) as never,
  });
}, 180_000);

afterAll(async () => {
  if (prisma && userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await app?.close().catch(() => undefined);
});

/** Chaque filtre seul, puis des combinaisons aléatoires. */
function filterCases(): F[] {
  const dims: Record<keyof F, unknown[]> = {
    accountId: ['all', ...[0, 1].map((i) => () => accounts[i])],
    side: ['LONG', 'SHORT'],
    setupId: [() => setups[0], () => setups[1]],
    emotion: EMOTIONS,
    result: ['WIN', 'LOSS', 'BREAKEVEN'],
    executionGrade: GRADES,
    dateFrom: ['2025-02-01T00:00:00.000Z'],
    dateTo: ['2025-03-15T12:00:00.000Z'],
  };
  const val = (v: unknown) => (typeof v === 'function' ? (v as () => string)() : v);
  const cases: F[] = [{}];
  for (const [k, vs] of Object.entries(dims)) for (const v of vs) cases.push({ [k]: val(v) } as F);
  const r = rng(77);
  for (let i = 0; i < 80; i++) {
    const c: Record<string, unknown> = {};
    for (const [k, vs] of Object.entries(dims)) if (r() < 0.45) c[k] = val(vs[Math.floor(r() * vs.length)]);
    cases.push(c as F);
  }
  return cases;
}

const label = (f: F) => JSON.stringify(f);

describe('B2-02 — filtre SQL ≡ filtre Prisma, stats SQL ≡ stats JavaScript', () => {
  it('le filtre SQL sélectionne exactement les mêmes trades que la liste (filtres seuls + 80 combinaisons)', async () => {
    let nonEmpty = 0;
    for (const f of filterCases()) {
      const prismaIds = (await prisma.trade.findMany({ where: buildTradeWhere(userId, f), select: { id: true } })).map((t) => t.id).sort();
      const sqlIds = (
        await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT t."id" FROM "Trade" t LEFT JOIN "TradeSession" s ON s."id" = t."sessionId"
          WHERE ${buildTradeFilterSql(userId, f)}`)
      ).map((t) => t.id).sort();
      expect(sqlIds, label(f)).toEqual(prismaIds);
      if (prismaIds.length) nonEmpty++;
    }
    expect(nonEmpty).toBeGreaterThan(40); // les combinaisons sélectionnent bien quelque chose
  }, 120_000);

  it('les stats SQL égalent l’ancien calcul (summarizeJournal) pour chaque combinaison', async () => {
    for (const f of filterCases()) {
      const trades = await prisma.trade.findMany({ where: buildTradeWhere(userId, f), select: { pnl: true, commission: true } });
      const before = summarizeJournal(trades);
      const after = await journalStatsSql(prisma, buildTradeFilterSql(userId, f));
      for (const k of Object.keys(before) as (keyof typeof before)[]) {
        expect(Math.abs(after[k] - before[k]), `${label(f)} · ${k} : ${after[k]} ≠ ${before[k]}`).toBeLessThanOrEqual(0.01);
      }
    }
  }, 120_000);
});
