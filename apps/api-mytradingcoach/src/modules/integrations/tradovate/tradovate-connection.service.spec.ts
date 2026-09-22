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

  function makeConn(overrides: Partial<BrokerConnection> = {}): BrokerConnection {
    return {
      id: 'c1',
      userId: 'u1',
      accountId: 'a1',
      provider: BrokerProvider.TRADOVATE,
      status: BrokerConnectionStatus.CONNECTED,
      accessTokenEnc: encryptToken('AT-1', key),
      refreshTokenEnc: encryptToken('RT-1', key),
      // 2 h : au-delà de la marge de renouvellement (40 min), donc « encore valide ».
      accessTokenExpiresAt: new Date(Date.now() + 120 * 60_000),
      refreshTokenExpiresAt: null,
      ...overrides,
    } as BrokerConnection;
  }

  function setup(overrides: Partial<BrokerConnection> = {}) {
    const conn = makeConn(overrides);
    const prisma = {
      brokerConnection: {
        update: vi.fn().mockResolvedValue({}),
        // Le réessai relit la connexion : par défaut, rien n'a bougé en base.
        findUnique: vi.fn().mockResolvedValue(conn),
      },
    };
    const api = { refresh: vi.fn(), renewAccessToken: vi.fn() };
    const redis = { client: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn() } };
    const service = new TradovateConnectionService(prisma as never, api as never, config as never, redis as never);
    // Le délai entre les deux tentatives est réel en prod (2 s) ; inutile de le subir ici.
    vi.spyOn(service as unknown as { wait: (ms: number) => Promise<void> }, 'wait')
      .mockResolvedValue(undefined);
    return { service, prisma, api, conn, key };
  }

  const refusé = () => new TradovateApiError('unauthorized', 200, 'invalid_token');

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

  // ── Bug prod du 2026-09-21 : 4 comptes de Val condamnés sur un refus UNIQUE ──────────
  // Tradovate répond « HTTP 200 invalid_token » sur un refresh_token jamais utilisé, émis 2 h
  // plus tôt, qu'il déclare lui-même valide 26 h. Ce refus n'est pas la preuve d'un token mort.
  describe('résilience du refresh (bug prod 2026-09-21)', () => {
    it('refusé une fois puis accepté → connexion préservée, pas de NEEDS_RECONNECT', async () => {
      const { service, api, prisma, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
      api.refresh
        .mockRejectedValueOnce(refusé())
        .mockResolvedValueOnce({ access_token: 'AT-2', expires_in: 4800, refresh_token: 'RT-2' });

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-2');
      expect(api.refresh).toHaveBeenCalledTimes(2);
      const statuts = prisma.brokerConnection.update.mock.calls.map((c) => c[0].data.status);
      expect(statuts).not.toContain('NEEDS_RECONNECT');
    });

    it('refusé deux fois mais access token encore vivant → repli renew, connexion préservée', async () => {
      // Exactement ce que la marge de 40 min garantit : le refus arrive AVANT l'expiration.
      const { service, api, prisma, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() + 20 * 60_000) });
      api.refresh.mockRejectedValue(refusé());
      api.renewAccessToken.mockResolvedValue({
        accessToken: 'AT-RENEW',
        expirationTime: new Date(Date.now() + 80 * 60_000).toISOString(),
      });

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-RENEW');
      const statuts = prisma.brokerConnection.update.mock.calls.map((c) => c[0].data.status);
      expect(statuts).not.toContain('NEEDS_RECONNECT');
    });

    it('refusé deux fois ET renew refusé → seul cas de NEEDS_RECONNECT', async () => {
      const { service, api, prisma, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() + 20 * 60_000) });
      api.refresh.mockRejectedValue(refusé());
      api.renewAccessToken.mockRejectedValue(refusé());

      await expect(service.getAccessToken(conn)).rejects.toMatchObject({
        code: 'TRADOVATE_RECONNECT_REQUIRED',
      });
      const statuts = prisma.brokerConnection.update.mock.calls.map((c) => c[0].data.status);
      expect(statuts).toContain('NEEDS_RECONNECT');
    });

    it('un autre worker a renouvelé pendant l’attente → on prend SON token, sans rappeler Tradovate', async () => {
      const { service, api, prisma, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
      api.refresh.mockRejectedValue(refusé());
      // Relecture : la base porte déjà un access token frais, posé par un autre worker du cluster.
      prisma.brokerConnection.findUnique.mockResolvedValue(
        makeConn({
          accessTokenEnc: encryptToken('AT-AUTRE-WORKER', key),
          accessTokenExpiresAt: new Date(Date.now() + 75 * 60_000),
        }),
      );

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-AUTRE-WORKER');
      expect(api.refresh).toHaveBeenCalledTimes(1); // pas de 2e appel : inutile
    });

    it('marge de 40 min : un token qui expire dans 30 min est renouvelé AVANT sa mort', async () => {
      // Avec l'ancienne marge de 5 min, ce token était rendu tel quel et mourait entre deux
      // passages du cron de fond (30 min) — le refresh n'était alors tenté qu'une fois trop tard.
      const { service, api, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() + 30 * 60_000) });
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800 });

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-2');
      expect(api.refresh).toHaveBeenCalledTimes(1);
    });

    it('refreshTokenExpiresAt dépassé : on tente quand même, Tradovate tranche', async () => {
      // La date annoncée par Tradovate n'est pas une autorité : elle l'a refusé 24 h trop tôt en
      // prod, elle peut aussi l'accepter passé l'échéance. On ne décide plus à sa place.
      const { service, api, conn } = setup({
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: new Date(Date.now() - 3600_000),
      });
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800 });

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-2');
      expect(api.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('Tradovate injoignable pendant le refresh → erreur « injoignable », connexion PAS invalidée', async () => {
    const { service, api, prisma, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
    api.refresh.mockRejectedValue(new TradovateApiError('unavailable', 503, 'oauthtoken'));
    await expect(service.getAccessToken(conn)).rejects.toMatchObject({ code: 'TRADOVATE_UNAVAILABLE' });
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
  });

  describe('refreshNow (cron de maintien)', () => {
    it('renouvelle par refresh_token : nouveaux tokens chiffrés persistés', async () => {
      const { service, api, prisma, conn } = setup();
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800, refresh_token: 'RT-2', refresh_token_expires_in: 93600 });
      await expect(service.refreshNow(conn)).resolves.toBe('refreshed');
      const data = prisma.brokerConnection.update.mock.calls[0][0].data;
      expect(data.refreshTokenEnc).not.toContain('RT-2');
      expect(data.refreshTokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 25 * 3600_000);
    });

    it('refusé DEUX fois et aucun repli possible → à reconnecter', async () => {
      // Access token déjà mort : `renewAccessToken` n'est pas jouable, plus aucun filet.
      const { service, api, prisma, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
      api.refresh.mockRejectedValue(refusé());
      await expect(service.refreshNow(conn)).resolves.toBe('reconnect');
      expect(api.refresh).toHaveBeenCalledTimes(2);
      expect(prisma.brokerConnection.update.mock.calls[0][0].data.status).toBe('NEEDS_RECONNECT');
    });

    it('refusé une fois puis accepté → renouvelé, connexion jamais condamnée', async () => {
      const { service, api, prisma, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
      api.refresh
        .mockRejectedValueOnce(refusé())
        .mockResolvedValueOnce({ access_token: 'AT-2', expires_in: 4800, refresh_token: 'RT-2' });
      await expect(service.refreshNow(conn)).resolves.toBe('refreshed');
      const statuts = prisma.brokerConnection.update.mock.calls.map((c) => c[0].data.status);
      expect(statuts).not.toContain('NEEDS_RECONNECT');
    });

    it('Tradovate injoignable → reporté, connexion intacte', async () => {
      const { service, api, prisma, conn } = setup();
      api.refresh.mockRejectedValue(new TradovateApiError('unavailable', 503, 'oauthtoken'));
      await expect(service.refreshNow(conn)).resolves.toBe('retry');
      expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
    });
  });

  it('connexion déjà à reconnecter → erreur immédiate', async () => {
    const { service, conn } = setup({ status: BrokerConnectionStatus.NEEDS_RECONNECT });
    await expect(service.getAccessToken(conn)).rejects.toBeInstanceOf(TradovateException);
  });
});
