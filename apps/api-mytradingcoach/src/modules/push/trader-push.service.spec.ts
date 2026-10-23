import { describe, it, expect, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { TraderPushService, MAX_PUSH_DEVICES } from './trader-push.service';
import { TRADER_PUSH_MESSAGES } from './trader-push-messages';
import type { PushSender } from './push-sender';
import type { PushConfigResult } from '../../config/push-config';
import type { PrismaService } from '../../prisma/prisma.service';

const ENABLED: PushConfigResult = {
  enabled: true,
  config: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:support@mytradingcoach.app' },
};
const dev = (id: string) => ({ id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}-secret`, p256dh: 'k'.repeat(87), auth: 'a'.repeat(22) });
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/new-secret', keys: { p256dh: 'k'.repeat(87), auth: 'a'.repeat(22) } };

function setup(opts: { config?: PushConfigResult; status?: number; devices?: ReturnType<typeof dev>[] } = {}) {
  const db = {
    findMany: vi.fn().mockResolvedValue(opts.devices ?? [dev('d1')]),
    findFirst: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({ id: 'd-new' }),
    update: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const pref = { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) };
  const prisma = { userPushDevice: db, traderPushPreference: pref } as unknown as PrismaService;
  const send = vi.fn().mockResolvedValue(opts.status ?? 201);
  const service = new TraderPushService(prisma, opts.config ?? ENABLED, { send } as PushSender);
  return { service, db, pref, send };
}

describe('TraderPushService.deliverToUser', () => {
  it('tous les appareils du trader, payload de l’app, TTL et urgence du message', async () => {
    const { service, db, send } = setup({ devices: [dev('d1'), dev('d2')] });
    const r = await service.deliverToUser('u1', TRADER_PUSH_MESSAGES.recapReady());
    expect(r).toEqual({ subscriptions: 2, delivered: 2, failed: 0, removed: 0 });
    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
    expect(JSON.parse(send.mock.calls[0][1])).toMatchObject({ title: 'Récap du jour', url: '/dashboard' });
    expect(send.mock.calls[0][2]).toEqual({ ttlSeconds: 12 * 3600, urgency: 'normal' });
    expect(db.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { lastSuccessAt: expect.any(Date) } });
  });

  it.each([404, 410])('%i : abonnement expiré supprimé', async (status) => {
    const { service, db } = setup({ status });
    const r = await service.deliverToUser('u1', TRADER_PUSH_MESSAGES.test());
    expect(r.removed).toBe(1);
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('autre refus : compté en échec, abonnement gardé', async () => {
    const { service, db } = setup({ status: 429 });
    expect((await service.deliverToUser('u1', TRADER_PUSH_MESSAGES.test())).failed).toBe(1);
    expect(db.deleteMany).not.toHaveBeenCalled();
  });

  it('push désactivé : rien n’est lu ni envoyé', async () => {
    const { service, db, send } = setup({ config: { enabled: false, reason: 'off' } });
    expect((await service.deliverToUser('u1', TRADER_PUSH_MESSAGES.test())).subscriptions).toBe(0);
    expect(db.findMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('TraderPushService abonnements et réglages', () => {
  it('subscribe : upsert par endpoint, rattaché au trader, au plus 10 appareils', async () => {
    const { service, db } = setup({ devices: [dev('old')] });
    expect(await service.subscribe('u1', SUB, 'Mozilla/5.0 (iPhone) Safari/604.1')).toEqual({ subscribed: true, id: 'd-new' });
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { endpoint: SUB.endpoint }, update: expect.objectContaining({ userId: 'u1' }) }));
    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: MAX_PUSH_DEVICES }));
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['old'] } } });
  });

  it('subscribe sans clés VAPID : 503', async () => {
    const { service } = setup({ config: { enabled: false, reason: 'off' } });
    await expect(service.subscribe('u1', SUB, null)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('suppression depuis le profil : seulement un appareil du trader', async () => {
    const { service, db } = setup();
    await service.removeDevice('u1', 'd1');
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', id: 'd1' } });
    db.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.removeDevice('u1', 'd-autre')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('settings sans réglage : récap coupé, pas d’heures silencieuses, endpoint jamais renvoyé', async () => {
    const { service, db } = setup();
    db.findMany.mockResolvedValueOnce([{ id: 'd1', userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0', createdAt: new Date('2026-10-01T00:00:00Z'), lastSuccessAt: null }]);
    const s = await service.settings('u1');
    expect(s).toMatchObject({ enabled: true, publicKey: 'pub', mutedTypes: ['RECAP'], quietHours: null, timeZone: 'Europe/Paris' });
    expect(s.devices).toEqual([{ id: 'd1', label: 'Chrome · Android', createdAt: '2026-10-01T00:00:00.000Z', lastSuccessAt: null }]);
    expect(JSON.stringify(s)).not.toContain('secret');
  });

  it('préférences : champ absent inchangé, quietHours null = désactivées', async () => {
    const { service, pref } = setup({ devices: [] });
    await service.setPreferences('u1', { mutedTypes: ['BEHAVIOR', 'BEHAVIOR'] });
    expect(pref.upsert).toHaveBeenLastCalledWith({ where: { userId: 'u1' }, create: { userId: 'u1', mutedTypes: ['BEHAVIOR'] }, update: { mutedTypes: ['BEHAVIOR'] } });
    await service.setPreferences('u1', { quietHours: null });
    expect(pref.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { quietStart: null, quietEnd: null } }));
    await service.setPreferences('u1', { quietHours: { start: 1320, end: 420 } });
    expect(pref.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { quietStart: 1320, quietEnd: 420 } }));
  });
});
