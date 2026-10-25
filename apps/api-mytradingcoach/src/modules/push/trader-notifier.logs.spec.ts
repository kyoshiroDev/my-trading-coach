import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { PushAlertType } from '@prisma/client';
import { TraderNotifier, type TraderNotifyOptions, type TraderNotifyOutcome } from './trader-notifier.service';
import { TRADER_PUSH_MESSAGES } from './trader-push-messages';
import type { TraderPushService } from './trader-push.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../infra/redis.service';

/**
 * Journaux du notifier : aucun identifiant, à aucun niveau (debug compris, éteint en production
 * mais allumé en dev). Tout ce que les `Logger` Nest reçoivent est capturé, chemin par chemin.
 */

const USER_ID = 'usr_7f3c9a2b';
const ACCOUNT_ID = 'acc_51d2e8f0';
// Clé anti-doublon contenant un identifiant de compte : texte libre de l'appelant.
const DEDUP_KEY = `prop:drawdown:critical:${ACCOUNT_ID}`;
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/eAbc123-jetonSecretAbonnement';
const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const AUTH = 'tBHItJI5svbpez7KI4CCXg';
const FORBIDDEN = [USER_ID, ACCOUNT_ID, DEDUP_KEY, 'push:spam:', ENDPOINT, 'eAbc123', P256DH, AUTH];

// Erreur telle que Prisma ou web-push la formulent : identifiants et adresse dans le message.
const leakyError = () =>
  new Error(`Invalid prisma.user.findUnique() where { id: "${USER_ID}" } account ${ACCOUNT_ID} ${ENDPOINT} p256dh=${P256DH} auth=${AUTH}`);

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
afterEach(() => vi.restoreAllMocks());

function expectNoIdentifier() {
  const text = lines.join('\n');
  for (const f of FORBIDDEN) expect(text, `journal contenant « ${f} »`).not.toContain(f);
}

const NOON = new Date('2026-07-01T10:00:00Z');
const BASE_USER = { isDemo: false, plan: 'PREMIUM', role: 'USER', trialEndsAt: null, pushPreference: null, _count: { pushDevices: 1 } };

function setup(opts: {
  user?: Record<string, unknown> | null;
  enabled?: boolean | (() => boolean);
  redisSet?: () => Promise<unknown>;
  findUnique?: () => Promise<unknown>;
  delivered?: number;
} = {}) {
  const findUnique = vi.fn(opts.findUnique ?? (() => Promise.resolve(opts.user === null ? null : { ...BASE_USER, ...opts.user })));
  const findMany = vi.fn().mockResolvedValue([{ id: ACCOUNT_ID, propFirmPlan: { accountSize: 50_000, firm: { name: 'Apex' } } }]);
  const prisma = { user: { findUnique }, tradingAccount: { findMany } } as unknown as PrismaService;
  const redis = { client: { set: vi.fn(opts.redisSet ?? (() => Promise.resolve('OK'))) } } as unknown as RedisService;
  const delivered = opts.delivered ?? 1;
  const deliverToUser = vi.fn().mockResolvedValue({ subscriptions: 2, delivered, failed: 2 - delivered, removed: 0 });
  const enabled = opts.enabled ?? true;
  const push = Object.defineProperty({ deliverToUser }, 'enabled', {
    get: typeof enabled === 'function' ? enabled : () => enabled,
  }) as unknown as TraderPushService;
  return new TraderNotifier(prisma, redis, push);
}

const msg = TRADER_PUSH_MESSAGES.tradovateReconnect(ACCOUNT_ID);
const options = (force = false): TraderNotifyOptions => ({ accountId: ACCOUNT_ID, dedupKey: DEDUP_KEY, force });
const send = (n: TraderNotifier, type: PushAlertType = 'PROP_RULES', force = false) => n.send(USER_ID, type, msg, options(force), NOON);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('TraderNotifier · journaux sans identifiant, tous niveaux', () => {
  it.each<[string, Parameters<typeof setup>[0], PushAlertType, boolean, TraderNotifyOutcome]>([
    ['push désactivé', { enabled: false }, 'PROP_RULES', false, 'disabled'],
    ['utilisateur inconnu', { user: null }, 'PROP_RULES', false, 'unknown_user'],
    ['compte démo', { user: { isDemo: true } }, 'PROP_RULES', false, 'demo'],
    ['aucun appareil', { user: { _count: { pushDevices: 0 } } }, 'PROP_RULES', false, 'no_device'],
    ['plan Free', { user: { plan: 'FREE' } }, 'PROP_RULES', false, 'plan'],
    ['type coupé', {}, 'RECAP', false, 'muted'],
    ['heures silencieuses', { user: { pushPreference: { mutedTypes: [], quietStart: 660, quietEnd: 780 } } }, 'PROP_RULES', true, 'quiet_hours'],
    ['anti-spam', { redisSet: () => Promise.resolve(null) }, 'PROP_RULES', false, 'anti_spam'],
    ['envoyé', {}, 'PROP_RULES', false, 'sent'],
    ['envoyé forcé malgré l’anti-spam', { redisSet: () => Promise.resolve(null) }, 'PROP_RULES', true, 'sent'],
    ['envoyé, Redis indisponible', { redisSet: () => Promise.reject(leakyError()) }, 'PROP_RULES', false, 'sent'],
    ['aucun appareil ne l’a reçu', { delivered: 0 }, 'PROP_RULES', true, 'undelivered'],
  ])('send · %s', async (_, opts, type, force, outcome) => {
    expect(await send(setup(opts), type, force)).toBe(outcome);
    expectNoIdentifier();
  });

  it('send · envoi journalisé en debug avec type, niveau et résultat seulement', async () => {
    await send(setup({ redisSet: () => Promise.resolve(null), delivered: 0 }), 'PROP_RULES', true);
    expect(lines).toEqual(['debug: Push PROP_RULES forcé : undelivered, 0/2 livré(s)']);
  });

  it('notify · base indisponible (rejet asynchrone) : ni message brut ni identifiant', async () => {
    setup({ findUnique: () => Promise.reject(leakyError()) }).notify(USER_ID, 'PROP_RULES', msg, options());
    await flush();
    expectNoIdentifier();
    expect(lines).toEqual(['warn: Push PROP_RULES non envoyé (Error)']);
  });

  it('notify · exception synchrone : ni message brut ni identifiant', () => {
    const notifier = setup({ enabled: () => { throw leakyError(); } });
    expect(() => notifier.notify(USER_ID, 'PROP_RULES', msg, options())).not.toThrow();
    expectNoIdentifier();
    expect(lines).toEqual(['warn: Push PROP_RULES non envoyé (Error)']);
  });

  it('notify · envoi réussi en tâche de fond', async () => {
    setup().notify(USER_ID, 'BEHAVIOR', msg, options());
    await flush();
    expect(lines.length).toBeGreaterThan(0);
    expectNoIdentifier();
  });
});
