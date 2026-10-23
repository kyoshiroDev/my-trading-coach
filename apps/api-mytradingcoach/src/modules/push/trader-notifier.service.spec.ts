import { describe, it, expect, vi } from 'vitest';
import type { PushAlertType } from '@prisma/client';
import { TraderNotifier, PUSH_ANTI_SPAM_MS } from './trader-notifier.service';
import { TRADER_PUSH_MESSAGES } from './trader-push-messages';
import type { TraderPushService } from './trader-push.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../infra/redis.service';

/** Filtres appliqués côté API avant tout envoi, dans l'ordre : chaque test en isole un. */

const PREMIUM = { plan: 'PREMIUM', role: 'USER', trialEndsAt: null };
const FREE = { plan: 'FREE', role: 'USER', trialEndsAt: null };
// 2026-07-01T10:00Z = 12:00 à Paris (été).
const NOON = new Date('2026-07-01T10:00:00Z');

function setup(user: Record<string, unknown> | null, opts: { enabled?: boolean; redisSet?: () => Promise<unknown> } = {}) {
  const findUnique = vi.fn().mockResolvedValue(
    user === null ? null : { isDemo: false, ...PREMIUM, pushPreference: null, _count: { pushDevices: 1 }, ...user },
  );
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  const set = vi.fn(opts.redisSet ?? (() => Promise.resolve('OK')));
  const redis = { client: { set } } as unknown as RedisService;
  const deliverToUser = vi.fn().mockResolvedValue({ subscriptions: 1, delivered: 1, failed: 0, removed: 0 });
  const push = { enabled: opts.enabled ?? true, deliverToUser } as unknown as TraderPushService;
  return { notifier: new TraderNotifier(prisma, redis, push), deliverToUser, set };
}

const msg = TRADER_PUSH_MESSAGES.tradovateReconnect('acc-1', 'Apex 50K');
const send = (n: TraderNotifier, type: PushAlertType, force = false) =>
  n.send('u1', type, msg, { accountId: 'acc-1', dedupKey: 'prop:drawdown:critical', force }, NOON);

describe('TraderNotifier.send', () => {
  it('Premium, appareil abonné, rien de coupé : envoyé, clé anti-spam de 15 min par compte', async () => {
    const { notifier, deliverToUser, set } = setup({});
    expect(await send(notifier, 'PROP_RULES')).toBe('sent');
    expect(deliverToUser).toHaveBeenCalledWith('u1', msg);
    expect(set).toHaveBeenCalledWith('push:spam:u1:acc-1:prop:drawdown:critical', '1', 'PX', PUSH_ANTI_SPAM_MS, 'NX');
  });

  it.each([
    ['push désactivé sur le serveur', {}, { enabled: false }, 'disabled'],
    ['utilisateur supprimé', null, {}, 'unknown_user'],
    ['compte démo', { isDemo: true }, {}, 'demo'],
    ['aucun appareil', { _count: { pushDevices: 0 } }, {}, 'no_device'],
  ] as const)('%s : rien n’est envoyé', async (_, user, opts, outcome) => {
    const { notifier, deliverToUser } = setup(user as Record<string, unknown> | null, opts);
    expect(await send(notifier, 'PROP_RULES')).toBe(outcome);
    expect(deliverToUser).not.toHaveBeenCalled();
  });

  it('plan : les types Premium ne partent pas en Free, la connexion Tradovate si', async () => {
    const { notifier, deliverToUser } = setup(FREE);
    for (const t of ['PROP_RULES', 'BEHAVIOR', 'RECAP'] as const) expect(await send(notifier, t)).toBe('plan');
    expect(await send(notifier, 'CONNECTION')).toBe('sent');
    expect(deliverToUser).toHaveBeenCalledTimes(1);
  });

  it('essai en cours : traité comme Premium', async () => {
    const { notifier } = setup({ ...FREE, trialEndsAt: new Date(Date.now() + 86_400_000) });
    expect(await send(notifier, 'PROP_RULES')).toBe('sent');
  });

  it('types coupés : récap coupé par défaut, réglage du trader sinon', async () => {
    expect(await send(setup({}).notifier, 'RECAP')).toBe('muted');
    const pref = { mutedTypes: ['BEHAVIOR'], quietStart: null, quietEnd: null };
    const { notifier } = setup({ pushPreference: pref });
    expect(await send(notifier, 'BEHAVIOR')).toBe('muted');
    expect(await send(notifier, 'RECAP')).toBe('sent');
  });

  it('heures silencieuses (heure de Paris) : rien, même une limite franchie', async () => {
    const pref = { mutedTypes: [], quietStart: 11 * 60, quietEnd: 13 * 60 };
    const { notifier, set } = setup({ pushPreference: pref });
    expect(await send(notifier, 'PROP_RULES', true)).toBe('quiet_hours');
    expect(set).not.toHaveBeenCalled();
    const outside = setup({ pushPreference: { ...pref, quietStart: 22 * 60, quietEnd: 7 * 60 } });
    expect(await send(outside.notifier, 'PROP_RULES')).toBe('sent');
  });

  it('anti-spam : la même alerte dans les 15 min ne repart pas, sauf limite franchie', async () => {
    const { notifier, deliverToUser } = setup({}, { redisSet: () => Promise.resolve(null) });
    expect(await send(notifier, 'PROP_RULES')).toBe('anti_spam');
    expect(await send(notifier, 'PROP_RULES', true)).toBe('sent');
    expect(deliverToUser).toHaveBeenCalledTimes(1);
  });

  it('Redis indisponible : on envoie plutôt que de perdre une alerte', async () => {
    const { notifier } = setup({}, { redisSet: () => Promise.reject(new Error('down')) });
    expect(await send(notifier, 'PROP_RULES')).toBe('sent');
  });
});

describe('TraderNotifier.notify', () => {
  it('ne lève jamais, même si la base est indisponible', async () => {
    const { notifier } = setup({});
    (notifier as unknown as { prisma: { user: { findUnique: () => Promise<never> } } }).prisma.user.findUnique =
      () => Promise.reject(new Error('db down'));
    expect(() => notifier.notify('u1', 'PROP_RULES', msg, { dedupKey: 'x' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('push désactivé : ne lit même pas la base', () => {
    const { notifier, deliverToUser } = setup({}, { enabled: false });
    notifier.notify('u1', 'PROP_RULES', msg, { dedupKey: 'x' });
    expect(deliverToUser).not.toHaveBeenCalled();
  });
});
