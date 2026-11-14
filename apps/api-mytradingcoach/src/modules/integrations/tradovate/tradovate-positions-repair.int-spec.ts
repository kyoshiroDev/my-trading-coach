/**
 * #956 PR 2 : réparation des trades Tradovate importés avant le regroupement par position.
 * Vraie base : lignes à l'ancien format (un trade par paire, empreinte par paire), plan de fusion,
 * fusion en transaction, puis ré-import du même export : la position réparée n'est pas recréée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { TradeSource } from '@prisma/client';
import { createIntegrationApp } from '../../../test/integration-app.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { TradesService } from '../../trades/trades.service';
import { SetupsService } from '../../setups/setups.service';
import { mapNormalizedCsvToDto, preprocessCsv } from '../../trades/csv-parsers';
import { withoutImportMeta } from '../../trades/trade-identity.util';
import { planPositionMerges } from './tradovate-positions-repair';

const PREFIX = 'int-tv-positions-repair-';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const PERF_CSV = readFileSync(join(__dirname, '..', '..', 'trades', '__fixtures__', 'tradovate-performance.csv'));

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

async function registerUser(): Promise<{ id: string; token: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${PREFIX}${uid()}@test.local`, password: 'int-test-no-login-1234', name: 'Int Positions' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const body = (await res.json()) as { data: { access_token: string; user: { id: string } } };
  return { id: body.data.user.id, token: body.data.access_token };
}

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('Réparation des positions Tradovate (#956)', () => {
  it('lignes à l’ancien format fusionnées en UN trade, alerte rattachée, ré-import sans doublon', async () => {
    const { id: userId, token } = await registerUser();
    const trades = app.get(TradesService);
    const setupId = await app.get(SetupsService).getImportSetupId(userId);
    const account = await prisma.tradingAccount.create({ data: { userId, label: 'Apex' } });

    // Export Performance par paire (ce que l'import produisait avant #956) : 20 lignes.
    const { csv } = preprocessCsv(PERF_CSV.toString('utf-8'));
    const pairs = mapNormalizedCsvToDto(csv).map((d) => ({ ...d, accountId: account.id, setupId: setupId ?? undefined, emotion: null }));
    // Ancien chemin d'import (sans `_positionKey`) : un trade par paire.
    const legacy = await trades.importTrades(userId, pairs.map((p) => withoutImportMeta(p)), TradeSource.CSV_IMPORT);
    expect(legacy.created).toBe(20);

    const stored = await prisma.trade.findMany({
      where: { userId },
      select: {
        id: true, asset: true, side: true, tradedAt: true, entry: true, exit: true, pnl: true, commission: true,
        quantity: true, importHash: true, emotion: true, setupId: true, stopLoss: true, takeProfit: true, notes: true,
        tags: true, capitalEngaged: true, timeframe: true, sessionId: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const plan = planPositionMerges(pairs, stored, new Set());
    // 7 positions dont 4 à plusieurs paires (2, 3, 7 et 5 paires, cf. csv-import.service.spec) : 20 lignes → 7.
    expect(plan).toMatchObject({ positions: 4, incomplete: 0, conflicting: 0 });
    expect(plan.merges.reduce((n, m) => n + m.removeIds.length, 0)).toBe(13);

    // Une alerte de comportement posée sur une ligne qui va disparaître : rattachée au trade gardé.
    const first = plan.merges.find((m) => m.key === 'tv:566569084424')!;
    const alert = await prisma.behaviorAlert.create({
      data: { userId, accountId: account.id, tradeDay: new Date('2026-07-10'), tradeId: first.removeIds[0], type: 'TEST', severity: 'low', message: 'test' },
    });

    for (const m of plan.merges) expect(await trades.mergeImportedPosition(userId, m)).toBe(true);
    await trades.refreshAfterFeesRepair(userId, account.id);

    expect(await prisma.trade.count({ where: { userId } })).toBe(7);
    const merged = await prisma.trade.findUniqueOrThrow({ where: { id: first.keepId } });
    expect(merged).toMatchObject({ importHash: 'tv:566569084424', side: 'SHORT', quantity: 2, entry: 29915.375, exit: 29901.75, pnl: 54.5 });
    expect((await prisma.behaviorAlert.findUniqueOrThrow({ where: { id: alert.id } })).tradeId).toBe(first.keepId);
    const total = await prisma.trade.aggregate({ where: { userId }, _sum: { pnl: true } });
    expect(total._sum.pnl).toBeCloseTo(466.5, 2);

    // Deuxième passage : tout est déjà regroupé.
    const again = planPositionMerges(pairs, await prisma.trade.findMany({ where: { userId } }) as never, new Set(
      (await prisma.trade.findMany({ where: { userId, importHash: { startsWith: 'tv:' } }, select: { importHash: true } })).map((t) => t.importHash as string),
    ));
    expect(again).toMatchObject({ merges: [], alreadyGrouped: 4 });

    // Ré-import du même export par l'utilisateur : rien de recréé.
    const form = new FormData();
    form.append('file', new Blob([PERF_CSV], { type: 'text/csv' }), 'Performance.csv');
    form.append('accountId', account.id);
    const res = await fetch(`${baseUrl}/api/trades/import`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    expect(res.ok, await res.clone().text()).toBe(true);
    expect(((await res.json()) as { data: { created: number } }).data.created).toBe(0);
    expect(await prisma.trade.count({ where: { userId } })).toBe(7);
  }, 90_000);
});
