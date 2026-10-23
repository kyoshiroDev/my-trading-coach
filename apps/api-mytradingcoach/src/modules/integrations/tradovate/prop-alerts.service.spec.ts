import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ALERT_DEBOUNCE_MS, PropAlertsService, alertLevel, consistencyCandidate, type PropAlertEvent } from './prop-alerts.service';
import { BACKGROUND_NOTE } from '../../push/trader-push-messages';
import { ALERT_LEVEL_RANK as RANK } from './prop-alert-levels';

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
      del: vi.fn(async (...keys: string[]) => { keys.forEach((k) => store.delete(k)); return keys.length; }),
      // Scripts Lua de `prop-alert-push.ts`, rejoués en JS : réservation par rang, puis restitution.
      eval: vi.fn(async (lua: string, _n: number, key: string, level: string, a: string) => {
        const cur = store.get(key) ?? null;
        if (lua.includes('local rank')) {
          if (cur && RANK[cur as keyof typeof RANK] >= RANK[level as keyof typeof RANK]) return null;
          store.set(key, level);
          return cur ?? '';
        }
        if (cur !== level) return 0;
        if (a === '') store.delete(key); else store.set(key, a);
        return 1;
      }),
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
  const notifier = { send: vi.fn(async (..._args: unknown[]) => outcome) };
  let outcome = 'sent';
  const journal = { recordReading: vi.fn(async () => undefined), recordEvent: vi.fn(async () => undefined) };
  const incidents = { detectQuietly: vi.fn(async () => undefined) };
  const svc = new PropAlertsService(prisma as never, redis as never, accounts as never, journal as never, incidents as never, notifier as never);
  const events: PropAlertEvent[] = [];
  const emit = (_e: 'prop:alert', p: PropAlertEvent) => events.push(p);
  const set = (m: Partial<Metrics>) => { metrics = { ...metrics, ...m }; };
  const dd = (pct: number, breached = false) => ({ pct, breached, margin: pct * 2000, maxDrawdown: 2000 });
  const deliver = (o: string) => { outcome = o; };
  return { svc, emit, events, set, dd, accounts, store, notifier, journal, incidents, deliver };
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

const flush = () => new Promise((r) => setTimeout(r, 0));
const dedupKeys = (n: { send: { mock: { calls: unknown[][] } } }) => n.send.mock.calls.map((c) => (c[3] as { dedupKey: string }).dedupKey);

describe('PropAlertsService → push (#666)', () => {
  it('25 % : dans l’app seulement ; 10 % : push ; dépassé : push forcé malgré l’anti-spam', async () => {
    const { svc, emit, set, dd, notifier } = setup();
    set({ drawdown: dd(0.2) });
    await svc.check('u', 'a', emit, NOW);
    await flush();
    expect(notifier.send).not.toHaveBeenCalled();

    set({ drawdown: dd(0.05) });
    await svc.check('u', 'a', emit, NOW);
    await flush();
    expect(notifier.send).toHaveBeenLastCalledWith(
      'u', 'PROP_RULES', expect.objectContaining({ title: 'Apex 50k', url: '/session', urgency: 'high' }),
      { accountId: 'a', dedupKey: 'prop:drawdown:critical', force: false },
    );

    set({ drawdown: dd(0, true) });
    await svc.check('u', 'a', emit, NOW);
    await flush();
    expect(notifier.send).toHaveBeenLastCalledWith(
      'u', 'PROP_RULES', expect.objectContaining({ body: expect.stringContaining('Drawdown max dépassé') }),
      { accountId: 'a', dedupKey: 'prop:drawdown:breached', force: true },
    );
    expect(notifier.send).toHaveBeenCalledTimes(2);
  });

  it('hors Premium ou compte démo : aucun push', async () => {
    for (const opts of [{ premium: false }, { demo: true }]) {
      const { svc, emit, set, dd, notifier } = setup(opts);
      set({ drawdown: dd(0, true) });
      await svc.check('u', 'a', emit, NOW);
      await flush();
      expect(notifier.send).not.toHaveBeenCalled();
    }
  });

  it('direct et fond en même temps sur une limite franchie : un seul push (réservation atomique, m1)', async () => {
    const { svc, emit, set, dd, notifier } = setup();
    set({ drawdown: dd(0, true) });
    await Promise.all([svc.check('u', 'a', emit, NOW), svc.checkFromBackground('u', 'a', NOW)]);
    await flush();
    expect(dedupKeys(notifier)).toEqual(['prop:drawdown:breached']);
  });
});

describe('PropAlertsService.checkFromBackground (#666, synchro de fond, app fermée)', () => {
  it('25 % : rien, aucun marqueur posé', async () => {
    const { svc, set, dd, notifier, store } = setup();
    set({ drawdown: dd(0.2) });
    await svc.checkFromBackground('u', 'a', NOW);
    expect(notifier.send).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('10 % : push avec le décalage annoncé, sans événement d’app, ni journal, ni incident', async () => {
    const { svc, set, dd, notifier, journal, incidents, events } = setup();
    set({ drawdown: dd(0.05) });
    await svc.checkFromBackground('u', 'a', NOW);
    expect(notifier.send).toHaveBeenCalledWith(
      'u', 'PROP_RULES', expect.objectContaining({ body: expect.stringContaining(BACKGROUND_NOTE) }),
      { accountId: 'a', dedupKey: 'prop:drawdown:critical', force: false },
    );
    expect(events).toHaveLength(0);
    expect(journal.recordReading).not.toHaveBeenCalled();
    expect(journal.recordEvent).not.toHaveBeenCalled();
    expect(incidents.detectQuietly).not.toHaveBeenCalled();
  });

  it('trader SANS appareil : à l’ouverture de l’app, l’alerte s’affiche (revue I3)', async () => {
    const { svc, emit, events, set, dd, notifier, journal, deliver } = setup();
    deliver('no_device');
    set({ drawdown: dd(0, true) });
    await svc.checkFromBackground('u', 'a', NOW);
    await svc.check('u', 'a', emit, NOW);
    await flush();
    expect(events.map((e) => [e.kind, e.level])).toEqual([['drawdown', 'breached']]);
    expect(journal.recordEvent).toHaveBeenCalledTimes(1);
    // Le push reste à faire : tenté au relevé de fond, puis une fois à l'affichage.
    expect(notifier.send).toHaveBeenCalledTimes(2);
  });

  it('push parti en fond : l’app affiche l’alerte à l’ouverture, sans second push', async () => {
    const { svc, emit, events, set, dd, notifier } = setup();
    set({ drawdown: dd(0.05) });
    await svc.checkFromBackground('u', 'a', NOW);
    await svc.check('u', 'a', emit, NOW);
    await flush();
    expect(events.map((e) => e.level)).toEqual(['critical']);
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('push parti en fond : les relevés suivants ne le renvoient pas', async () => {
    const { svc, set, dd, notifier } = setup();
    set({ drawdown: dd(0.05) });
    await svc.checkFromBackground('u', 'a', NOW);
    await svc.checkFromBackground('u', 'a', NOW);
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('limite franchie, objectif, payout : push ; consistency : jamais depuis le fond', async () => {
    const { svc, set, dd, notifier, incidents } = setup();
    set({
      drawdown: dd(0, true),
      progress: { kind: 'objective', done: true, cycleAfter: null, requirements: [{ key: 'consistency', required: 0.4, dayCap: 100, todayPnl: 500 }] },
    });
    await svc.checkFromBackground('u', 'a', NOW);
    expect(dedupKeys(notifier)).toEqual(['prop:drawdown:breached', 'prop:objective:reached']);
    expect(notifier.send.mock.calls[0][3]).toMatchObject({ force: true });
    expect(incidents.detectQuietly).not.toHaveBeenCalled();
  });

  it('compte échoué ou archivé : rien', async () => {
    for (const status of ['FAILED', 'ARCHIVED']) {
      const { svc, set, dd, notifier } = setup({ status });
      set({ drawdown: dd(0, true) });
      await svc.checkFromBackground('u', 'a', NOW);
      expect(notifier.send).not.toHaveBeenCalled();
    }
  });
});
