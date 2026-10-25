import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PropAlertsService } from './prop-alerts.service';
import { MAX_UNDELIVERED_PUSH } from './prop-alert-push';
import type { TraderNotifier } from '../../push/trader-notifier.service';

/**
 * Journaux des alertes prop firm : ni identifiant (utilisateur, compte), ni clé Redis, ni message
 * brut d'exception, à aucun niveau. Tout ce que les `Logger` Nest reçoivent est capturé, un chemin
 * de journal à la fois.
 */

const USER_ID = 'usr_7f3c9a2b';
const ACCOUNT_ID = 'acc_51d2e8f0';
const LEAK = 'Invalid prisma.tradingAccount';
const FORBIDDEN = [USER_ID, ACCOUNT_ID, 'prop-alert-push:', 'prop-alert:', LEAK];

// Erreur telle que Prisma ou ioredis la formulent : identifiants et clé dans le message.
const leakyError = () =>
  new Error(`${LEAK}.findMany() where { userId: "${USER_ID}" } key prop-alert-push:${ACCOUNT_ID}:drawdown prop-alert:${ACCOUNT_ID}`);

const LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
let lines: string[] = [];

beforeEach(() => {
  lines = [];
  for (const level of LEVELS) {
    vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      lines.push(`${level}: ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    });
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function expectNoIdentifier() {
  const text = lines.join('\n');
  for (const f of FORBIDDEN) expect(text, `journal contenant « ${f} »`).not.toContain(f);
}

const NOW = new Date(Date.UTC(2026, 5, 2, 16));

function setup(opts: {
  list?: () => Promise<unknown>;
  recordReading?: () => Promise<unknown>;
  recordEvent?: () => Promise<unknown>;
  claim?: () => Promise<unknown>;
  count?: () => Promise<unknown>;
  release?: () => Promise<unknown>;
  outcome?: string;
} = {}) {
  const store = new Map<string, string>();
  const redis = {
    client: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
      del: vi.fn(async () => 1),
      // Scripts Lua de `prop-alert-push.ts` : comptage, réservation, restitution.
      eval: vi.fn(async (lua: string) => {
        if (lua.includes("'incr'")) return (opts.count ?? (async () => 1))();
        if (lua.includes('local rank')) return (opts.claim ?? (async () => ''))();
        return (opts.release ?? (async () => 1))();
      }),
    },
  };
  const prisma = { user: { findUnique: vi.fn(async () => ({ plan: 'PREMIUM', role: 'USER', trialEndsAt: null, isDemo: false })) } };
  const metrics = { drawdown: { pct: 0, breached: true, margin: 0, maxDrawdown: 2000, floor: 48_000 }, dailyLoss: null };
  const accounts = {
    list: vi.fn(opts.list ?? (async () => [{ id: ACCOUNT_ID, label: 'Jean Dupont', currency: 'USD', status: 'ACTIVE', metrics }])),
  };
  const journal = {
    recordReading: vi.fn(opts.recordReading ?? (async () => undefined)),
    recordEvent: vi.fn(opts.recordEvent ?? (async () => undefined)),
  };
  const incidents = { detectQuietly: vi.fn(async () => undefined) };
  const notifier = { send: vi.fn(async () => opts.outcome ?? 'sent') } as unknown as TraderNotifier;
  return new PropAlertsService(prisma as never, redis as never, accounts as never, journal as never, incidents as never, notifier);
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const live = async (svc: PropAlertsService) => {
  await svc.check(USER_ID, ACCOUNT_ID, () => undefined, NOW);
  await flush();
};
const background = (svc: PropAlertsService) => svc.checkFromBackground(USER_ID, ACCOUNT_ID, NOW);

describe('PropAlertsService · journaux sans identifiant, tous niveaux', () => {
  it('évaluation planifiée en échec (schedule)', async () => {
    vi.useFakeTimers();
    setup({ list: () => Promise.reject(leakyError()) }).schedule(USER_ID, ACCOUNT_ID, () => undefined);
    await vi.runAllTimersAsync();
    expectNoIdentifier();
    expect(lines).toEqual(['warn: Alertes prop firm non évaluées (Error)']);
  });

  it('séance non journalisée (direct)', async () => {
    await live(setup({ recordReading: () => Promise.reject(leakyError()) }));
    expectNoIdentifier();
    expect(lines).toEqual(['warn: Séance non journalisée (Error)']);
  });

  it('alerte non journalisée (direct)', async () => {
    await live(setup({ recordEvent: () => Promise.reject(leakyError()) }));
    expectNoIdentifier();
    expect(lines).toEqual(['warn: Alerte drawdown breached non journalisée (Error)']);
  });

  it('réservation du push impossible (fond)', async () => {
    await background(setup({ claim: () => Promise.reject(leakyError()) }));
    expectNoIdentifier();
    expect(lines).toEqual(['warn: Push prop firm non envoyé, réservation impossible (drawdown breached, Error)']);
  });

  it(`push abandonné après ${MAX_UNDELIVERED_PUSH} envois sans livraison (fond)`, async () => {
    await background(setup({ outcome: 'undelivered', count: async () => MAX_UNDELIVERED_PUSH }));
    expectNoIdentifier();
    expect(lines).toEqual([`warn: Push prop firm abandonné après ${MAX_UNDELIVERED_PUSH} envois sans livraison (drawdown breached)`]);
  });

  it.each([
    ['envoyé sans livraison, comptage impossible', { outcome: 'undelivered', count: () => Promise.reject(leakyError()) }, 'envoyé sans livraison'],
    ['non parti, restitution impossible', { outcome: 'muted', release: () => Promise.reject(leakyError()) }, 'non parti (muted)'],
  ] as const)('suivi Redis impossible après le push (fond) : %s', async (_, opts, done) => {
    await background(setup(opts));
    expectNoIdentifier();
    expect(lines).toEqual([
      `warn: Push prop firm ${done}, suivi Redis impossible : niveau pas retenté avant expiration (drawdown breached, Error)`,
    ]);
  });

  it('chemins sans erreur (direct et fond) : aucun identifiant', async () => {
    await live(setup());
    await background(setup({ outcome: 'undelivered' }));
    expectNoIdentifier();
  });
});
