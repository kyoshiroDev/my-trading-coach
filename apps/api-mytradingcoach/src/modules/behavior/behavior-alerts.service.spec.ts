import { afterEach, describe, it, expect, vi } from 'vitest';
import { BehaviorAlertsService, type BehaviorAlertEvent, seenKey } from './behavior-alerts.service';
import type { BehaviorBaselineData } from './behavior-baseline';
import { newEntries, snapshot } from './behavior-entries';

// 15:00 UTC = 10:00 CT : journée CME du 2026-09-01.
const NOW = new Date(Date.UTC(2026, 8, 1, 15, 0, 30));
const at = (sec: number) => new Date(Date.UTC(2026, 8, 1, 15, 0, 0) + sec * 1000);

const baseline: BehaviorBaselineData = {
  sessionsUsed: 20, throughDay: '2026-08-31', medianGapMs: 45_000, gapSamples: 300,
  medianGapAfterLossMs: 60_000, gapAfterLossSamples: 100,
  sizeByAsset: { MNQ: { median: 1, p75: 1, p90: 2, samples: 300 } }, positionsPerSession: { median: 20, p90: 30 },
};

function setup(opts: { demo?: boolean; seen?: Record<string, number> | null; positions?: { asset: string; side: 'LONG' | 'SHORT'; quantity: number }[] } = {}) {
  const store = new Map<string, string>();
  store.set('tradovate:positions:conn', JSON.stringify({
    at: NOW.toISOString(),
    positions: (opts.positions ?? [{ asset: 'MNQ', side: 'SHORT', quantity: 4 }]).map((p) => ({ ...p, entryPrice: 1, since: at(20).toISOString() })),
  }));
  if (opts.seen !== null) store.set(seenKey('a'), JSON.stringify(opts.seen ?? {}));
  const redis = {
    client: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
        if (args.includes('NX') && store.has(k)) return null;
        store.set(k, v);
        return 'OK';
      }),
    },
  };
  const created: Record<string, unknown>[] = [];
  // Une perte à 15:00:10, puis la ré-entrée à 15:00:20 en 4 contrats, sens inversé.
  const prisma = {
    brokerConnection: { findUnique: vi.fn(async () => ({ id: 'conn', user: { isDemo: !!opts.demo, tradesPerDayMax: null } })) },
    trade: {
      findMany: vi.fn(async () => [
        { id: 't1', accountId: 'a', asset: 'MNQ', side: 'LONG', entry: 100, quantity: 1, pnl: -40, commission: 0, tradedAt: at(10) },
      ]),
    },
    tradeSession: { findFirst: vi.fn(async () => null) },
    propFirmPlan: { findUnique: vi.fn() },
    behaviorAlert: { create: vi.fn(async (args: { data: Record<string, unknown> }) => (created.push(args.data), { id: `al${created.length}` })) },
  };
  const accounts = { list: vi.fn(async () => [{ id: 'a', propFirmPlanId: null, type: 'FUNDED', metrics: { dailyLoss: null, currentBalance: 0, startingBalance: 0 } }]) };
  const baselines = { get: vi.fn(async () => baseline) };
  const notifier = { notify: vi.fn() };
  const svc = new BehaviorAlertsService(prisma as never, redis as never, accounts as never, baselines as never, notifier as never);
  const events: BehaviorAlertEvent[] = [];
  const emit = (_e: 'behavior:alert', p: BehaviorAlertEvent) => events.push(p);
  return { svc, emit, events, created, store, prisma, notifier };
}

afterEach(() => {
  delete process.env['BEHAVIOR_ALERTS_UI'];
});

describe('BehaviorAlertsService.check', () => {
  it('nouvelle entrée après une perte : alertes ENREGISTRÉES, rien envoyé à l’app (UI désactivée)', async () => {
    const { svc, emit, events, created, notifier } = setup();
    expect(await svc.check('u', 'a', emit, NOW)).toBeGreaterThan(0);
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(created.map((c) => c['type'])).toEqual(expect.arrayContaining(['B_REVENGE', 'C3_MARTINGALE']));
    expect(created[0]).toMatchObject({ userId: 'u', accountId: 'a', tradeDay: new Date('2026-09-01T00:00:00.000Z'), sessionId: null });
    expect(events).toEqual([]);
  });

  it('BEHAVIOR_ALERTS_UI=true : l’alerte part aussi vers l’app', async () => {
    process.env['BEHAVIOR_ALERTS_UI'] = 'true';
    const { svc, emit, events, created, notifier } = setup();
    await svc.check('u', 'a', emit, NOW);
    expect(events).toHaveLength(created.length);
    // Push (#666) : un par alerte affichée, type Comportement, anti-spam par type d'alerte.
    expect(notifier.notify).toHaveBeenCalledTimes(created.length);
    expect(notifier.notify).toHaveBeenCalledWith(
      'u', 'BEHAVIOR', expect.objectContaining({ title: 'Signal de comportement', url: '/session' }),
      { accountId: 'a', dedupKey: `behavior:${created[0]['type'] as string}` },
    );
  });

  it('anti-spam 15 min partagé : une 2e entrée du même type n’enregistre rien', async () => {
    const { svc, emit, created, store } = setup();
    await svc.check('u', 'a', emit, NOW);
    const first = created.length;
    store.set(seenKey('a'), JSON.stringify({}));
    await svc.check('u', 'a', emit, NOW);
    expect(created).toHaveLength(first);
  });

  it('premier relevé (rien de vu avant) : mémorise sans alerter', async () => {
    const { svc, emit, created, store } = setup({ seen: null });
    expect(await svc.check('u', 'a', emit, NOW)).toBe(0);
    expect(created).toEqual([]);
    expect(JSON.parse(store.get(seenKey('a'))!)).toEqual({ MNQ: -4 });
  });

  it('position déjà vue, inchangée : aucune entrée, aucune lecture des trades', async () => {
    const { svc, emit, prisma } = setup({ seen: { MNQ: -4 } });
    expect(await svc.check('u', 'a', emit, NOW)).toBe(0);
    expect(prisma.trade.findMany).not.toHaveBeenCalled();
  });

  it('compte démo : rien', async () => {
    const { svc, emit, created } = setup({ demo: true });
    expect(await svc.check('u', 'a', emit, NOW)).toBe(0);
    expect(created).toEqual([]);
  });
});

describe('newEntries', () => {
  const p = (asset: string, side: 'LONG' | 'SHORT', quantity: number) => ({ asset, side, quantity, since: null });
  it('nouvelle position, retournement, renfort : oui ; réduction ou inchangée : non', () => {
    expect(newEntries([p('MNQ', 'LONG', 2)], {})).toHaveLength(1);
    expect(newEntries([p('MNQ', 'SHORT', 2)], { MNQ: 2 })).toHaveLength(1);
    expect(newEntries([p('MNQ', 'LONG', 3)], { MNQ: 2 })).toHaveLength(1);
    expect(newEntries([p('MNQ', 'LONG', 1)], { MNQ: 2 })).toHaveLength(0);
    expect(newEntries([p('MNQ', 'LONG', 2)], { MNQ: 2 })).toHaveLength(0);
    expect(snapshot([p('MNQ', 'SHORT', 3), p('MES', 'LONG', 1)])).toEqual({ MNQ: -3, MES: 1 });
  });
});
