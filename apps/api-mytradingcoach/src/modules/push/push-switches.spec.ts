import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import webpush from 'web-push';
import { PushCoreModule } from './push-core.module';
import { PUSH_CONFIG, PUSH_SENDER, type PushSender } from './push-sender';
import { TraderPushService } from './trader-push.service';
import { TraderNotifier } from './trader-notifier.service';
import { TRADER_PUSH_MESSAGES } from './trader-push-messages';
import { AdminPushService } from '../admin-push/admin-push.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import type { PushConfigResult } from '../../config/push-config';

/**
 * Deux interrupteurs (#666) : `PUSH_ENABLED` (admin ET traders, clés VAPID) et
 * `TRADER_PUSH_ENABLED` (traders seulement, éteint si absent). Vrai `PushCoreModule` câblé par
 * Nest depuis l'environnement ; seul le service push du navigateur est simulé.
 */

const keys = webpush.generateVAPIDKeys();
const VAPID = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:support@mytradingcoach.app' };
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'k'.repeat(87), auth: 'a'.repeat(22) } };
const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

async function boot(env: { PUSH_ENABLED?: string; TRADER_PUSH_ENABLED?: string }) {
  process.env = { ...saved, ...VAPID, PUSH_ENABLED: env.PUSH_ENABLED, TRADER_PUSH_ENABLED: env.TRADER_PUSH_ENABLED };
  for (const k of ['PUSH_ENABLED', 'TRADER_PUSH_ENABLED'] as const) if (env[k] === undefined) delete process.env[k];
  const send = vi.fn(async () => 201);
  const device = {
    id: 'd1', endpoint: SUB.endpoint, p256dh: SUB.keys.p256dh, auth: SUB.keys.auth,
    userAgent: null, createdAt: new Date('2026-10-01T00:00:00Z'), lastSuccessAt: null,
  };
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        isDemo: false, plan: 'PREMIUM', role: 'USER', trialEndsAt: null, pushPreference: null, _count: { pushDevices: 1 },
      })),
    },
    tradingAccount: { findMany: vi.fn(async () => []) },
    traderPushPreference: { findUnique: vi.fn(async () => null) },
    userPushDevice: {
      findMany: vi.fn(async () => [device]),
      findFirst: vi.fn(async () => ({ id: 'd1' })),
      upsert: vi.fn(async () => ({ id: 'd1' })),
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    adminPushSubscription: { upsert: vi.fn(async () => ({ mutedEvents: [] })) },
  };
  const redis = { client: { set: vi.fn(async () => 'OK') } };
  const mod = await Test.createTestingModule({
    imports: [PushCoreModule],
    providers: [
      TraderPushService, TraderNotifier, AdminPushService,
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redis },
    ],
  })
    // Même règle que le vrai module (null si PUSH_ENABLED est coupé), sans réseau.
    .overrideProvider(PUSH_SENDER)
    .useFactory({ factory: (cfg: PushConfigResult): PushSender | null => (cfg.enabled ? ({ send } as PushSender) : null), inject: [PUSH_CONFIG] })
    .compile();
  return {
    trader: mod.get(TraderPushService),
    notifier: mod.get(TraderNotifier),
    admin: mod.get(AdminPushService),
    send,
    prisma,
  };
}

const status = (p: Promise<unknown>) => p.then(() => 200, (e: unknown) => (e instanceof ServiceUnavailableException ? 503 : 500));

describe('Interrupteurs du push : PUSH_ENABLED et TRADER_PUSH_ENABLED', () => {
  it.each([
    ['les deux absents', {}, false, false],
    ['PUSH_ENABLED seul (admin seul allumé)', { PUSH_ENABLED: 'true' }, true, false],
    ['TRADER_PUSH_ENABLED seul (sans clés actives)', { TRADER_PUSH_ENABLED: 'true' }, false, false],
    ['les deux à true', { PUSH_ENABLED: 'true', TRADER_PUSH_ENABLED: 'true' }, true, true],
  ] as const)('%s', async (_, env, adminOn, traderOn) => {
    const { trader, notifier, admin, send } = await boot(env);

    // Admin : PUSH_ENABLED seul décide.
    expect(admin.enabled).toBe(adminOn);
    expect(admin.publicKey().enabled).toBe(adminOn);
    expect(await status(admin.subscribe('admin', SUB as never, null))).toBe(adminOn ? 200 : 503);

    // Traders : les deux sont exigés.
    expect(trader.enabled).toBe(traderOn);
    const settings = await trader.settings('u1');
    expect(settings.enabled).toBe(traderOn);
    expect(settings.publicKey === null).toBe(!traderOn);
    expect(await status(trader.subscribe('u1', SUB as never, null))).toBe(traderOn ? 200 : 503);
    expect(await status(trader.test('u1'))).toBe(traderOn ? 200 : 503);
    const outcome = await notifier.send('u1', 'CONNECTION', TRADER_PUSH_MESSAGES.test(), { dedupKey: 'k' });
    expect(outcome).toBe(traderOn ? 'sent' : 'disabled');
    // Avec le test : 2 envois si allumé, aucun sinon.
    expect(send).toHaveBeenCalledTimes(traderOn ? 2 : 0);

    // Retrait d'un appareil et déconnexion : toujours possibles, sans erreur.
    await expect(trader.removeDevice('u1', 'd1')).resolves.toEqual({ removed: true });
    await expect(trader.unsubscribe('u1', SUB.endpoint)).resolves.toEqual({ removed: true });
  });

  it.each(['false', 'TRUE', '1', 'yes', ''])('TRADER_PUSH_ENABLED=%j : traders éteints (seule « true » allume)', async (v) => {
    const { trader } = await boot({ PUSH_ENABLED: 'true', TRADER_PUSH_ENABLED: v });
    expect(trader.enabled).toBe(false);
  });
});
