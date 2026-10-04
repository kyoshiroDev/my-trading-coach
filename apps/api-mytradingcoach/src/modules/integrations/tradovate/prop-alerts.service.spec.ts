import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ALERT_DEBOUNCE_MS, PropAlertsService, alertLevel, type PropAlertEvent } from './prop-alerts.service';

type Metrics = {
  drawdown: { pct: number; breached: boolean; margin: number; maxDrawdown: number } | null;
  dailyLoss: { pct: number; breached: boolean; remaining: number; limit: number; breach: PropAlertEvent['breach'] } | null;
};

function setup(opts: { premium?: boolean; demo?: boolean; status?: string } = {}) {
  const store = new Map<string, string>();
  const redis = {
    client: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
      del: vi.fn(async (k: string) => { store.delete(k); return 1; }),
    },
  };
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        plan: opts.premium === false ? 'FREE' : 'PREMIUM', role: 'USER', trialEndsAt: null, isDemo: !!opts.demo,
      })),
    },
  };
  let metrics: Metrics = { drawdown: null, dailyLoss: null };
  const accounts = {
    list: vi.fn(async () => [{ id: 'a', label: 'Apex 50k', currency: 'USD', status: opts.status ?? 'ACTIVE', metrics }]),
  };
  const svc = new PropAlertsService(prisma as never, redis as never, accounts as never);
  const events: PropAlertEvent[] = [];
  const emit = (_e: 'prop:alert', p: PropAlertEvent) => events.push(p);
  const set = (m: Partial<Metrics>) => { metrics = { ...metrics, ...m }; };
  const dd = (pct: number, breached = false) => ({ pct, breached, margin: pct * 2000, maxDrawdown: 2000 });
  return { svc, emit, events, set, dd, accounts, store };
}

const NOW = new Date(Date.UTC(2026, 5, 2, 16));

describe('alertLevel', () => {
  it('25 % → avertissement, 10 % → critique, dépassé → dépassé', () => {
    expect(alertLevel(0.6, false)).toBeNull();
    expect(alertLevel(0.25, false)).toBe('warning');
    expect(alertLevel(0.1, false)).toBe('critical');
    expect(alertLevel(0.4, true)).toBe('breached');
  });
});

describe('PropAlertsService.check', () => {
  it('une alerte par niveau franchi et par jour, jamais deux fois le même', async () => {
    const { svc, emit, events, set, dd } = setup();
    set({ drawdown: dd(0.6) });
    await svc.check('u', 'a', emit, NOW);
    expect(events).toHaveLength(0);

    set({ drawdown: dd(0.2) });
    await svc.check('u', 'a', emit, NOW);
    await svc.check('u', 'a', emit, NOW);
    expect(events.map((e) => e.level)).toEqual(['warning']);

    set({ drawdown: dd(0.05) });
    await svc.check('u', 'a', emit, NOW);
    set({ drawdown: dd(0, true) });
    await svc.check('u', 'a', emit, NOW);
    expect(events.map((e) => e.level)).toEqual(['warning', 'critical', 'breached']);
    expect(events[0]).toMatchObject({ accountId: 'a', accountLabel: 'Apex 50k', kind: 'drawdown', currency: 'USD', limit: 2000 });
  });

  it('réarmée seulement si la marge remonte au-dessus de 35 % (pas de rafale autour du seuil)', async () => {
    const { svc, emit, events, set, dd } = setup();
    set({ drawdown: dd(0.2) });
    await svc.check('u', 'a', emit, NOW);
    set({ drawdown: dd(0.3) });
    await svc.check('u', 'a', emit, NOW);
    set({ drawdown: dd(0.2) });
    await svc.check('u', 'a', emit, NOW);
    expect(events).toHaveLength(1);

    set({ drawdown: dd(0.5) });
    await svc.check('u', 'a', emit, NOW);
    set({ drawdown: dd(0.2) });
    await svc.check('u', 'a', emit, NOW);
    expect(events).toHaveLength(2);
  });

  it('perte journalière : alerte séparée, avec la sanction de la firm', async () => {
    const { svc, emit, events, set } = setup();
    set({ dailyLoss: { pct: 0, breached: true, remaining: -50, limit: 1000, breach: 'trading_paused_for_day' } });
    await svc.check('u', 'a', emit, NOW);
    expect(events).toEqual([expect.objectContaining({ kind: 'daily_loss', level: 'breached', breach: 'trading_paused_for_day', remaining: -50 })]);
  });

  it('journée suivante : les alertes repartent de zéro', async () => {
    const { svc, emit, events, set, dd } = setup();
    set({ drawdown: dd(0.2) });
    await svc.check('u', 'a', emit, NOW);
    await svc.check('u', 'a', emit, new Date(Date.UTC(2026, 5, 3, 16)));
    expect(events).toHaveLength(2);
  });

  it('hors Premium, compte démo ou compte non actif : rien', async () => {
    for (const opts of [{ premium: false }, { demo: true }, { status: 'FAILED' }]) {
      const { svc, emit, events, set, dd } = setup(opts);
      set({ drawdown: dd(0, true) });
      await svc.check('u', 'a', emit, NOW);
      expect(events, JSON.stringify(opts)).toHaveLength(0);
    }
  });
});

describe('PropAlertsService.schedule', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('une rafale de soldes → une seule évaluation', async () => {
    const { svc, emit, accounts } = setup();
    svc.schedule('u', 'a', emit);
    svc.schedule('u', 'a', emit);
    svc.schedule('u', 'a', emit);
    await vi.advanceTimersByTimeAsync(ALERT_DEBOUNCE_MS + 10);
    expect(accounts.list).toHaveBeenCalledTimes(1);
    expect(accounts.list).toHaveBeenCalledWith('u', { dailyLoss: true });
  });
});
