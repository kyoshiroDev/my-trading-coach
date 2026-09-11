import { randomBytes } from 'node:crypto';
import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { encryptToken } from '../../../common/utils/token-cipher.util';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateApiError, TradovateException } from './tradovate.errors';

/**
 * Renouvellement du token SANS nouveau consentement (PROMPT-207). Le flux nominal
 * (refresh_token) et l'échec total sont couverts par `tradovate-sync.int-spec.ts` ; ici les
 * branches fines : token encore valide, repli `renewAccessToken`, erreur non-auth remontée telle
 * quelle (sans invalider la connexion).
 */
describe('TradovateConnectionService.getAccessToken', () => {
  const key = randomBytes(32);
  const config = {
    get: (k: string) =>
      ({ BROKER_TOKEN_ENCRYPTION_KEY: key.toString('base64'), JWT_SECRET: 's' })[k],
  };

  function setup(overrides: Partial<BrokerConnection> = {}) {
    const prisma = { brokerConnection: { update: vi.fn().mockResolvedValue({}) } };
    const api = { refresh: vi.fn(), renewAccessToken: vi.fn() };
    const service = new TradovateConnectionService(prisma as never, api as never, config as never);
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
      ...overrides,
    } as BrokerConnection;
    return { service, prisma, api, conn };
  }

  it('token encore valide → aucun appel réseau', async () => {
    const { service, api, conn } = setup();
    await expect(service.getAccessToken(conn)).resolves.toBe('AT-1');
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('proche de l’expiration, refresh refusé → repli renewAccessToken, token stocké chiffré', async () => {
    const { service, api, prisma, conn } = setup({
      accessTokenExpiresAt: new Date(Date.now() + 2 * 60_000), // < marge de 5 min, pas expiré
    });
    api.refresh.mockRejectedValue(new TradovateApiError('unauthorized', 400, 'invalid_grant'));
    api.renewAccessToken.mockResolvedValue({
      accessToken: 'AT-RENEW',
      expirationTime: new Date(Date.now() + 90 * 60_000).toISOString(),
    });

    await expect(service.getAccessToken(conn)).resolves.toBe('AT-RENEW');
    expect(api.renewAccessToken).toHaveBeenCalledWith('AT-1');
    const data = prisma.brokerConnection.update.mock.calls[0][0].data;
    expect(data.accessTokenEnc).not.toContain('AT-RENEW');
  });

  it('Tradovate injoignable pendant le refresh → erreur « injoignable », connexion PAS invalidée', async () => {
    const { service, api, prisma, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
    api.refresh.mockRejectedValue(new TradovateApiError('unavailable', 503, 'oauthtoken'));
    await expect(service.getAccessToken(conn)).rejects.toMatchObject({ code: 'TRADOVATE_UNAVAILABLE' });
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
  });

  it('connexion déjà à reconnecter → erreur immédiate', async () => {
    const { service, conn } = setup({ status: BrokerConnectionStatus.NEEDS_RECONNECT });
    await expect(service.getAccessToken(conn)).rejects.toBeInstanceOf(TradovateException);
  });
});
