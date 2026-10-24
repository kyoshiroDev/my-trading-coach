import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { AdminPushEvent, BrokerConnectionStatus } from '@prisma/client';
import { TradovateConnectionService } from './tradovate-connection.service';

/**
 * Push admin « Une connexion Tradovate a expiré » : au PASSAGE à « à reconnecter » seulement
 * (pas à chaque nouvel essai d'une connexion déjà condamnée), jamais pour un compte démo.
 */
function setup(before: unknown) {
  const key = randomBytes(32);
  const config = { get: (k: string) => ({ BROKER_TOKEN_ENCRYPTION_KEY: key.toString('base64'), JWT_SECRET: 's' })[k] };
  const prisma = {
    brokerConnection: {
      findUnique: vi.fn().mockResolvedValue(before),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const redis = { client: { set: vi.fn(), del: vi.fn(), exists: vi.fn(), get: vi.fn() } };
  const notifier = { notify: vi.fn() };
  const trader = { notify: vi.fn() };
  const service = new TradovateConnectionService(prisma as never, {} as never, config as never, redis as never, notifier as never, trader as never);
  return { service, prisma, notifier, trader };
}

describe('markNeedsReconnect → push admin', () => {
  it('CONNECTED → à reconnecter : statut écrit et un push TRADOVATE_RECONNECT', async () => {
    const { service, prisma, notifier } = setup({
      status: BrokerConnectionStatus.CONNECTED, userId: 'u1', accountId: 'acc-1', account: { label: 'Apex 50K' }, user: { isDemo: false },
    });
    await service.markNeedsReconnect('c1', 'test');
    expect(prisma.brokerConnection.update.mock.calls[0][0].data.status).toBe(BrokerConnectionStatus.NEEDS_RECONNECT);
    expect(notifier.notify).toHaveBeenCalledWith(
      AdminPushEvent.TRADOVATE_RECONNECT,
      expect.objectContaining({ title: 'Une connexion Tradovate a expiré', url: '/brokers' }),
    );
  });

  it('déjà « à reconnecter » → pas de nouveau push', async () => {
    const { service, notifier } = setup({ status: BrokerConnectionStatus.NEEDS_RECONNECT, user: { isDemo: false } });
    await service.markNeedsReconnect('c1', 'cron');
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('compte démo → pas de push', async () => {
    const { service, notifier } = setup({ status: BrokerConnectionStatus.CONNECTED, user: { isDemo: true } });
    await service.markNeedsReconnect('c1', 'test');
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('lecture de l’état d’avant en échec → le statut est quand même écrit, sans push', async () => {
    const { service, prisma, notifier } = setup(null);
    prisma.brokerConnection.findUnique.mockRejectedValue(new Error('base lente'));
    await service.markNeedsReconnect('c1', 'test');
    expect(prisma.brokerConnection.update).toHaveBeenCalledOnce();
    expect(notifier.notify).not.toHaveBeenCalled();
  });
});

describe('markNeedsReconnect → push au trader (#666)', () => {
  const before = { status: BrokerConnectionStatus.CONNECTED, userId: 'u1', accountId: 'acc-1', account: { label: 'Apex 50K' } };

  it('au passage à « à reconnecter » : type Connexion (gratuit), lien vers Comptes, sans montant', async () => {
    const { service, trader } = setup({ ...before, user: { isDemo: false } });
    await service.markNeedsReconnect('c1', 'test');
    expect(trader.notify).toHaveBeenCalledWith(
      'u1',
      'CONNECTION',
      expect.objectContaining({ title: 'Connexion Tradovate à renouveler', url: '/accounts', body: 'Synchro interrompue pour {compte} : reconnecte-le depuis Comptes.' }),
      { accountId: 'acc-1', dedupKey: 'connection:tradovate' },
    );
  });

  it('déjà « à reconnecter » ou compte démo : rien', async () => {
    for (const b of [
      { ...before, status: BrokerConnectionStatus.NEEDS_RECONNECT, user: { isDemo: false } },
      { ...before, user: { isDemo: true } },
    ]) {
      const { service, trader } = setup(b);
      await service.markNeedsReconnect('c1', 'test');
      expect(trader.notify).not.toHaveBeenCalled();
    }
  });
});
