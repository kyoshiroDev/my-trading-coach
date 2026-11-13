import { describe, it, expect, vi } from 'vitest';
import { BrokerConnection } from '@prisma/client';
import { planPositionMerges, type StoredPairTrade } from './tradovate-positions-repair';
import { TradovatePositionsRepairService } from './tradovate-positions-repair.service';
import { TradovateAdminController } from './tradovate-admin.controller';
import type { RecomputedWindow } from './tradovate-history.service';
import type { ImportDto } from '../../trades/csv-parsers';

// Réparation des trades Tradovate importés avant #956 (un trade par paire) : une position = un trade.

// Short 2 MGC : deux ventes à 09:32, rachetées à 09:35 puis 09:40 (2 paires, ouverture = fill 10).
const pair = (buy: string, sell: string, openedAt: string, tradedAt: string, exit: number, pnl: number): ImportDto => ({
  asset: 'MGC', side: 'SHORT', entry: 4000, exit, quantity: 1, pnl, commission: 1.24, tradedAt,
  _buyFillId: buy, _sellFillId: sell, _contract: 'MGCZ6', _openedAt: openedAt,
});
const p1 = pair('20', '10', '2026-11-11T09:32:00.000Z', '2026-11-11T09:40:00.000Z', 3990, 100);
const p2 = pair('21', '11', '2026-11-11T09:32:05.000Z', '2026-11-11T09:35:00.000Z', 3995, 50);
// Position d'une seule paire : jamais touchée.
const solo = pair('31', '30', '2026-11-11T08:00:00.000Z', '2026-11-11T08:05:00.000Z', 3998, 20);

const row = (id: string, p: ImportDto, over: Partial<StoredPairTrade> = {}): StoredPairTrade => ({
  id, asset: p.asset as string, side: p.side as string, tradedAt: new Date(p.tradedAt as string), entry: p.entry as number,
  exit: p.exit ?? null, pnl: p.pnl ?? null, commission: 1.24, quantity: 1, importHash: 'x', emotion: null, setupId: 's1',
  stopLoss: null, takeProfit: null, notes: null, tags: [], capitalEngaged: null, timeframe: '1h', sessionId: null, ...over,
});

describe('planPositionMerges', () => {
  it('fusionne les lignes d’une position : ligne de la paire d’ouverture gardée, champs du broker recalculés', () => {
    const plan = planPositionMerges([solo, p2, p1], [row('t-solo', solo), row('t2', p2), row('t1', p1)], new Set());
    expect(plan).toMatchObject({ positions: 1, incomplete: 0, alreadyGrouped: 0, conflicting: 0 });
    expect(plan.merges).toEqual([{
      key: 'tv:10',
      keepId: 't1', // paire qui contient le fill d'ouverture 10
      removeIds: ['t2'],
      data: {
        entry: 4000, exit: 3992.5, quantity: 2, pnl: 150, commission: 2.48,
        tradedAt: new Date('2026-11-11T09:40:00.000Z'), session: 'LONDON', importHash: 'tv:10',
      },
    }]);
  });

  it('P&L en base à l’ancien arrondi (1 centime) : retrouvé quand même', () => {
    const plan = planPositionMerges([p1, p2], [row('t1', p1, { pnl: 99.99 }), row('t2', p2)], new Set());
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].data.pnl).toBe(149.99); // total EN BASE, inchangé
  });

  it('une paire absente de la base (CSV dans un autre fuseau, ligne supprimée) : position laissée', () => {
    const plan = planPositionMerges([p1, p2], [row('t1', p1)], new Set());
    expect(plan).toMatchObject({ merges: [], incomplete: 1 });
  });

  it.each([
    ['émotion', { emotion: 'FEAR' }],
    ['setup', { setupId: 's2' }],
    ['stop', { stopLoss: 4010 }],
    ['notes', { notes: 'sortie trop tôt' }],
    ['séance', { sessionId: 'sess-2' }],
  ])('saisies différentes (%s) : comptée, jamais fusionnée', (_l, over) => {
    const plan = planPositionMerges([p1, p2], [row('t1', p1), row('t2', p2, over as Partial<StoredPairTrade>)], new Set());
    expect(plan).toMatchObject({ merges: [], conflicting: 1 });
  });

  it('mêmes saisies sur toutes les lignes (stop identique) : fusionnée', () => {
    const plan = planPositionMerges([p1, p2], [row('t1', p1, { stopLoss: 4010 }), row('t2', p2, { stopLoss: 4010 })], new Set());
    expect(plan.merges).toHaveLength(1);
  });

  it('position déjà regroupée (clé tv: en base) : rien à faire', () => {
    const plan = planPositionMerges([p1, p2], [row('t1', p1), row('t2', p2)], new Set(['tv:10']));
    expect(plan).toMatchObject({ merges: [], alreadyGrouped: 1 });
  });
});

describe('TradovatePositionsRepairService', () => {
  const window = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-30T00:00:00Z'), accountName: 'X' };
  const conn = { id: 'c1', userId: 'u1', accountId: 'a1' } as BrokerConnection;
  const windows = (): RecomputedWindow[] => [
    { window, dtos: [p1, p2], feesExpected: 2.48, fullFees: true },
    { window, error: 'rapport refusé' },
  ];

  function setup(stored: StoredPairTrade[], merged = true) {
    const store = new Map<string, string>();
    const redis = {
      client: {
        set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
          if (args.includes('NX') && store.has(k)) return null;
          store.set(k, v);
          return 'OK';
        }),
        get: vi.fn(async (k: string) => store.get(k) ?? null),
        del: vi.fn(async (k: string) => void store.delete(k)),
        append: vi.fn(async (k: string, v: string) => void store.set(k, (store.get(k) ?? '') + v)),
        expire: vi.fn(async () => 1),
      },
    };
    const findMany = vi.fn(async (args: { where: { importHash?: unknown; id?: unknown } }) => {
      if (args.where.importHash) return [];
      if (args.where.id) return stored.filter((t) => (args.where.id as { in: string[] }).in.includes(t.id));
      return stored;
    });
    const prisma = {
      brokerConnection: { findMany: vi.fn().mockResolvedValue([conn]) },
      trade: { findMany },
    };
    const history = {
      recomputedWindows: vi.fn(async function* () {
        for (const w of windows()) yield w;
      }),
    };
    const trades = {
      mergeImportedPosition: vi.fn().mockResolvedValue(merged),
      refreshAfterFeesRepair: vi.fn().mockResolvedValue(undefined),
    };
    const service = new TradovatePositionsRepairService(prisma as never, redis as never, history as never, trades as never);
    return { service, prisma, trades, store };
  }

  it('mode essai : rapport complet, AUCUNE écriture ni sauvegarde', async () => {
    const { service, trades, store } = setup([row('t1', p1), row('t2', p2)]);
    const r = await service.repairConnection(conn, false);
    expect(r).toMatchObject({ windows: 2, failedWindows: 1, positions: 1, merged: 1, rowsRemoved: 1 });
    expect(trades.mergeImportedPosition).not.toHaveBeenCalled();
    expect(trades.refreshAfterFeesRepair).not.toHaveBeenCalled();
    expect(store.has('tradovate:positions-repair:backup')).toBe(false);
  });

  it('apply : lignes sauvegardées AVANT la fusion, puis barème, séances et cache recalculés', async () => {
    const { service, trades, store } = setup([row('t1', p1), row('t2', p2)]);
    const report = await service.run(true);
    expect(report).toMatchObject({ status: 'done', apply: true, merged: 1, rowsRemoved: 1 });
    expect(trades.mergeImportedPosition).toHaveBeenCalledWith('u1', expect.objectContaining({ keepId: 't1', removeIds: ['t2'] }));
    expect(trades.refreshAfterFeesRepair).toHaveBeenCalledWith('u1', 'a1');
    const backup = (await service.lastBackup())!.trim().split('\n').map((l) => JSON.parse(l) as { id: string });
    expect(backup.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect(store.get('tradovate:positions-repair:report')).toContain('"merged":1');
  });

  it('fusion refusée à l’écriture (ligne disparue) : comptée, pas de recalcul inutile', async () => {
    const { service, trades } = setup([row('t1', p1), row('t2', p2)], false);
    const r = await service.repairConnection(conn, true);
    expect(r).toMatchObject({ merged: 0, failed: 1 });
    expect(trades.refreshAfterFeesRepair).not.toHaveBeenCalled();
  });

  it('run : connexions actives, non démo, compte non archivé ; lignes importées seulement', async () => {
    const { service, prisma } = setup([]);
    await service.run(false);
    expect(prisma.brokerConnection.findMany.mock.calls[0][0].where).toMatchObject({
      provider: 'TRADOVATE', status: 'CONNECTED', user: { isDemo: false }, account: { status: { not: 'ARCHIVED' } },
    });
    const where = prisma.trade.findMany.mock.calls[0][0].where as { source: { in: string[] } };
    expect(where.source.in.sort()).toEqual(['BROKER_HISTORY', 'BROKER_SYNC', 'CSV_IMPORT']);
  });

  it('une seule réparation à la fois (verrou)', async () => {
    const { service, store } = setup([]);
    store.set('tradovate:positions-repair:lock', '1');
    expect(await service.start(false)).toBe(false);
  });
});

describe('TradovateAdminController — réparation des positions (#956)', () => {
  it('essai par défaut, écriture seulement avec apply=true ; 409 si déjà en cours', async () => {
    const positions = { start: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false) };
    const ctrl = new TradovateAdminController({} as never, positions as never);
    expect(await ctrl.repairPositions()).toEqual({ started: true, apply: false });
    expect(await ctrl.repairPositions('true')).toEqual({ started: true, apply: true });
    await expect(ctrl.repairPositions('true')).rejects.toMatchObject({ status: 409 });
  });
});
