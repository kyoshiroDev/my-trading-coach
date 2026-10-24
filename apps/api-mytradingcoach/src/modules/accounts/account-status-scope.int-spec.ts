/**
 * Compte perdu, sur la vraie base : les comptes ÉCHOUÉS et ARCHIVÉS sortent de toutes les
 * statistiques « tous les comptes », VALIDÉS et trades sans compte restent comptés, un compte
 * précis reste lisible, `includeInactive` réinclut tout, et le changement de statut se voit
 * immédiatement (cache analytics invalidé).
 *
 * Ce que les specs unitaires ne prouvent pas : que la version Prisma (`inactiveAccountsTradeWhere`)
 * et la version SQL (`inactiveAccountsTradeSql`) sélectionnent EXACTEMENT les mêmes trades, et que
 * chaque statistique du service les applique sur de vraies lignes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, INestApplication } from '@nestjs/common';
import { AccountStatus, Plan, Prisma, Role } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { TradesService } from '../trades/trades.service';
import { AccountsService } from './accounts.service';
import { inactiveAccountsTradeSql, inactiveAccountsTradeWhere, type AccountScope } from './account-status-scope';

const PREFIX = 'int-compte-perdu-';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

let app: INestApplication;
let prisma: PrismaService;
let analytics: AnalyticsService;
let accounts: AccountsService;
let trades: TradesService;

/** Un utilisateur et ses comptes : un trade de P&L connu par compte, plus un trade sans compte. */
interface Fixture {
  userId: string;
  ids: Record<'active' | 'passed' | 'failed' | 'archived', string>;
}

// Il y a 2 minutes : dans le mois courant (carte du mois, activité du mois), sans dépendre du jour.
const at = () => new Date(Date.now() - 2 * 60_000);

async function seed(statuses: Partial<Record<keyof Fixture['ids'], number>>, orphanPnl: number | null = 10): Promise<Fixture> {
  const user = await prisma.user.create({
    data: { email: `${PREFIX}${uid()}@test.local`, password: 'x', name: 'Compte perdu' },
  });
  const setup = await prisma.setup.create({ data: { userId: user.id, title: 'S', color: '#10b981', sortOrder: 0 } });
  const status: Record<keyof Fixture['ids'], AccountStatus> = {
    active: AccountStatus.ACTIVE, passed: AccountStatus.PASSED, failed: AccountStatus.FAILED, archived: AccountStatus.ARCHIVED,
  };
  const ids = {} as Fixture['ids'];
  for (const [key, pnl] of Object.entries(statuses) as [keyof Fixture['ids'], number][]) {
    const acc = await prisma.tradingAccount.create({
      data: { userId: user.id, label: `${key} 50K #1`, status: status[key], propFirmPlanId: null, accountSize: 50_000 },
    });
    ids[key] = acc.id;
    await prisma.trade.create({
      data: {
        userId: user.id, accountId: acc.id, setupId: setup.id, asset: `NQ-${key}`, side: 'LONG', entry: 1, exit: 2,
        pnl, commission: 0, session: 'NEW_YORK', timeframe: 'M5', emotion: 'FOCUSED', tags: [], tradedAt: at(),
      },
    });
  }
  if (orphanPnl !== null) {
    await prisma.trade.create({
      data: {
        userId: user.id, accountId: null, setupId: setup.id, asset: 'ES-orphan', side: 'LONG', entry: 1, exit: 2,
        pnl: orphanPnl, commission: 0, session: 'NEW_YORK', timeframe: 'M5', emotion: 'FOCUSED', tags: [], tradedAt: at(),
      },
    });
  }
  return { userId: user.id, ids };
}

/** Une valeur de P&L total par statistique, pour comparer toutes les routes d'un coup. */
async function totals(userId: string, accountId?: string, includeInactive = false): Promise<Record<string, number>> {
  const from = new Date(Date.now() - 86_400_000);
  const to = new Date(Date.now() + 60_000);
  const now = new Date();
  const sum = (xs: { pnl: number }[]) => Math.round(xs.reduce((a, x) => a + x.pnl, 0) * 100) / 100;
  const last = (pts: { cumulativePnl: number }[]) => pts.at(-1)?.cumulativePnl ?? 0;
  const [summary, bySetup, topAssets, equity, daily, month, monthly, range, byEmotion, byHour] = await Promise.all([
    analytics.getSummary(userId, accountId, undefined, undefined, includeInactive),
    analytics.getBySetup(userId, accountId, includeInactive),
    analytics.getTopAssets(userId, accountId, includeInactive),
    analytics.getEquityCurve(userId, accountId, includeInactive),
    analytics.getEquityCurveDaily(userId, from, to, accountId, includeInactive),
    analytics.getEquityCurveCurrentMonth(userId, accountId, includeInactive),
    analytics.getMonthlyActivity(userId, now.getFullYear(), now.getMonth() + 1, accountId, includeInactive),
    analytics.getActivityRange(userId, from, to, accountId, includeInactive),
    analytics.getByEmotion(userId, accountId, includeInactive),
    analytics.getByHour(userId, accountId, includeInactive),
  ]);
  return {
    summary: summary.totalPnl,
    bySetup: sum(bySetup),
    topAssets: sum(topAssets),
    equity: last(equity.points),
    daily: last(daily.points),
    month: last(month.points),
    monthly: monthly.totalPnl,
    range: sum(range.days),
    // Statistiques sans P&L : leur nombre de trades.
    countSummary: summary.totalTrades,
    countEmotion: byEmotion.reduce((a, e) => a + e.count, 0),
    countHour: byHour.reduce((a, e) => a + e.count, 0),
  };
}

/** Résultat attendu : le même P&L sur toutes les routes, le même nombre de trades. */
const everywhere = (pnl: number, count: number) => ({
  summary: pnl, bySetup: pnl, topAssets: pnl, equity: pnl, daily: pnl, month: pnl, monthly: pnl, range: pnl,
  countSummary: count, countEmotion: count, countHour: count,
});

let fx: Fixture;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  analytics = app.get(AnalyticsService);
  accounts = app.get(AccountsService);
  trades = app.get(TradesService);
  // Actif +100, validé +50, échoué −300, archivé −200, sans compte +10.
  fx = await seed({ active: 100, passed: 50, failed: -300, archived: -200 });
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('règle unique : Prisma ≡ SQL', () => {
  const selected = async (scope: AccountScope) => {
    const viaPrisma = await prisma.trade.findMany({
      where: { userId: fx.userId, ...(scope.accountId ? { accountId: scope.accountId } : {}), ...inactiveAccountsTradeWhere(scope) },
      select: { id: true },
    });
    const accountSql = scope.accountId ? Prisma.sql`AND t."accountId" = ${scope.accountId}` : Prisma.empty;
    const filter = inactiveAccountsTradeSql(scope);
    const viaSql = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT t."id" FROM "Trade" t
      WHERE t."userId" = ${fx.userId} ${accountSql} ${filter === Prisma.empty ? Prisma.empty : Prisma.sql`AND ${filter}`}`);
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
    return { prisma: ids(viaPrisma), sql: ids(viaSql) };
  };

  it.each<[string, () => AccountScope, number]>([
    ['par défaut : actif + validé + sans compte', () => ({}), 3],
    ['includeInactive : tout', () => ({ includeInactive: true }), 5],
    ['compte échoué choisi', () => ({ accountId: fx.ids.failed }), 1],
    ['compte archivé choisi', () => ({ accountId: fx.ids.archived }), 1],
  ])('%s', async (_l, scope, expected) => {
    const { prisma: p, sql } = await selected(scope());
    expect(sql).toEqual(p);
    expect(p).toHaveLength(expected);
  });
});

describe('statistiques « tous les comptes » (chaque route du service)', () => {
  it('par défaut : échoué et archivé exclus, validé et trade sans compte comptés (100 + 50 + 10)', async () => {
    expect(await totals(fx.userId)).toEqual(everywhere(160, 3));
  });

  it('includeInactive : tout réinclus (160 − 300 − 200)', async () => {
    expect(await totals(fx.userId, undefined, true)).toEqual(everywhere(-340, 5));
  });

  it('compte échoué choisi : ses chiffres, normalement', async () => {
    expect(await totals(fx.userId, fx.ids.failed)).toEqual(everywhere(-300, 1));
  });

  it('compte archivé choisi : ses chiffres, normalement', async () => {
    expect(await totals(fx.userId, fx.ids.archived)).toEqual(everywhere(-200, 1));
  });

  it('compte validé : compté dans « tous les comptes » et lisible seul', async () => {
    expect((await totals(fx.userId, fx.ids.passed)).summary).toBe(50);
  });
});

describe('cas limites', () => {
  it('tous les comptes échoués : statistiques vides par défaut, chiffres complets avec includeInactive', async () => {
    const f = await seed({ failed: -300, archived: -200 }, null);
    expect(await totals(f.userId)).toEqual(everywhere(0, 0));
    expect((await totals(f.userId, undefined, true)).summary).toBe(-500);
  });

  it('aucun compte, seulement des trades sans compte : tout est compté', async () => {
    const f = await seed({}, 42);
    expect((await totals(f.userId)).summary).toBe(42);
  });

  it('aucun trade : zéros, sans erreur', async () => {
    const f = await seed({}, null);
    expect(await totals(f.userId)).toEqual(everywhere(0, 0));
  });
});

describe('changement de statut : visible tout de suite (cache invalidé)', () => {
  it('marquer le compte actif comme échoué le retire des chiffres, le réactiver le remet', async () => {
    const f = await seed({ active: 100, passed: 50 }, null);
    const premium = { plan: Plan.PREMIUM, role: Role.USER, trialEndsAt: null };
    expect((await totals(f.userId)).summary).toBe(150); // met aussi le résultat en cache

    await accounts.update(f.userId, f.ids.active, { status: AccountStatus.FAILED } as never, premium);
    expect((await totals(f.userId)).summary).toBe(50);

    await accounts.update(f.userId, f.ids.active, { status: AccountStatus.ACTIVE } as never, premium);
    expect((await totals(f.userId)).summary).toBe(150);
  });
});

describe('journal : chiffres du haut filtrés, liste complète', () => {
  it('par défaut : échoué et archivé hors des chiffres, nombre de comptes exclus exposé', async () => {
    const st = await trades.computeJournalStats(fx.userId, {} as never);
    expect(st).toMatchObject({ totalTrades: 3, pnlNet: 160, excludedAccounts: { failed: 1, archived: 1 } });
  });

  it('includeInactive : tout réinclus, aucun compte exclu', async () => {
    const st = await trades.computeJournalStats(fx.userId, { includeInactive: true } as never);
    expect(st).toMatchObject({ totalTrades: 5, pnlNet: -340, excludedAccounts: { failed: 0, archived: 0 } });
  });

  it('compte échoué choisi : ses chiffres, aucun compte exclu', async () => {
    const st = await trades.computeJournalStats(fx.userId, { accountId: fx.ids.failed } as never);
    expect(st).toMatchObject({ totalTrades: 1, pnlNet: -300, excludedAccounts: { failed: 0, archived: 0 } });
  });

  it('autres filtres conservés (résultat perdant) en plus du filtre des comptes perdus', async () => {
    const st = await trades.computeJournalStats(fx.userId, { result: 'LOSS' } as never);
    expect(st.totalTrades).toBe(0); // seuls perdants : échoué et archivé, exclus
  });
});

describe('journal : garde tous les trades, avec le statut du compte', () => {
  it('trades des comptes échoués et archivés présents, statut exposé pour le badge', async () => {
    const page = await trades.findAll(fx.userId, { limit: 50 } as never);
    expect(page.data).toHaveLength(5);
    const statuses = page.data.map((t) => (t as { account?: { status: string } | null }).account?.status ?? null).sort();
    expect(statuses).toEqual(['ACTIVE', 'ARCHIVED', 'FAILED', 'PASSED', null].sort());
  });
});

describe('nouvelle tentative (vraie base)', () => {
  it('libellé incrémenté, mêmes règles, aucun trade copié, puis #3', async () => {
    const f = await seed({ failed: -300 }, null);
    await prisma.tradingAccount.update({
      where: { id: f.ids.failed },
      data: { label: 'Apex 50K #1', maxDrawdown: 2500, profitTarget: 3000, broker: 'Apex' },
    });
    const premium = { plan: Plan.PREMIUM, role: Role.USER, trialEndsAt: null };

    const second = await accounts.retry(f.userId, f.ids.failed, premium);
    expect(second).toMatchObject({ label: 'Apex 50K #2', status: 'ACTIVE', maxDrawdown: 2500, profitTarget: 3000, broker: 'Apex', accountSize: 50_000 });
    expect(await prisma.trade.count({ where: { accountId: second.id } })).toBe(0);
    expect(await prisma.brokerConnection.count({ where: { accountId: second.id } })).toBe(0);

    // Le #1 a déjà sa suite : 409, pas de #3 ; le #3 part du #2 une fois échoué.
    await expect(accounts.retry(f.userId, f.ids.failed, premium)).rejects.toMatchObject({ status: 409 });
    await prisma.tradingAccount.update({ where: { id: second.id }, data: { status: AccountStatus.FAILED } });
    const third = await accounts.retry(f.userId, second.id, premium);
    expect(third.label).toBe('Apex 50K #3');
  });

  it('FREE : l’échoué libère sa place ; 2e clic → 409 RETRY_EXISTS, jamais le message de quota', async () => {
    const f = await seed({ failed: -300 }, null);
    const free = { plan: Plan.FREE, role: Role.USER, trialEndsAt: null };
    const second = await accounts.retry(f.userId, f.ids.failed, free);
    const err = await accounts.retry(f.userId, f.ids.failed, free).then(() => null, (e: ConflictException) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err!.getResponse()).toMatchObject({ code: 'RETRY_EXISTS', accountId: second.id, label: second.label });
  });

  it('deux requêtes simultanées (double clic) : un seul compte créé, l’autre reçoit 409', async () => {
    const f = await seed({ failed: -300 }, null);
    await prisma.tradingAccount.update({ where: { id: f.ids.failed }, data: { label: 'Apex 50K #1' } });
    const premium = { plan: Plan.PREMIUM, role: Role.USER, trialEndsAt: null };
    const results = await Promise.allSettled([
      accounts.retry(f.userId, f.ids.failed, premium),
      accounts.retry(f.userId, f.ids.failed, premium),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect(await prisma.tradingAccount.count({ where: { userId: f.userId, label: { startsWith: 'Apex 50K #' } } })).toBe(2);
  });
});
