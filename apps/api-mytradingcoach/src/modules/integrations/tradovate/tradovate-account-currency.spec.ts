import { randomBytes } from 'node:crypto';
import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { encryptToken } from '../../../common/utils/token-cipher.util';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateApiError } from './tradovate.errors';

/**
 * Devise d'un compte synchronisé (PROMPT-214, corrigé après cartographie de l'API) : elle est LUE
 * chez le broker, jamais devinée. Le piège couvert ici : `cashBalance.currencyId` est un identifiant
 * INTERNE Tradovate (1 = USD, 2 = EUR…), pas un code ISO — seul `/currency/item` donne le code.
 * Et la lecture est best-effort : elle ne doit jamais faire échouer le choix du compte.
 */
describe('TradovateConnectionService — devise lue chez le broker', () => {
  const key = randomBytes(32);
  const config = {
    get: (k: string) =>
      ({ BROKER_TOKEN_ENCRYPTION_KEY: key.toString('base64'), JWT_SECRET: 's' })[k],
  };

  function setup() {
    const conn = {
      id: 'c1',
      userId: 'u1',
      accountId: 'a1',
      provider: BrokerProvider.TRADOVATE,
      status: BrokerConnectionStatus.CONNECTED,
      accessTokenEnc: encryptToken('AT-1', key),
      refreshTokenEnc: encryptToken('RT-1', key),
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
      refreshTokenExpiresAt: null,
      externalAccountId: null,
      externalAccountName: null,
      externalEnv: null,
      availableAccounts: [{ id: '64992914', name: 'TDFY-123', env: 'demo' }],
      lastSyncAt: null,
      lastSyncError: null,
      tradesImported: 0,
      createdAt: new Date(),
    } as unknown as BrokerConnection;

    const prisma = {
      brokerConnection: {
        findFirst: vi.fn().mockResolvedValue(conn),
        // Garde-fou « déjà relié ailleurs » : personne d'autre sur ce compte ici.
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({ ...conn, externalAccountId: '64992914', externalEnv: 'demo' }),
      },
      tradingAccount: { update: vi.fn().mockResolvedValue({}) },
    };
    const api = { get: vi.fn() };
    const redis = { client: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn() } };
    const service = new TradovateConnectionService(
      prisma as never,
      api as never,
      config as never,
      redis as never,
    );
    return { service, prisma, api };
  }

  /** Réponses du broker : le solde porte l'identifiant interne, `/currency/item` porte le code. */
  function brokerAnswers(api: { get: ReturnType<typeof vi.fn> }, currencyId: number, name: string) {
    api.get.mockImplementation((_env: string, path: string) => {
      if (path === '/cashBalance/list') {
        return Promise.resolve([{ id: 1, accountId: 64992914, currencyId }]);
      }
      if (path === '/currency/item') return Promise.resolve({ id: currencyId, name });
      throw new Error(`appel inattendu : ${path}`);
    });
  }

  it('currencyId 2 → EUR : le code vient de /currency/item, pas de l’identifiant', async () => {
    const { service, prisma, api } = setup();
    brokerAnswers(api, 2, 'EUR');

    await service.selectAccount('u1', 'a1', '64992914');

    expect(api.get).toHaveBeenCalledWith('demo', '/currency/item', 'AT-1', { id: '2' });
    expect(prisma.tradingAccount.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { currency: 'EUR' },
    });
  });

  it('currencyId 1 → USD', async () => {
    const { service, prisma, api } = setup();
    brokerAnswers(api, 1, 'USD');

    await service.selectAccount('u1', 'a1', '64992914');

    expect(prisma.tradingAccount.update.mock.calls[0][0].data).toEqual({ currency: 'USD' });
  });

  it('devise hors ACCOUNT_CURRENCIES (CAD) → repli USD, compte quand même sélectionné', async () => {
    const { service, prisma, api } = setup();
    brokerAnswers(api, 5, 'CAD');

    const view = await service.selectAccount('u1', 'a1', '64992914');

    expect(view.externalAccountId).toBe('64992914');
    expect(prisma.tradingAccount.update.mock.calls[0][0].data).toEqual({ currency: 'USD' });
  });

  it('lecture impossible chez le broker → repli USD, aucune exception', async () => {
    const { service, prisma, api } = setup();
    api.get.mockRejectedValue(new TradovateApiError('unavailable', 503, '/cashBalance/list'));

    await expect(service.selectAccount('u1', 'a1', '64992914')).resolves.toMatchObject({
      externalAccountId: '64992914',
    });
    expect(prisma.tradingAccount.update.mock.calls[0][0].data).toEqual({ currency: 'USD' });
  });
});
