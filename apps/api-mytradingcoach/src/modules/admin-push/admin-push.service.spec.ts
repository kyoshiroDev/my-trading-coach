import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceUnavailableException, NotFoundException } from '@nestjs/common';
import { AdminPushEvent, Role } from '@prisma/client';
import { AdminPushService, hostOf } from './admin-push.service';
import { AdminNotifier } from './admin-notifier.service';
import { ADMIN_PUSH_MESSAGES } from './push-messages';
import type { PushSender } from '../push/push-sender';
import type { PushConfigResult } from '../../config/push-config';
import type { PrismaService } from '../../prisma/prisma.service';

const ENABLED: PushConfigResult = {
  enabled: true,
  config: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:hello@mytradingcoach.app' },
};
const sub = (id: string) => ({ id, endpoint: `https://web.push.apple.com/${id}-secret-token`, p256dh: 'k'.repeat(87), auth: 'a'.repeat(22) });

function setup(opts: { config?: PushConfigResult; sender?: PushSender | null; targets?: ReturnType<typeof sub>[] } = {}) {
  const db = {
    findMany: vi.fn().mockResolvedValue(opts.targets ?? [sub('s1')]),
    update: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn().mockResolvedValue({ mutedEvents: [] }),
    findFirst: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = { adminPushSubscription: db } as unknown as PrismaService;
  const send = vi.fn().mockResolvedValue(201);
  const sender = opts.sender === undefined ? ({ send } as PushSender) : opts.sender;
  const service = new AdminPushService(prisma, opts.config ?? ENABLED, sender);
  return { service, db, send };
}

describe('AdminPushService.deliver', () => {
  it('2xx → livré, lastSuccessAt mis à jour, payload Angular avec url de l’admin', async () => {
    const { service, db, send } = setup();
    const r = await service.deliver(AdminPushEvent.SIGNUP, ADMIN_PUSH_MESSAGES.signup());
    expect(r).toEqual({ subscriptions: 1, delivered: 1, failed: 0, removed: 0 });
    expect(db.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { lastSuccessAt: expect.any(Date) } });
    const payload = JSON.parse(send.mock.calls[0][1]);
    expect(payload.notification.title).toBe('Nouvelle inscription');
    expect(payload.notification.data.onActionClick.default).toEqual({ operation: 'navigateLastFocusedOrOpen', url: '/users' });
    expect(send.mock.calls[0][2]).toEqual({ ttlSeconds: 86400, urgency: 'normal' });
  });

  it('410 / 404 → abonnement mort supprimé', async () => {
    const { service, db, send } = setup({ targets: [sub('mort'), sub('perdu')] });
    send.mockResolvedValueOnce(410).mockResolvedValueOnce(404);
    const r = await service.deliver(AdminPushEvent.PREMIUM, ADMIN_PUSH_MESSAGES.premiumSubscription(false));
    expect(r).toEqual({ subscriptions: 2, delivered: 0, failed: 0, removed: 2 });
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { id: 'mort' } });
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { id: 'perdu' } });
  });

  it('erreur réseau ou autre code → échec compté, aucune exception, rien de supprimé', async () => {
    const { service, db, send } = setup({ targets: [sub('a'), sub('b')] });
    send.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(500);
    const r = await service.deliver(AdminPushEvent.SIGNUP, ADMIN_PUSH_MESSAGES.signup());
    expect(r).toEqual({ subscriptions: 2, delivered: 0, failed: 2, removed: 0 });
    expect(db.deleteMany).not.toHaveBeenCalled();
  });

  it('ne vise que les appareils ADMIN qui n’ont pas coupé l’événement', async () => {
    const { service, db } = setup();
    await service.deliver(AdminPushEvent.TRADOVATE_RECONNECT, ADMIN_PUSH_MESSAGES.tradovateReconnect());
    expect(db.findMany.mock.calls[0][0].where).toEqual({
      user: { role: Role.ADMIN },
      NOT: { mutedEvents: { has: AdminPushEvent.TRADOVATE_RECONNECT } },
    });
  });

  it('le test (event null) ignore les préférences mais reste réservé aux ADMIN', async () => {
    const { service, db } = setup();
    await service.test();
    expect(db.findMany.mock.calls[0][0].where).toEqual({ user: { role: Role.ADMIN } });
  });

  it('push désactivé → rien n’est lu ni envoyé ; le test répond 503', async () => {
    const { service, db } = setup({ config: { enabled: false, reason: 'PUSH_ENABLED ≠ true' }, sender: null });
    expect(await service.deliver(AdminPushEvent.SIGNUP, ADMIN_PUSH_MESSAGES.signup())).toEqual({ subscriptions: 0, delivered: 0, failed: 0, removed: 0 });
    expect(db.findMany).not.toHaveBeenCalled();
    await expect(service.test()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(service.publicKey()).toEqual({ enabled: false, publicKey: null });
  });
});

describe('AdminPushService : abonnement et préférences', () => {
  const dto = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'k'.repeat(87), auth: 'a'.repeat(22) } };

  it('subscribe : upsert par endpoint, rattaché à l’admin courant, user-agent tronqué', async () => {
    const { service, db } = setup();
    await service.subscribe('admin1', dto, 'x'.repeat(500));
    const arg = db.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ endpoint: dto.endpoint });
    expect(arg.create).toMatchObject({ userId: 'admin1', p256dh: dto.keys.p256dh, auth: dto.keys.auth });
    expect(arg.create.userAgent).toHaveLength(300);
    expect(arg.update.userId).toBe('admin1');
  });

  it('préférences : dédoublonnées ; appareil inconnu → 404', async () => {
    const { service, db } = setup();
    const r = await service.setPreferences('admin1', dto.endpoint, [AdminPushEvent.SIGNUP, AdminPushEvent.SIGNUP]);
    expect(r.mutedEvents).toEqual([AdminPushEvent.SIGNUP]);
    expect(db.updateMany.mock.calls[0][0].where).toEqual({ userId: 'admin1', endpoint: dto.endpoint });
    db.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.setPreferences('admin1', dto.endpoint, [])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('les journaux ne contiennent que l’hôte du service push, jamais l’endpoint', () => {
    expect(hostOf('https://web.push.apple.com/QGx…secret')).toBe('web.push.apple.com');
    expect(hostOf('pas une url')).toBe('?');
  });
});

describe('AdminNotifier.notify', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('rend la main sans attendre et ne lève jamais, même si la base est en panne', async () => {
    const { service, db } = setup();
    db.findMany.mockRejectedValue(new Error('base indisponible'));
    const notifier = new AdminNotifier(service);
    expect(() => notifier.notify(AdminPushEvent.SIGNUP, ADMIN_PUSH_MESSAGES.signup())).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // la promesse rejetée est absorbée (pas d'unhandled rejection)
  });

  it('push désactivé → aucun appel', () => {
    const { service, db } = setup({ config: { enabled: false, reason: 'x' }, sender: null });
    new AdminNotifier(service).notify(AdminPushEvent.SIGNUP, ADMIN_PUSH_MESSAGES.signup());
    expect(db.findMany).not.toHaveBeenCalled();
  });
});
