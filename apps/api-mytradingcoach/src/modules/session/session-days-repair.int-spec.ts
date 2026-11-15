/**
 * #1000 : séances qui portent des trades d'autres journées (données d'avant le correctif N1, #994).
 * Vraie base : essai sans écriture, puis réparation (trade déplacé vers la séance de sa journée,
 * trade sans séance ce jour-là sorti), totaux des séances recalculés, sauvegarde lisible, 2e passage à vide.
 * La base d'intégration est partagée : les nombres du rapport sont des minimums, l'état exact est
 * vérifié sur les lignes de ce test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { SessionStatus, TradeSide, TradingSession } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionDaysRepairService, type SessionDaysRepairReport } from './session-days-repair.service';

const PREFIX = 'int-session-days-repair-';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    // Trade / TradeSession en SetNull sur l'utilisateur : supprimés explicitement.
    await prisma.trade.deleteMany({ where: { userId: { in: ids } } });
    await prisma.tradeSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await app?.close().catch(() => undefined);
});

describe('Réparation des séances : trades d’autres journées (#1000)', () => {
  it('essai sans écriture, puis trades remis dans leur journée et totaux recalculés', async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}${uid()}@test.local`, name: 'Int Seances' } });
    const userId = user.id;
    const account = await prisma.tradingAccount.create({ data: { userId, label: 'Apex' } });
    const setup = await prisma.setup.create({ data: { userId, title: 'Int', color: '#3b82f6' } });
    const closed = (startedAt: string) =>
      prisma.tradeSession.create({
        data: { userId, accountId: account.id, startedAt: new Date(startedAt), status: SessionStatus.CLOSED, moodStart: 'FOCUSED', totalTrades: 0 },
      });
    const s10 = await closed('2026-11-10T14:00:00Z');
    const s05 = await closed('2026-11-05T14:00:00Z');
    const trade = (tradedAt: string, pnl: number) =>
      prisma.trade.create({
        data: {
          userId, accountId: account.id, sessionId: s10.id, asset: 'MNQ', side: TradeSide.LONG, entry: 1, pnl,
          setupId: setup.id, session: TradingSession.NEW_YORK, timeframe: '1m', tags: [], tradedAt: new Date(tradedAt),
        },
      });
    const ok = await trade('2026-11-10T15:00:00Z', 100);
    const old = await trade('2026-11-05T15:00:00Z', -40);
    const orphan = await trade('2026-11-03T15:00:00Z', 25);
    // Totaux faussés comme en prod : la séance du 10 compte les 3 trades.
    await prisma.tradeSession.update({ where: { id: s10.id }, data: { totalPnl: 85, totalTrades: 3 } });

    // Trader démo avec le même défaut : jamais touché (comptes démo exclus).
    const demo = await prisma.user.create({ data: { email: `${PREFIX}demo-${uid()}@test.local`, name: 'Int Demo', isDemo: true } });
    const demoSetup = await prisma.setup.create({ data: { userId: demo.id, title: 'Int', color: '#3b82f6' } });
    const demoSession = await prisma.tradeSession.create({
      data: { userId: demo.id, startedAt: new Date('2026-11-10T14:00:00Z'), status: SessionStatus.CLOSED, totalTrades: 1 },
    });
    const demoTrade = await prisma.trade.create({
      data: {
        userId: demo.id, sessionId: demoSession.id, asset: 'MNQ', side: TradeSide.LONG, entry: 1, pnl: 10,
        setupId: demoSetup.id, session: TradingSession.NEW_YORK, timeframe: '1m', tags: [], tradedAt: new Date('2026-11-05T15:00:00Z'),
      },
    });

    const repair = app.get(SessionDaysRepairService);
    const dry = (await repair.run(false)) as SessionDaysRepairReport;
    expect(dry).toMatchObject({ apply: false, backedUp: 0 });
    expect(dry.misplaced).toBeGreaterThanOrEqual(2);
    expect(dry.moved).toBeGreaterThanOrEqual(1);
    expect(dry.detachedNoSession).toBeGreaterThanOrEqual(1);
    expect(await prisma.trade.count({ where: { sessionId: s10.id } })).toBe(3);

    const done = (await repair.run(true)) as SessionDaysRepairReport;
    expect(done.apply).toBe(true);
    expect(done.backupAt).toMatch(/^\d{8}-\d{4}$/);
    expect(done.skipped).toBe(0);

    const sessionOf = async (id: string) => (await prisma.trade.findUniqueOrThrow({ where: { id } })).sessionId;
    expect(await sessionOf(ok.id)).toBe(s10.id);
    expect(await sessionOf(old.id)).toBe(s05.id);
    expect(await sessionOf(orphan.id)).toBeNull();
    expect(await prisma.tradeSession.findUniqueOrThrow({ where: { id: s10.id } })).toMatchObject({ totalPnl: 100, totalTrades: 1 });
    expect(await prisma.tradeSession.findUniqueOrThrow({ where: { id: s05.id } })).toMatchObject({ totalPnl: -40, totalTrades: 1 });

    expect((await prisma.trade.findUniqueOrThrow({ where: { id: demoTrade.id } })).sessionId).toBe(demoSession.id);

    // Sauvegarde : rattachement d'avant et totaux d'avant de la séance faussée.
    const lines = (await repair.backup(done.backupAt!))!.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toContainEqual({ kind: 'trade', id: old.id, sessionId: s10.id, to: s05.id });
    expect(lines).toContainEqual({ kind: 'trade', id: orphan.id, sessionId: s10.id, to: null });
    expect(lines).toContainEqual(expect.objectContaining({ kind: 'session', id: s10.id, totalPnl: 85, totalTrades: 3 }));

    // 2e passage : plus rien pour ce trader.
    const again = (await repair.run(false)) as SessionDaysRepairReport;
    expect(again.misplaced).toBe(dry.misplaced - 2);
  }, 60_000);
});
