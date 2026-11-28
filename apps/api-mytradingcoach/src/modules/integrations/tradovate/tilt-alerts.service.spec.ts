import { describe, it, expect, vi } from 'vitest';
import { TiltAlertsService, type TiltAlertEvent } from './tilt-alerts.service';
import { freezeClock } from '../../../test/freeze-clock';

const NOW = new Date(Date.UTC(2026, 5, 2, 16));
const at = (min: number) => new Date(NOW.getTime() - 60 * 60_000 + min * 60_000);

function setup(opts: { premium?: boolean; demo?: boolean; mood?: string | null; tradesPerDayMax?: number | null } = {}) {
  const keys = new Set<string>();
  const redis = {
    client: {
      set: vi.fn(async (k: string) => (keys.has(k) ? null : (keys.add(k), 'OK'))),
    },
  };
  let trades = [
    { id: '2', pnl: 30, quantity: 1, tradedAt: at(1) },
    { id: '1', pnl: -100, quantity: 1, tradedAt: at(0) },
  ];
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ plan: opts.premium === false ? 'FREE' : 'PREMIUM', role: 'USER', trialEndsAt: null, isDemo: !!opts.demo, tradesPerDayMax: opts.tradesPerDayMax ?? null })) },
    tradingAccount: { findFirst: vi.fn(async () => ({ label: 'Apex 50k' })) },
    trade: { findMany: vi.fn(async () => trades) },
    tradeSession: { findFirst: vi.fn(async () => (opts.mood === undefined ? { moodStart: 'TIRED' } : opts.mood ? { moodStart: opts.mood } : null)) },
  };
  const notifier = { notify: vi.fn() };
  const svc = new TiltAlertsService(prisma as never, redis as never, undefined, notifier as never);
  const events: TiltAlertEvent[] = [];
  const emit = (_e: 'tilt:alert', p: TiltAlertEvent) => events.push(p);
  return { svc, emit, events, prisma, notifier, setTrades: (x: typeof trades) => { trades = x; } };
}

describe('TiltAlertsService.check', () => {
  it('revenge détecté : nudge avec le compte et l’humeur de la pré-session', async () => {
    const { svc, emit, events } = setup();
    await svc.check('u', 'a', emit, NOW);
    expect(events).toEqual([expect.objectContaining({ signal: 'revenge', ref: '2', accountId: 'a', accountLabel: 'Apex 50k', moodStart: 'TIRED' })]);
  });

  it('push (#666) : type Comportement, anti-spam par signal et par compte', async () => {
    const { svc, emit, notifier } = setup();
    await svc.check('u', 'a', emit, NOW);
    expect(notifier.notify).toHaveBeenCalledWith(
      'u', 'BEHAVIOR', expect.objectContaining({ title: '{compte}', url: '/session' }), { accountId: 'a', dedupKey: 'tilt:revenge' },
    );
  });

  it('une seule fois par trade, même réévalué', async () => {
    const { svc, emit, events } = setup();
    await svc.check('u', 'a', emit, NOW);
    await svc.check('u', 'a', emit, NOW);
    expect(events).toHaveLength(1);
  });

  it('sans session ouverte : humeur inconnue', async () => {
    const { svc, emit, events } = setup({ mood: null });
    await svc.check('u', 'a', emit, NOW);
    expect(events[0].moodStart).toBeNull();
  });

  it('hors Premium ou compte démo : rien, et aucune lecture des trades', async () => {
    for (const opts of [{ premium: false }, { demo: true }]) {
      const { svc, emit, events, prisma } = setup(opts);
      await svc.check('u', 'a', emit, NOW);
      expect(events).toHaveLength(0);
      expect(prisma.trade.findMany).not.toHaveBeenCalled();
    }
  });

  it('trades d’hier : jamais un nudge pour la séance passée', async () => {
    const { svc, emit, events, setTrades } = setup();
    const yesterday = (min: number) => new Date(NOW.getTime() - 24 * 3600_000 + min * 60_000);
    setTrades([
      { id: '2', pnl: 30, quantity: 1, tradedAt: yesterday(1) },
      { id: '1', pnl: -100, quantity: 1, tradedAt: yesterday(0) },
    ]);
    await svc.check('u', 'a', emit, NOW);
    expect(events).toHaveLength(0);
  });
});

// #671 : moteur de comportement affiché = l'anti-tilt se tait ; jamais deux alertes pour la même chose.
describe('TiltAlertsService : relais au moteur de comportement (#671)', () => {
  freezeClock(NOW);

  const withJournal = () => {
    const base = setup();
    const journal = { recordEvent: vi.fn(async () => undefined) };
    const svc = new TiltAlertsService(base.prisma as never, { client: { set: vi.fn(async () => 'OK') } } as never, journal as never, base.notifier as never);
    return { ...base, svc, journal };
  };

  it('BEHAVIOR_ALERTS_UI=true : ni toast ni push, le journal reste écrit', async () => {
    process.env['BEHAVIOR_ALERTS_UI'] = 'true';
    try {
      const { svc, emit, events, notifier, journal } = withJournal();
      await svc.check('u', 'a', emit, NOW);
      expect(events).toEqual([]);
      expect(notifier.notify).not.toHaveBeenCalled();
      expect(journal.recordEvent).toHaveBeenCalledWith('u', 'a', expect.any(String), 'tilt', 'revenge', expect.anything());
    } finally {
      delete process.env['BEHAVIOR_ALERTS_UI'];
    }
  });

  it('flag éteint : inchangé (toast, push et journal)', async () => {
    const { svc, emit, events, notifier, journal } = withJournal();
    await svc.check('u', 'a', emit, NOW);
    expect(events).toHaveLength(1);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(journal.recordEvent).toHaveBeenCalledTimes(1);
  });

  it('flag allumé, surtrading sans limite déclarée : l’anti-tilt garde ce signal (promis par anti_tilt)', async () => {
    process.env['BEHAVIOR_ALERTS_UI'] = 'true';
    try {
      const day = (d: number, h: number) => new Date(Date.UTC(2026, 5, d, h));
      const past = Array.from({ length: 12 }, (_, i) => [0, 1, 2].map((k) => ({ id: `p${i}${k}`, pnl: 10, quantity: 1, tradedAt: day(i + 15, 14 + k) })).flat()).flat()
        .map((t) => ({ ...t, tradedAt: new Date(t.tradedAt.getTime() - 30 * 86_400_000) }));
      const today = Array.from({ length: 8 }, (_, k) => ({ id: `t${k}`, pnl: 5, quantity: 1, tradedAt: new Date(NOW.getTime() - (8 - k) * 60_000) }));
      for (const [limit, expected] of [[null, 1], [0, 1], [5, 0]] as const) {
        const base = setup({ tradesPerDayMax: limit });
        base.setTrades([...today].reverse().concat([...past].reverse()));
        const svc = new TiltAlertsService(base.prisma as never, { client: { set: vi.fn(async () => 'OK') } } as never, undefined, base.notifier as never);
        await svc.check('u', 'a', base.emit, NOW);
        expect(base.events.filter((e) => e.signal === 'overtrading')).toHaveLength(expected);
      }
    } finally {
      delete process.env['BEHAVIOR_ALERTS_UI'];
    }
  });
});
