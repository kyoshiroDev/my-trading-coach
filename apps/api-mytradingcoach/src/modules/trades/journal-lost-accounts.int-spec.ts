/**
 * Comptes archivés cohérents partout (journal), sur la vraie base. Cas réel du 09/11 :
 * 1 compte actif, 3 trades le vendredi 6/11 (+447, −267,50, −268 = −88,50) ; 3 comptes archivés
 * avec des trades (6/11 : −300 et −232,56 ; 4/11 : +16 158,86). Interrupteur allumé, la journée
 * du 6/11 fait 5 trades −621,06 et la semaine +15 537,80 (les chiffres de la capture).
 *
 * Règle : la liste (`findAll`, donc les en-têtes de jour et de semaine calculés dessus) et la barre
 * de chiffres (`computeJournalStats`) lisent le MÊME jeu de trades. Comptes échoués et archivés
 * exclus par défaut, réinclus par `includeInactive`, compte précis toujours lisible. Même règle
 * vérifiée sur trois autres écrans : Statistiques (`getSummary`), Historique des sessions, premier
 * récap de semaine (e-mail). Aucun appel à l'IA.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { AccountStatus, SessionStatus } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { freezeClock } from '../../test/freeze-clock';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { SessionService } from '../session/session.service';
import { loadFirstWeek } from '../resend/campaigns/campaign-registry';
import { TradesService } from './trades.service';
import type { TradeFiltersDto } from './dto/trade-filters.dto';

const PREFIX = 'int-archives-coherents-';
const NOW = '2026-11-09T10:00:00.000Z';

let app: INestApplication;
let prisma: PrismaService;
let trades: TradesService;
let analytics: AnalyticsService;
let sessions: SessionService;
let userId: string;
let activeId: string;
let archivedIds: string[];

const round = (n: number) => Math.round(n * 100) / 100;
const net = (rows: { pnl: number | null; commission: number | null }[]) =>
  round(rows.reduce((s, t) => s + (t.pnl ?? 0) - Math.abs(t.commission ?? 0), 0));

/** Liste complète (toutes les pages) + barre de chiffres, pour les mêmes filtres. */
async function journal(filters: Partial<TradeFiltersDto>) {
  const rows: Awaited<ReturnType<TradesService['findAll']>>['data'] = [];
  let cursor: string | undefined;
  do {
    const page = await trades.findAll(userId, { limit: 2, ...filters, cursor } as TradeFiltersDto);
    rows.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const stats = await trades.computeJournalStats(userId, filters as TradeFiltersDto);
  return { rows, stats };
}

/** Journée Paris d'un trade (même clé que les en-têtes du journal). */
const parisDay = (d: Date) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  trades = app.get(TradesService);
  analytics = app.get(AnalyticsService);
  sessions = app.get(SessionService);

  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}${Date.now().toString(36)}@test.local`, password: 'x', name: 'Archives',
      createdAt: new Date('2026-11-03T08:00:00.000Z'),
    },
  });
  userId = user.id;
  const account = (label: string, status: AccountStatus) =>
    prisma.tradingAccount.create({ data: { userId, label, status, accountSize: 50_000 } });
  activeId = (await account('Apex 50K #2', AccountStatus.ACTIVE)).id;
  archivedIds = [
    (await account('Lucid 25K', AccountStatus.ARCHIVED)).id,
    (await account('Topstep 50K', AccountStatus.ARCHIVED)).id,
    (await account('Apex 50K #1', AccountStatus.ARCHIVED)).id,
  ];

  const session = (accountId: string, day: string, totalPnl: number, totalTrades: number) =>
    prisma.tradeSession.create({
      data: {
        userId, accountId, status: SessionStatus.CLOSED, moodStart: 'FOCUSED', totalPnl, totalTrades,
        startedAt: new Date(`${day}T13:00:00.000Z`), endedAt: new Date(`${day}T17:00:00.000Z`),
      },
    });
  const setup = await prisma.setup.create({ data: { userId, title: 'Breakout', color: '#10b981', sortOrder: 0 } });
  const trade = (accountId: string, at: string, pnl: number) =>
    prisma.trade.create({
      data: {
        userId, accountId, setupId: setup.id, emotion: 'FOCUSED', asset: 'MNQ', side: 'LONG', entry: 1, exit: 2, pnl, commission: 0,
        session: 'NEW_YORK', timeframe: 'M5', tags: [], tradedAt: new Date(at),
      },
    });
  await session(activeId, '2026-11-06', -88.5, 3);
  await session(archivedIds[0], '2026-11-06', -300, 1);
  await trade(activeId, '2026-11-06T16:00:00.000Z', 447);
  await trade(activeId, '2026-11-06T15:00:00.000Z', -267.5);
  await trade(activeId, '2026-11-06T14:00:00.000Z', -268);
  await trade(archivedIds[0], '2026-11-06T13:30:00.000Z', -300);
  await trade(archivedIds[1], '2026-11-06T13:00:00.000Z', -232.56);
  await trade(archivedIds[2], '2026-11-04T14:00:00.000Z', 16_158.86);
}, 60_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close();
});

describe('Journal — comptes archivés : liste, en-têtes et barre sur le même jeu de trades', () => {
  freezeClock(NOW);

  it('interrupteur éteint : 3 trades, journée du 6/11 « 3 trades −88,50 », barre identique', async () => {
    const { rows, stats } = await journal({});
    expect(rows).toHaveLength(3);
    expect(rows.every((t) => t.accountId === activeId)).toBe(true);
    const nov6 = rows.filter((t) => parisDay(t.tradedAt) === '2026-11-06');
    expect(nov6).toHaveLength(3);
    expect(net(nov6)).toBe(-88.5);
    expect(stats.totalTrades).toBe(rows.length);
    expect(round(stats.pnlNet)).toBe(net(rows));
    expect(stats.excludedAccounts).toEqual({ failed: 0, archived: 3 });
  });

  it('semaine du 2 au 8/11 : en-tête (liste) = barre de chiffres, interrupteur éteint puis allumé', async () => {
    const week = { dateFrom: '2026-11-01T23:00:00.000Z', dateTo: '2026-11-08T22:59:59.999Z' };
    const off = await journal(week);
    expect(off.stats.totalTrades).toBe(off.rows.length);
    expect(round(off.stats.pnlNet)).toBe(net(off.rows));
    expect(net(off.rows)).toBe(-88.5);

    const on = await journal({ ...week, includeInactive: true });
    expect(on.rows).toHaveLength(6);
    expect(on.stats.totalTrades).toBe(6);
    expect(net(on.rows)).toBe(15_537.8);
    expect(round(on.stats.pnlNet)).toBe(15_537.8);
  });

  it('interrupteur allumé : tous les trades, statut « Archivé » exposé pour le badge, journée 5 trades −621,06', async () => {
    const { rows, stats } = await journal({ includeInactive: true });
    expect(rows).toHaveLength(6);
    expect(rows.filter((t) => t.account?.status === AccountStatus.ARCHIVED)).toHaveLength(3);
    const nov6 = rows.filter((t) => parisDay(t.tradedAt) === '2026-11-06');
    expect(nov6).toHaveLength(5);
    expect(net(nov6)).toBe(-621.06);
    expect(stats.totalTrades).toBe(6);
    expect(round(stats.pnlNet)).toBe(net(rows));
    expect(stats.excludedAccounts).toEqual({ failed: 0, archived: 0 });
  });

  it('« partiel » et « 20+ » : la pagination porte sur le jeu filtré (pas de page fantôme des archivés)', async () => {
    // 3 trades visibles, page de 3 : rien après → aucun jour « partiel » (avant : 3 archivés en plus).
    const off = await trades.findAll(userId, { limit: 3 } as TradeFiltersDto);
    expect(off.data).toHaveLength(3);
    expect(off.hasNextPage).toBe(false);
    const on = await trades.findAll(userId, { limit: 3, includeInactive: true } as TradeFiltersDto);
    expect(on.hasNextPage).toBe(true);
  });

  it('compte archivé choisi (lien « Voir les trades ») : ses trades restent lisibles, sans interrupteur', async () => {
    const { rows, stats } = await journal({ accountId: archivedIds[0] });
    expect(rows.map((t) => t.pnl)).toEqual([-300]);
    expect(stats.totalTrades).toBe(1);
    expect(stats.pnlNet).toBe(-300);
  });

  it('compte repassé actif : ses trades reviennent dans la liste ET la barre', async () => {
    await prisma.tradingAccount.update({ where: { id: archivedIds[1] }, data: { status: AccountStatus.ACTIVE } });
    try {
      const { rows, stats } = await journal({});
      expect(rows).toHaveLength(4);
      expect(stats.totalTrades).toBe(4);
      expect(round(stats.pnlNet)).toBe(-321.06);
    } finally {
      await prisma.tradingAccount.update({ where: { id: archivedIds[1] }, data: { status: AccountStatus.ARCHIVED } });
    }
  });
});

describe('Mêmes comptes, autres écrans', () => {
  freezeClock(NOW);

  it('Statistiques (résumé) : −88,50 par défaut, +15 537,80 avec includeInactive', async () => {
    expect((await analytics.getSummary(userId)).totalPnl).toBe(-88.5);
    expect((await analytics.getSummary(userId, undefined, undefined, undefined, true)).totalPnl).toBe(15_537.8);
  });

  it('Historique des sessions : séance du compte archivé masquée par défaut, visible avec includeInactive ou sur le compte', async () => {
    const def = await sessions.getSessionHistory(userId, 50, 0, { year: 2026, month: 11 });
    expect(def.map((s) => s.totalPnl)).toEqual([-88.5]);
    const all = await sessions.getSessionHistory(userId, 50, 0, { year: 2026, month: 11, includeInactive: true });
    expect(all.map((s) => s.totalPnl ?? 0).sort((a, b) => a - b)).toEqual([-300, -88.5]);
    const one = await sessions.getSessionHistory(userId, 50, 0, { year: 2026, month: 11, accountId: archivedIds[0] });
    expect(one.map((s) => s.totalPnl)).toEqual([-300]);
  });

  it('E-mail « premier récap de semaine » : seulement les trades du compte actif', async () => {
    const ctx = await loadFirstWeek({ prisma, founderState: async () => ({ open: false, seatsLeft: 0, seatsTotal: 0 }) }, [userId]);
    expect(ctx.get(userId)).toMatchObject({ firstWeek: { trades: 3, days: 1 } });
  });
});
