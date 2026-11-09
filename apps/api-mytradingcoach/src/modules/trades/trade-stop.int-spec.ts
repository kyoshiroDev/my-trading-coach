/**
 * Stop initial saisi sur un trade synchronisé (base réelle) : le broker ne transmet jamais le stop,
 * le trader l'ajoute depuis le Journal. Vérifie la note d'exécution réellement écrite (barème « avec
 * stop » à la place du comportemental) et qu'une resynchronisation n'écrase pas la saisie.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { TradeSource } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { TradesService } from './trades.service';
import type { CreateTradeDto } from './dto/create-trade.dto';
import { freezeClock } from '../../test/freeze-clock';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

let app: INestApplication;
let prisma: PrismaService;
let trades: TradesService;
let userId: string;
let accountId: string;
let setupId: string;

/** Trade tel que la synchro Tradovate le remonte : prix, P&L, quantité, aucun stop. */
const syncedDto = (): CreateTradeDto => ({
  asset: 'MNQ',
  side: 'LONG',
  entry: 27092.25,
  exit: 27796,
  pnl: 1407.5,
  quantity: 1,
  commission: 1.9,
  setupId,
  session: 'NEW_YORK',
  timeframe: '5m',
  tradedAt: '2026-11-09T15:11:08.000Z',
  accountId,
});

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  trades = app.get(TradesService);
  userId = (await prisma.user.create({ data: { email: `int-rr-stop-${RUN}@test.local`, password: 'x', createdAt: new Date('2026-09-01T00:00:00Z') } })).id;
  accountId = (await prisma.tradingAccount.create({ data: { userId, label: 'Lucid', accountSize: 50_000 } })).id;
  setupId = (await prisma.setup.create({ data: { userId, title: 'S', color: '#000' } })).id;
  // 25 trades clôturés sans stop : historique suffisant pour la note comportementale (≥ 20).
  const t0 = Date.UTC(2026, 9, 1, 14);
  await prisma.trade.createMany({
    data: Array.from({ length: 25 }, (_, i) => ({
      userId, accountId, setupId, asset: 'MNQ', side: 'LONG' as const, entry: 27000, exit: 27010,
      pnl: i % 3 === 0 ? 120 : -(60 + (i % 4) * 30), quantity: 1, session: 'NEW_YORK' as const,
      timeframe: '5m', tradedAt: new Date(t0 + i * 3_600_000), source: TradeSource.BROKER_SYNC,
    })),
  });
}, 120_000);

afterAll(async () => {
  if (prisma && userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await app?.close().catch(() => undefined);
});

describe('Stop initial d’un trade synchronisé (base réelle)', () => {
  // Trades datés en dur (9/11 au soir, heure de Paris) : horloge figée juste après.
  freezeClock('2026-11-09T21:00:00Z');
  let tradeId: string;

  it('la synchro crée le trade sans stop : R/R inconnu (null), note comportementale', async () => {
    const res = await trades.importTrades(userId, [syncedDto()], TradeSource.BROKER_SYNC);
    expect(res).toMatchObject({ created: 1, duplicates: 0 });
    const t = await prisma.trade.findFirstOrThrow({ where: { userId, tradedAt: new Date('2026-11-09T15:11:08.000Z') } });
    tradeId = t.id;
    expect(t).toMatchObject({ source: 'BROKER_SYNC', stopLoss: null, takeProfit: null, riskReward: null });
    expect(t.executionMethod === null || t.executionMethod === 'BEHAVIORAL').toBe(true);
  });

  it('stop + objectif saisis : R/R et note « avec stop » écrits en base', async () => {
    const out = await trades.setStop(userId, tradeId, { stopLoss: 26862.5, takeProfit: 28138.25 });
    expect(out).toMatchObject({ stopLoss: 26862.5, takeProfit: 28138.25, riskReward: 4.55, executionMethod: 'STOP_BASED' });
    const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
    expect(t).toMatchObject({ stopLoss: 26862.5, takeProfit: 28138.25, riskReward: 4.55, executionMethod: 'STOP_BASED' });
    expect(t.executionGrade).not.toBeNull();
    // Le recalcul comportemental du compte ne repasse JAMAIS sur un trade qui a un stop.
    expect(t.executionScore).not.toBeNull();
  });

  it('la resynchronisation du même trade n’écrase pas la saisie (doublon ignoré)', async () => {
    const res = await trades.importTrades(userId, [syncedDto()], TradeSource.BROKER_SYNC);
    expect(res).toMatchObject({ created: 0, duplicates: 1 });
    const all = await prisma.trade.findMany({ where: { userId, tradedAt: new Date('2026-11-09T15:11:08.000Z') } });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: tradeId, stopLoss: 26862.5, takeProfit: 28138.25, riskReward: 4.55, executionMethod: 'STOP_BASED' });
  });

  it('le rattrapage d’historique (même trade, autre source) n’écrase pas non plus', async () => {
    const res = await trades.importTrades(userId, [syncedDto()], TradeSource.BROKER_HISTORY);
    expect(res).toMatchObject({ created: 0, duplicates: 1 });
    const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
    expect(t).toMatchObject({ stopLoss: 26862.5, riskReward: 4.55 });
  });

  it('stop du mauvais côté : 400, la base garde la saisie précédente', async () => {
    await expect(trades.setStop(userId, tradeId, { stopLoss: 27200 })).rejects.toThrow(/sous le prix d'entrée/);
    const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
    expect(t.stopLoss).toBe(26862.5);
  });
});
