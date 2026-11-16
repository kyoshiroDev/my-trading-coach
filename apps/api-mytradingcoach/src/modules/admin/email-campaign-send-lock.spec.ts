/**
 * Verrou d'envoi (doute promu, #1063) : `send` lit `emailSend` (déjà reçu ?) avant d'écrire, et
 * l'envoi est synchrone (150 ms par destinataire). Deux clics, ou une relance après un délai
 * dépassé, envoyaient deux fois le même e-mail à de vrais utilisateurs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { EmailCampaignService } from './email-campaign.service';

function makeService(redis: Record<string, ReturnType<typeof vi.fn>>) {
  const prisma = {
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'a', email: 'a@test.com', name: 'Ana', marketingConsent: true, serviceEmailsOptOutAt: null, unsubToken: 't' }]) },
    emailCampaignLog: { create: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    propFirm: { count: vi.fn().mockResolvedValue(1) },
  };
  const dispatch = { canSend: vi.fn().mockResolvedValue(true), dispatch: vi.fn().mockResolvedValue(true), buildUnsubUrl: vi.fn(() => 'u') };
  const svc = new EmailCampaignService(prisma as never, dispatch as never, {} as never, {} as never, { client: redis } as never);
  return { svc, dispatch };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('envoi de campagne : un seul à la fois par type', () => {
  it('envoi déjà en cours (verrou pris) → 409, aucun e-mail', async () => {
    const { svc, dispatch } = makeService({ get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(null), del: vi.fn() });

    await expect(svc.send('discord_invite', 'admin')).rejects.toBeInstanceOf(ConflictException);
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('verrou libre → pris (SET NX EX), envoi, puis rendu (seulement le sien)', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => (store.has(k) ? null : (store.set(k, v), 'OK'))),
      del: vi.fn(async (k: string) => store.delete(k)),
    };
    const { svc, dispatch } = makeService(redis);

    const p = svc.send('discord_invite', 'admin');
    await vi.runAllTimersAsync();
    await p;

    expect(redis.set).toHaveBeenCalledWith('email-campaign:send:discord_invite', expect.any(String), 'EX', expect.any(Number), 'NX');
    expect(dispatch.dispatch).toHaveBeenCalledOnce();
    expect(store.has('email-campaign:send:discord_invite')).toBe(false);
  });

  it('verrou repris par un autre envoi entre-temps (TTL dépassé) : jamais supprimé par le premier', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => (store.has(k) ? null : (store.set(k, v), 'OK'))),
      del: vi.fn(async (k: string) => store.delete(k)),
    };
    const { svc, dispatch } = makeService(redis);
    dispatch.dispatch.mockImplementationOnce(async () => {
      store.set('email-campaign:send:discord_invite', 'jeton-d-un-autre-envoi');
      return true;
    });

    const p = svc.send('discord_invite', 'admin');
    await vi.runAllTimersAsync();
    await p;

    expect(store.get('email-campaign:send:discord_invite')).toBe('jeton-d-un-autre-envoi');
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('erreur pendant l’envoi : le verrou est rendu (finally)', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => (store.has(k) ? null : (store.set(k, v), 'OK'))),
      del: vi.fn(async (k: string) => store.delete(k)),
    };
    const { svc } = makeService(redis);
    (svc as unknown as { prisma: { user: { findMany: ReturnType<typeof vi.fn> } } }).prisma.user.findMany
      .mockRejectedValueOnce(new Error('base indisponible'));

    await expect(svc.send('discord_invite', 'admin')).rejects.toThrow('base indisponible');
    expect(store.has('email-campaign:send:discord_invite')).toBe(false);
  });
});

