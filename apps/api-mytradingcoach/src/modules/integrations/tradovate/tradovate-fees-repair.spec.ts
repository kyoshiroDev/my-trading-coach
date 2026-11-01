import { describe, it, expect, vi } from 'vitest';
import { BrokerConnection, TradeSource } from '@prisma/client';
import { planFeeRepairs, type StoredTrade } from './tradovate-fees-repair';
import { TradovateFeesRepairService } from './tradovate-fees-repair.service';
import { TradovateAdminController } from './tradovate-admin.controller';
import type { RecomputedWindow } from './tradovate-history.service';
import type { ImportDto } from '../../trades/csv-parsers';

// Réparation des frais Tradovate importés avant le 31/10 (#783).

const at = '2026-10-27T18:36:52.000Z';
const trade = (over: Partial<StoredTrade> = {}) => ({
  asset: 'ES', side: 'LONG', tradedAt: at, entry: 7752.5, exit: 7752, pnl: -25, ...over,
});

describe('planFeeRepairs', () => {
  it('frais recalculés plus élevés → mise à jour, P&L brut non concerné', () => {
    const plan = planFeeRepairs([trade({ commission: 4.36 })], [{ id: 't1', ...trade({ commission: 1.18 }) }]);
    expect(plan.updates).toEqual([{ id: 't1', commission: 4.36 }]);
    expect(plan.feesAdded).toBe(3.18);
    expect(plan.matched).toBe(1);
  });

  it('contre-épreuve : frais déjà justes → aucune mise à jour', () => {
    const plan = planFeeRepairs([trade({ commission: 4.36 })], [{ id: 't1', ...trade({ commission: 4.36 }) }]);
    expect(plan.updates).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('frais en base plus élevés (saisie manuelle) : jamais baissés', () => {
    const plan = planFeeRepairs([trade({ commission: 4.36 })], [{ id: 't1', ...trade({ commission: 10 }) }]);
    expect(plan.updates).toEqual([]);
    expect(plan.skippedLower).toBe(1);
  });

  it('frais indisponibles sur la fenêtre : rien n’est posé (jamais 0 à la place)', () => {
    const plan = planFeeRepairs([trade()], [{ id: 't1', ...trade({ commission: 1.18 }) }]);
    expect(plan.updates).toEqual([]);
    expect(plan.noFees).toBe(1);
  });

  it('frais nuls en base (import CSV dont la jointure échouait) → posés', () => {
    const plan = planFeeRepairs([trade({ commission: 4.36 })], [{ id: 't1', ...trade({ commission: null }) }]);
    expect(plan.updates).toEqual([{ id: 't1', commission: 4.36 }]);
  });

  it('trade absent de la base, ou clé différente (P&L, date) → non retrouvé, rien d’écrit', () => {
    const plan = planFeeRepairs(
      [trade({ commission: 4.36 }), trade({ pnl: -12.5, commission: 4.36 })],
      [{ id: 't1', ...trade({ tradedAt: '2026-10-27T19:36:52.000Z', commission: 1.18 }) }],
    );
    expect(plan.updates).toEqual([]);
    expect(plan.notFound).toBe(2);
  });

  it('deux paires de même clé : rapprochées une pour une, jamais deux fois le même trade', () => {
    const plan = planFeeRepairs(
      [trade({ commission: 4.36 }), trade({ commission: 4.36 }), trade({ commission: 4.36 })],
      [{ id: 'a', ...trade({ commission: 1.18 }) }, { id: 'b', ...trade({ commission: 1.18 }) }],
    );
    expect(plan.updates.map((u) => u.id)).toEqual(['a', 'b']);
    expect(plan.notFound).toBe(1);
  });

  it('date en base (Date) et date recalculée (ISO) : même clé', () => {
    const plan = planFeeRepairs([trade({ commission: 4.36 })], [{ id: 't1', ...trade({ tradedAt: new Date(at), commission: 1.18 }) }]);
    expect(plan.updates).toHaveLength(1);
  });
});

function setup(windows: (RecomputedWindow | Error)[], stored: StoredTrade[]) {
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
    },
  };
  const prisma = {
    brokerConnection: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', userId: 'u1', accountId: 'a1' }]) },
    trade: {
      findMany: vi.fn().mockResolvedValue(stored),
      update: vi.fn((args: unknown) => args),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  const history = {
    recomputedWindows: vi.fn(async function* () {
      for (const w of windows) {
        if (w instanceof Error) throw w;
        yield w;
      }
    }),
  };
  const trades = { refreshAfterFeesRepair: vi.fn().mockResolvedValue(undefined) };
  const service = new TradovateFeesRepairService(prisma as never, redis as never, history as never, trades as never);
  return { service, prisma, history, trades, redis, store };
}

const window = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-31T00:00:00Z'), accountName: 'X' };
const conn = { id: 'c1', userId: 'u1', accountId: 'a1' } as BrokerConnection;

describe('TradovateFeesRepairService', () => {
  const windows = (): RecomputedWindow[] => [
    { window, dtos: [trade({ commission: 4.36 })] as ImportDto[], feesExpected: 4.36, fullFees: true },
    { window, error: 'rapport refusé' },
  ];

  it('mode essai : rapport complet, AUCUNE écriture', async () => {
    const { service, prisma, trades } = setup(windows(), [{ id: 't1', ...trade({ commission: 1.18 }) }]);
    const r = await service.repairConnection(conn, false);
    expect(r).toMatchObject({ windows: 2, failedWindows: 1, computed: 1, matched: 1, updated: 1, feesAdded: 3.18 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.trade.update).not.toHaveBeenCalled();
    expect(trades.refreshAfterFeesRepair).not.toHaveBeenCalled();
  });

  it('apply : seuls les frais sont écrits, puis barème et cache recalculés', async () => {
    const { service, prisma, trades } = setup(windows(), [{ id: 't1', ...trade({ commission: 1.18 }) }]);
    await service.repairConnection(conn, true);
    expect(prisma.trade.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { commission: 4.36 } });
    expect(trades.refreshAfterFeesRepair).toHaveBeenCalledWith('u1', 'a1');
  });

  it('ne lit que les trades de la connexion venus de l’historique ou d’un CSV (jamais la synchro en direct)', async () => {
    const { service, prisma } = setup(windows(), []);
    await service.repairConnection(conn, false);
    const where = prisma.trade.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'u1', accountId: 'a1' });
    expect(where.source.in).toEqual([TradeSource.BROKER_HISTORY, TradeSource.CSV_IMPORT]);
    expect(where.source.in).not.toContain(TradeSource.BROKER_SYNC);
  });

  it('jeton mort : connexion abandonnée avec son erreur, sans exception', async () => {
    const { service, prisma } = setup([new Error('jeton expiré')], []);
    const r = await service.repairConnection(conn, true);
    expect(r.error).toBe('jeton expiré');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('run : connexions actives et non démo seulement, rapport gardé dans Redis', async () => {
    const { service, prisma } = setup(windows(), [{ id: 't1', ...trade({ commission: 1.18 }) }]);
    const report = await service.run(false);
    expect(prisma.brokerConnection.findMany.mock.calls[0][0].where).toMatchObject({
      provider: 'TRADOVATE', status: 'CONNECTED', user: { isDemo: false },
    });
    expect(report).toMatchObject({ status: 'done', apply: false, connections: 1, updated: 1, feesAdded: 3.18 });
    expect(await service.lastReport()).toMatchObject({ status: 'done', updated: 1 });
  });

  it('une seule réparation à la fois (verrou)', async () => {
    const { service, store } = setup(windows(), []);
    store.set('tradovate:fees-repair:lock', '1');
    expect(await service.start(false)).toBe(false);
  });
});

describe('TradovateAdminController', () => {
  it('essai par défaut, écriture seulement avec apply=true', async () => {
    const repair = { start: vi.fn().mockResolvedValue(true), lastReport: vi.fn() };
    const ctrl = new TradovateAdminController(repair as never);
    expect(await ctrl.repairFees()).toEqual({ started: true, apply: false });
    expect(await ctrl.repairFees('1')).toEqual({ started: true, apply: false });
    expect(await ctrl.repairFees('true')).toEqual({ started: true, apply: true });
  });

  it('réparation déjà en cours → 409', async () => {
    const ctrl = new TradovateAdminController({ start: vi.fn().mockResolvedValue(false) } as never);
    await expect(ctrl.repairFees()).rejects.toMatchObject({ status: 409 });
  });

  it('routes réservées ADMIN (garde de classe)', () => {
    const guards = Reflect.getMetadata('__guards__', TradovateAdminController) as { name: string }[];
    expect(guards.map((g) => g.name)).toEqual(['JwtAuthGuard', 'AdminGuard']);
  });
});
