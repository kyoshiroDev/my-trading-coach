import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ALERT_DEBOUNCE_MS, PropAlertsService, alertLevel, consistencyCandidate, type PropAlertEvent } from './prop-alerts.service';

type Metrics = {
  drawdown: { pct: number; breached: boolean; margin: number; maxDrawdown: number } | null;
  dailyLoss: { pct: number; breached: boolean; remaining: number; limit: number; breach: PropAlertEvent['breach'] } | null;
  progress?: {
    kind: 'objective' | 'payout'; done: boolean; cycleAfter: string | null;
    requirements: { key: string; required: number; dayCap?: number | null; todayPnl?: number }[];
  } | null;
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
    expect(accounts.list).toHaveBeenCalledWith('u', { premium: true });
  });
});

describe('consistencyCandidate : gain max du jour', () => {
  const req = (todayPnl: number) => ({ required: 0.4, dayCap: 800, todayPnl }); // P0 = 1 200 $

  it('sous 80 % du gain max : rien ; à 80 % : avertissement ; au-delà : dépassé, avec le profit à rattraper', () => {
    expect(consistencyCandidate(req(500), 'd')!.level).toBeNull();
    expect(consistencyCandidate(req(650), 'd')).toMatchObject({ level: 'warning', payload: { remaining: 150, limit: 800, maxShare: 0.4 } });
    const over = consistencyCandidate(req(1_000), 'd')!;
    expect(over.level).toBe('breached');
    // 1 000 / 0,4 − (1 200 + 1 000) = 300 $ de profit en plus.
    expect(over.payload.extraProfit).toBeCloseTo(300);
  });

  it('réarmée sous 60 % du gain max ; sans gain max calculable : rien', () => {
    expect(consistencyCandidate(req(400), 'd')!.rearm).toBe(true);
    expect(consistencyCandidate({ required: 0.4, dayCap: null, todayPnl: 900 }, 'd')).toBeNull();
    expect(consistencyCandidate(undefined, 'd')).toBeNull();
  });
});

describe('PropAlertsService.check — consistency et bonnes nouvelles', () => {
  const progress = (p: Partial<NonNullable<Metrics['progress']>> = {}): NonNullable<Metrics['progress']> => ({
    kind: 'objective', done: false, cycleAfter: null,
    requirements: [{ key: 'consistency', required: 0.4, dayCap: 800, todayPnl: 0 }], ...p,
  });

  it('consistency : avertissement puis dépassement dans la journée', async () => {
    const { svc, emit, events, set } = setup();
    set({ progress: progress({ requirements: [{ key: 'consistency', required: 0.4, dayCap: 800, todayPnl: 700 }] }) });
    await svc.check('u', 'a', emit, NOW);
    set({ progress: progress({ requirements: [{ key: 'consistency', required: 0.4, dayCap: 800, todayPnl: 900 }] }) });
    await svc.check('u', 'a', emit, NOW);
    expect(events.map((e) => [e.kind, e.level])).toEqual([['consistency', 'warning'], ['consistency', 'breached']]);
    expect(events[1].extraProfit).toBeCloseTo(150);
  });

  it('objectif atteint : une seule fois sur l’évaluation, même les jours suivants', async () => {
    const { svc, emit, events, set } = setup();
    set({ progress: progress({ done: true, requirements: [] }) });
    await svc.check('u', 'a', emit, NOW);
    await svc.check('u', 'a', emit, new Date(Date.UTC(2026, 5, 5, 16)));
    expect(events).toEqual([expect.objectContaining({ kind: 'objective', level: 'reached' })]);
  });

  it('payout possible : une fois par cycle, de nouveau après le payout suivant', async () => {
    const { svc, emit, events, set } = setup();
    set({ progress: progress({ kind: 'payout', done: true, cycleAfter: '2026-05-20', requirements: [] }) });
    await svc.check('u', 'a', emit, NOW);
    await svc.check('u', 'a', emit, NOW);
    set({ progress: progress({ kind: 'payout', done: true, cycleAfter: '2026-06-01', requirements: [] }) });
    await svc.check('u', 'a', emit, NOW);
    expect(events.map((e) => e.kind)).toEqual(['payout', 'payout']);
  });
});
