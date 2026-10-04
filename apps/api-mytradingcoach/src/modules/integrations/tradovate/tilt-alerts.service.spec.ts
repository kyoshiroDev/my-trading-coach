import { describe, it, expect, vi } from 'vitest';
import { TiltAlertsService, type TiltAlertEvent } from './tilt-alerts.service';

const NOW = new Date(Date.UTC(2026, 5, 2, 16));
const at = (min: number) => new Date(NOW.getTime() - 60 * 60_000 + min * 60_000);

function setup(opts: { premium?: boolean; demo?: boolean; mood?: string | null } = {}) {
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
    user: { findUnique: vi.fn(async () => ({ plan: opts.premium === false ? 'FREE' : 'PREMIUM', role: 'USER', trialEndsAt: null, isDemo: !!opts.demo })) },
    tradingAccount: { findFirst: vi.fn(async () => ({ label: 'Apex 50k' })) },
    trade: { findMany: vi.fn(async () => trades) },
    tradeSession: { findFirst: vi.fn(async () => (opts.mood === undefined ? { moodStart: 'TIRED' } : opts.mood ? { moodStart: opts.mood } : null)) },
  };
  const svc = new TiltAlertsService(prisma as never, redis as never);
  const events: TiltAlertEvent[] = [];
  const emit = (_e: 'tilt:alert', p: TiltAlertEvent) => events.push(p);
  return { svc, emit, events, prisma, setTrades: (x: typeof trades) => { trades = x; } };
}

describe('TiltAlertsService.check', () => {
  it('revenge détecté : nudge avec le compte et l’humeur de la pré-session', async () => {
    const { svc, emit, events } = setup();
    await svc.check('u', 'a', emit, NOW);
    expect(events).toEqual([expect.objectContaining({ signal: 'revenge', ref: '2', accountId: 'a', accountLabel: 'Apex 50k', moodStart: 'TIRED' })]);
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
