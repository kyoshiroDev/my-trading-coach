import { createHash, randomBytes } from 'node:crypto';
import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { encryptToken } from '@api/common/utils/token-cipher.util';
import { ACCOUNT_GONE_GRACE_MS, TradovateConnectionService } from './tradovate-connection.service';
import { TradovateApiError, TradovateException } from './tradovate.errors';

/**
 * Renouvellement du token SANS nouveau consentement. Le flux nominal
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
      // Hôtes lus à l'instant : pas de relecture `apiHosts` (testée à part).
      apiHostsAt: new Date(),
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
        // Propagation aux connexions sœurs du même login.
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const api = { refresh: vi.fn(), renewAccessToken: vi.fn(), get: vi.fn() };
    const redis = {
      client: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn(), exists: vi.fn().mockResolvedValue(0), get: vi.fn().mockResolvedValue(null) },
    };
    const service = new TradovateConnectionService(prisma as never, api as never, config as never, redis as never);
    // Le délai entre les deux tentatives est réel en prod (2 s) ; inutile de le subir ici.
    vi.spyOn(service as unknown as { wait: (ms: number) => Promise<void> }, 'wait')
      .mockResolvedValue(undefined);
    return { service, prisma, api, conn, key, redis };
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
      // 1re lecture (sous verrou) : rien n'a bougé. 2e (après l'attente) : la base porte un access
      // token frais, posé par un autre worker du cluster.
      prisma.brokerConnection.findUnique.mockResolvedValueOnce(conn).mockResolvedValue(
        makeConn({
          accessTokenEnc: encryptToken('AT-AUTRE-WORKER', key),
          accessTokenExpiresAt: new Date(Date.now() + 75 * 60_000),
        }),
      );

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-AUTRE-WORKER');
      expect(api.refresh).toHaveBeenCalledTimes(1); // pas de 2e appel : inutile
    });

    it('objet périmé (lu avant une rotation) → token relu en base, AUCUN refresh présenté (prod 2026-10-05)', async () => {
      // `refreshClosings` repassait l'objet lu au début de la synchro : ancienne échéance, ancien
      // refresh_token. Le présenter, déjà remplacé, se fait refuser — et coûte le token neuf.
      const { service, api, prisma, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
      prisma.brokerConnection.findUnique.mockResolvedValue(
        makeConn({
          accessTokenEnc: encryptToken('AT-APRES-ROTATION', key),
          refreshTokenEnc: encryptToken('RT-2', key),
          accessTokenExpiresAt: new Date(Date.now() + 80 * 60_000),
        }),
      );

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-APRES-ROTATION');
      expect(api.refresh).not.toHaveBeenCalled();
    });

    it('relecture inchangée sauf le refresh_token → c’est le refresh_token RELU qui est présenté', async () => {
      const { service, api, prisma, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
      prisma.brokerConnection.findUnique.mockResolvedValue(
        makeConn({ refreshTokenEnc: encryptToken('RT-RELU', key), accessTokenExpiresAt: new Date(Date.now() - 1000) }),
      );
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800, refresh_token: 'RT-3' });

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-2');
      expect(api.refresh).toHaveBeenCalledWith('RT-RELU');
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

  // ── Connexions sœurs d'un même login Tradovate (bug prod 21-23/09) ─────────────────────
  // Tradovate fait tourner le refresh_token par LOGIN. Un login = plusieurs comptes = plusieurs
  // connexions MTC, chacune avec sa copie : la première qui renouvelle invalide celle des autres.
  //
  // « Login » = l'utilisateur Tradovate AUTHENTIFIÉ (`/user/list`), d'où les ids de trader ci-dessous.
  // Jamais `account.userId`, qui est le propriétaire du compte — la firme sur un compte prop firm,
  // donc partagé par tous ses traders : cf. `tradovate-login-identity.spec.ts`.
  describe('portée login', () => {
    it('le renouvellement propage les nouveaux tokens aux connexions sœurs et les ressuscite', async () => {
      const { service, prisma, api, conn } = setup({
        externalUserId: '5751613',
        accessTokenExpiresAt: new Date(Date.now() - 1000),
      });
      prisma.brokerConnection.updateMany.mockResolvedValue({ count: 2 });
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800, refresh_token: 'RT-2' });

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-2');

      const [args] = prisma.brokerConnection.updateMany.mock.calls[0];
      expect(args.where).toMatchObject({ externalUserId: '5751613', userId: 'u1', id: { not: 'c1' } });
      // Une sœur condamnée par une rotation concurrente l'avait été à tort : le login répond.
      expect(args.data.status).toBe('CONNECTED');
      expect(args.data.lastSyncError).toBeNull();
      expect(args.data.accessTokenEnc).not.toContain('AT-2'); // toujours chiffré
    });

    it('sans login connu, aucune propagation : on ne devine pas qui est sœur de qui', async () => {
      const { service, prisma, api, conn } = setup({
        externalUserId: null,
        accessTokenExpiresAt: new Date(Date.now() - 1000),
      });
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800 });

      await service.getAccessToken(conn);
      expect(prisma.brokerConnection.updateMany).not.toHaveBeenCalled();
    });

    it('verrou pris par une sœur → on attend son token au lieu de rejouer le refresh', async () => {
      const { service, prisma, api, conn, key } = setup({
        externalUserId: '5751613',
        accessTokenExpiresAt: new Date(Date.now() - 1000),
      });
      const redis = (service as unknown as { redis: { client: { set: ReturnType<typeof vi.fn> } } }).redis;
      redis.client.set.mockResolvedValue(null); // verrou déjà détenu par la connexion sœur
      prisma.brokerConnection.findUnique.mockResolvedValue(
        makeConn({
          accessTokenEnc: encryptToken('AT-SOEUR', key),
          accessTokenExpiresAt: new Date(Date.now() + 75 * 60_000),
        }),
      );

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-SOEUR');
      expect(api.refresh).not.toHaveBeenCalled(); // aucun appel à Tradovate : inutile
    });

    it('verrou pris mais la sœur n’a rien donné → on tente quand même, jamais bloqué', async () => {
      const { service, prisma, api, conn } = setup({
        externalUserId: '5751613',
        accessTokenExpiresAt: new Date(Date.now() - 1000),
      });
      const redis = (service as unknown as { redis: { client: { set: ReturnType<typeof vi.fn> } } }).redis;
      redis.client.set.mockResolvedValue(null);
      prisma.brokerConnection.findUnique.mockResolvedValue(makeConn({ accessTokenExpiresAt: new Date(Date.now() - 1000) }));
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800 });

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-2');
      expect(api.refresh).toHaveBeenCalled();
    });

    it('rattrapage : atteint AUSSI les connexions sœurs déjà mortes', async () => {
      // Elles ne se synchronisent plus (le cron ignore NEEDS_RECONNECT) : sans ce rattrapage par
      // liste de comptes du login, elles resteraient orphelines et jamais ressuscitées.
      const { service, prisma, conn } = setup({ externalUserId: null, externalAccountId: '40517838' });
      prisma.brokerConnection.updateMany.mockResolvedValue({ count: 2 });

      await service.rememberLogin(conn, 5751613, ['40517838', '40570856']);

      const [args] = prisma.brokerConnection.updateMany.mock.calls[0];
      expect(args.where).toMatchObject({
        userId: 'u1',
        externalUserId: null,
        externalAccountId: { in: ['40517838', '40570856'] },
      });
      expect(args.data).toEqual({ externalUserId: '5751613' });
    });

    it('rattrapage : ne touche que les connexions sans login (les autres gardent le leur)', async () => {
      const { service, prisma, conn } = setup({ externalUserId: '5751613' });
      await service.rememberLogin(conn, 5751613, ['40517838']);
      // Le filtre `externalUserId: null` protège les connexions déjà rattachées.
      expect(prisma.brokerConnection.updateMany.mock.calls[0][0].where.externalUserId).toBeNull();
    });

    it('le verrou porte sur le LOGIN, pas sur la connexion', async () => {
      const { service, api, conn } = setup({ externalUserId: '5751613', accessTokenExpiresAt: new Date(Date.now() - 1000) });
      const redis = (service as unknown as { redis: { client: { set: ReturnType<typeof vi.fn> } } }).redis;
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800 });

      await service.getAccessToken(conn);
      expect(redis.client.set).toHaveBeenCalledWith('tradovate:login:5751613', '1', 'EX', 30, 'NX');
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

  // ── refresh_token mort mais renew vivant (prod 2026-10-05 : 42 refus en 7 h sur 4 connexions) ──
  // `renew` ne fait pas tourner le refresh_token : sans marqueur, le même token mort repartait
  // deux fois à chaque passage des crons.
  describe('refresh_token connu mort : plus représenté à chaque passage', () => {
    const empreinte = (c: BrokerConnection) =>
      createHash('sha256').update(c.refreshTokenEnc as string).digest('hex').slice(0, 16);
    const renewOk = () => ({ accessToken: 'AT-RENEW', expirationTime: new Date(Date.now() + 80 * 60_000).toISOString() });

    it('refusé deux fois puis renew réussi → marqueur posé 6 h sur CE refresh_token', async () => {
      const { service, api, redis, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() + 20 * 60_000) });
      api.refresh.mockRejectedValue(refusé());
      api.renewAccessToken.mockResolvedValue(renewOk());

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-RENEW');
      expect(redis.client.set).toHaveBeenCalledWith('tradovate:refresh-dead:c1', empreinte(conn), 'EX', 6 * 3600);
    });

    it('marqueur présent → renew direct, AUCUN appel au refresh', async () => {
      const { service, api, redis, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() + 20 * 60_000) });
      redis.client.get.mockResolvedValue(empreinte(conn));
      api.renewAccessToken.mockResolvedValue(renewOk());

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-RENEW');
      expect(api.refresh).not.toHaveBeenCalled();
    });

    it('nouveau refresh_token stocké depuis (sœur, reconnexion) → le marqueur ne s’applique plus', async () => {
      const { service, api, redis, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() + 20 * 60_000) });
      redis.client.get.mockResolvedValue('empreinte-d-un-autre-token');
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800, refresh_token: 'RT-2' });

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-2');
      expect(api.renewAccessToken).not.toHaveBeenCalled();
    });

    it('marqueur présent mais renew refusé → refresh tenté en dernier recours', async () => {
      const { service, api, redis, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() + 20 * 60_000) });
      redis.client.get.mockResolvedValue(empreinte(conn));
      api.renewAccessToken.mockRejectedValue(refusé());
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800, refresh_token: 'RT-2' });

      await expect(service.getAccessToken(conn)).resolves.toBe('AT-2');
    });

    it('cron : refresh refusé, renew réussi → « renewed », pas « refreshed »', async () => {
      const { service, api, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() + 20 * 60_000) });
      api.refresh.mockRejectedValue(refusé());
      api.renewAccessToken.mockResolvedValue(renewOk());
      await expect(service.refreshNow(conn)).resolves.toBe('renewed');
    });

    it('cron : marqueur présent → « renewed » sans appel au refresh', async () => {
      const { service, api, redis, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() + 20 * 60_000) });
      redis.client.get.mockResolvedValue(empreinte(conn));
      api.renewAccessToken.mockResolvedValue(renewOk());
      await expect(service.refreshNow(conn)).resolves.toBe('renewed');
      expect(api.refresh).not.toHaveBeenCalled();
    });

    it('cron sur un access token encore frais : rien en base n’a bougé → pas de faux « renouvelé ailleurs »', async () => {
      // Le cron choisit sur l'échéance du refresh_token : l'access token peut avoir 2 h devant lui.
      const { service, api, conn } = setup();
      api.refresh.mockRejectedValue(refusé());
      api.renewAccessToken.mockResolvedValue(renewOk());

      await expect(service.refreshNow(conn)).resolves.toBe('renewed');
      expect(api.refresh).toHaveBeenCalledTimes(2); // la relecture n'a pas court-circuité le réessai
    });
  });

  it('connexion déjà à reconnecter → erreur immédiate', async () => {
    const { service, conn } = setup({ status: BrokerConnectionStatus.NEEDS_RECONNECT });
    await expect(service.getAccessToken(conn)).rejects.toBeInstanceOf(TradovateException);
  });

  // ── « Connecté tant qu'il ne clique pas sur Déconnecter » (bug prod 2026-09-26) ──────────
  describe('refus passager : la connexion n’est condamnée qu’à l’échéance annoncée', () => {
    const vivantJusquA = () => new Date(Date.now() + 10 * 3600_000);

    it('refusé deux fois, renew impossible, refresh_token encore annoncé valide → gardée, erreur passagère', async () => {
      const { service, api, prisma, conn } = setup({
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: vivantJusquA(),
      });
      api.refresh.mockRejectedValue(refusé());

      await expect(service.getAccessToken(conn)).rejects.toMatchObject({ code: 'TRADOVATE_REFRESH_DEFERRED' });
      const statuts = prisma.brokerConnection.update.mock.calls.map((c) => c[0].data.status);
      expect(statuts).not.toContain('NEEDS_RECONNECT');
    });

    it('cron : même cas → « retry », jamais « reconnect »', async () => {
      const { service, api, prisma, conn } = setup({
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: vivantJusquA(),
      });
      api.refresh.mockRejectedValue(refusé());
      await expect(service.refreshNow(conn)).resolves.toBe('retry');
      expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
    });

    it('refresh_token échu et refusé → là seulement, à reconnecter', async () => {
      const { service, api, prisma, conn } = setup({
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: new Date(Date.now() - 1000),
      });
      api.refresh.mockRejectedValue(refusé());
      await expect(service.getAccessToken(conn)).rejects.toMatchObject({ code: 'TRADOVATE_RECONNECT_REQUIRED' });
      expect(prisma.brokerConnection.update.mock.calls[0][0].data.status).toBe('NEEDS_RECONNECT');
    });
  });

  describe('pause après un refus passager (boucle du WebSocket, beta 2026-09-26)', () => {
    const redisOf = (service: TradovateConnectionService) =>
      (service as unknown as { redis: { client: Record<string, ReturnType<typeof vi.fn>> } }).redis.client;

    it('un refus passager pose une pause de 10 min', async () => {
      const { service, api, conn } = setup({
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: new Date(Date.now() + 3600_000),
      });
      api.refresh.mockRejectedValue(refusé());
      await expect(service.getAccessToken(conn)).rejects.toMatchObject({ code: 'TRADOVATE_REFRESH_DEFERRED' });
      expect(redisOf(service).set).toHaveBeenCalledWith('tradovate:refresh-refused:c1', '1', 'EX', 600);
    });

    it('pendant la pause : aucun appel à Tradovate, ni synchro/WebSocket ni cron', async () => {
      const { service, api, conn } = setup({
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: new Date(Date.now() + 3600_000),
      });
      redisOf(service).exists.mockResolvedValue(1);
      await expect(service.getAccessToken(conn)).rejects.toMatchObject({ code: 'TRADOVATE_REFRESH_DEFERRED' });
      await expect(service.refreshNow(conn)).resolves.toBe('retry');
      expect(api.refresh).not.toHaveBeenCalled();
    });

    it('refresh_token échu : la pause ne masque jamais la condamnation', async () => {
      const { service, api, conn } = setup({
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: new Date(Date.now() - 1000),
      });
      redisOf(service).exists.mockResolvedValue(1);
      api.refresh.mockRejectedValue(refusé());
      await expect(service.getAccessToken(conn)).rejects.toMatchObject({ code: 'TRADOVATE_RECONNECT_REQUIRED' });
    });

    it('un renouvellement réussi lève la pause', async () => {
      const { service, api, conn } = setup({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800 });
      await service.getAccessToken(conn);
      expect(redisOf(service).del).toHaveBeenCalledWith('tradovate:refresh-refused:c1');
    });
  });

  describe('tryRevive (seconde chance du cron)', () => {
    it('connexion condamnée à tort, Tradovate accepte → CONNECTED, erreur effacée', async () => {
      const { service, api, prisma, conn } = setup({
        status: BrokerConnectionStatus.NEEDS_RECONNECT,
        refreshTokenExpiresAt: new Date(Date.now() + 3600_000),
      });
      api.refresh.mockResolvedValue({ access_token: 'AT-2', expires_in: 4800, refresh_token: 'RT-2' });

      await expect(service.tryRevive(conn)).resolves.toBe(true);
      const last = prisma.brokerConnection.update.mock.calls.at(-1)?.[0].data;
      expect(last).toEqual({ status: 'CONNECTED', lastSyncError: null });
    });

    it('toujours refusée → reste à reconnecter, sans lever', async () => {
      const { service, api, prisma, conn } = setup({
        status: BrokerConnectionStatus.NEEDS_RECONNECT,
        refreshTokenExpiresAt: new Date(Date.now() + 3600_000),
      });
      api.refresh.mockRejectedValue(refusé());
      await expect(service.tryRevive(conn)).resolves.toBe(false);
      expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
    });

    it('refresh_token échu → on ne tente même pas', async () => {
      const { service, api, conn } = setup({
        status: BrokerConnectionStatus.NEEDS_RECONNECT,
        refreshTokenExpiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.tryRevive(conn)).resolves.toBe(false);
      expect(api.refresh).not.toHaveBeenCalled();
    });
  });

  describe('handleMissingAccount (compte absent de /account/list)', () => {
    const compte = (id: number, name: string) => ({ id, name, userId: 42, closed: false });

    function listes(api: { get: ReturnType<typeof vi.fn> }, live: unknown[], demo: unknown[]) {
      api.get.mockImplementation(async (env: string) => (env === 'live' ? live : demo));
    }

    it('compte passé sur l’autre hôte → externalEnv corrigé, pas d’erreur', async () => {
      const { service, api, prisma, conn } = setup({ externalAccountId: '66948823', externalEnv: 'demo' });
      listes(api, [compte(66948823, 'FTD')], []);
      prisma.brokerConnection.update.mockResolvedValue(makeConn({ externalEnv: 'live' }));

      await expect(service.handleMissingAccount(conn, 'AT')).resolves.toMatchObject({ externalEnv: 'live' });
      expect(prisma.brokerConnection.update.mock.calls[0][0].data.externalEnv).toBe('live');
    });

    it('absent depuis peu → trou passager, rien de détaché', async () => {
      const { service, api, prisma, conn } = setup({
        externalAccountId: '66948823',
        externalEnv: 'demo',
        lastSyncAt: new Date(Date.now() - 30 * 60_000),
      });
      listes(api, [], [compte(66430016, 'PTLOP')]);

      await expect(service.handleMissingAccount(conn, 'AT')).rejects.toMatchObject({
        code: 'TRADOVATE_ACCOUNT_TEMPORARILY_MISSING',
      });
      expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
    });

    it('absent durablement → détaché, comptes du login relus, statut CONNECTED conservé', async () => {
      const { service, api, prisma, conn } = setup({
        externalAccountId: '66948823',
        externalAccountName: 'FTD',
        externalEnv: 'demo',
        lastSyncAt: new Date(Date.now() - ACCOUNT_GONE_GRACE_MS - 60_000),
      });
      listes(api, [], [compte(66430016, 'PTLOP')]);

      await expect(service.handleMissingAccount(conn, 'AT')).rejects.toMatchObject({
        code: 'TRADOVATE_ACCOUNT_NOT_FOUND',
      });
      const data = prisma.brokerConnection.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ externalAccountId: null, externalEnv: null });
      expect(data.availableAccounts).toEqual([{ id: '66430016', name: 'PTLOP', env: 'demo', userId: '42' }]);
      expect(data.status).toBeUndefined(); // jamais « à reconnecter » : le token marche
    });

    it('détachée avec un seul compte restant → le choix est quand même demandé', () => {
      const { service } = setup();
      const view = (service as unknown as { toView: (c: BrokerConnection) => { needsAccountSelection: boolean } }).toView(
        makeConn({ externalAccountId: null, availableAccounts: [{ id: '1', name: 'X', env: 'demo' }] as never }),
      );
      expect(view.needsAccountSelection).toBe(true);
    });
  });
});
