import { randomBytes } from 'node:crypto';
import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { encryptToken } from '../../../common/utils/token-cipher.util';
import { TradovateConnectionService } from './tradovate-connection.service';
import { signOAuthState } from './oauth-state.util';
import { TradovateApiError } from './tradovate.errors';

/**
 * Qui est « le login » d'une connexion Tradovate.
 *
 * On stockait `account.userId` — le **propriétaire du compte chez le broker**. Sur un compte prop
 * firm, c'est l'identifiant de la FIRME, pas du trader. Mesuré en prod le 2026-09-27 : deux
 * traders Apex sans aucun lien entre eux, `APEX_13679` (compte `PAAPEX136790000010`) et
 * `APEX_428047` (compte `APEX4280470000012`), portaient tous les deux `userId: 699523`, et
 * `/user/item?id=699523` répondait 404 — la preuve que ce n'est pas un trader.
 *
 * Conséquence du bug : le verrou de renouvellement `tradovate:login:699523` était partagé par TOUS
 * les traders Apex de la plateforme, et « connexions sœurs » voulait dire « comptes chez la même
 * firme ». Le login correct est l'utilisateur AUTHENTIFIÉ, rendu par `/user/list`.
 */
describe('Login d’une connexion Tradovate = l’utilisateur authentifié', () => {
  const key = randomBytes(32);
  const SECRET = 'secret-de-test';
  const config = {
    get: (k: string) =>
      ({ BROKER_TOKEN_ENCRYPTION_KEY: key.toString('base64'), JWT_SECRET: SECRET })[k],
  };

  /** Ce que Tradovate renvoie réellement pour un trader Apex (relevé du 2026-09-27). */
  const COMPTES_APEX = [
    { id: 40517838, name: 'PAAPEX136790000010', userId: 699523 }, // 699523 = Apex, pas le trader
    { id: 40570856, name: 'PAAPEX136790000011', userId: 699523 },
  ];
  const TRADER = [
    { id: 5751613, name: 'APEX_13679', email: 'trader@example.com', organizationId: 20 },
  ];

  function setup(
    reponses: { comptes?: unknown; users?: unknown | Error; dejaRelies?: string[] } = {},
  ) {
    const enregistre: Record<string, unknown>[] = [];
    const prisma = {
      tradingAccount: {
        findFirst: vi.fn().mockResolvedValue({ id: 'a1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      brokerConnection: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        // Connexions d'AUTRES utilisateurs MTC sur ces comptes broker.
        findMany: vi.fn().mockResolvedValue(
          (reponses.dejaRelies ?? []).map((id) => ({ externalAccountId: id })),
        ),
        upsert: vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => {
          enregistre.push(create);
          return Promise.resolve({ id: 'c1', ...create } as BrokerConnection);
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const api = {
      isConfigured: vi.fn().mockReturnValue(true),
      exchangeCode: vi.fn().mockResolvedValue({
        access_token: 'AT-1',
        refresh_token: 'RT-1',
        expires_in: 3600,
      }),
      get: vi.fn().mockImplementation((env: string, path: string) => {
        // `discoverAccounts` interroge les DEUX hôtes : sans ce filtre, chaque compte compterait
        // deux fois et le choix automatique du compte unique ne se déclencherait jamais.
        if (path === '/account/list') {
          return Promise.resolve(env === 'demo' ? (reponses.comptes ?? COMPTES_APEX) : []);
        }
        if (path === '/user/list') {
          const u = reponses.users ?? TRADER;
          return u instanceof Error ? Promise.reject(u) : Promise.resolve(u);
        }
        return Promise.resolve([]); // cashBalance, currency… : hors sujet ici
      }),
    };
    const redis = { client: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn() } };
    const service = new TradovateConnectionService(
      prisma as never, api as never, config as never, redis as never,
    );
    const state = signOAuthState({ userId: 'u1', accountId: 'a1', origin: 'settings' }, SECRET);
    const connecter = () => service.completeAuthorization({ code: 'CODE', state }, state);
    return { service, prisma, api, connecter, enregistre };
  }

  it('stocke le trader authentifié, pas le propriétaire du compte', async () => {
    const { connecter, enregistre, api } = setup();

    await connecter();

    // 5751613 = le trader. 699523 = Apex, et l'écrire remettrait tous ses traders sur un verrou.
    expect(enregistre[0].externalUserId).toBe('5751613');
    expect(enregistre[0].externalUserId).not.toBe('699523');
    expect(api.get).toHaveBeenCalledWith(expect.any(String), '/user/list', 'AT-1');
  });

  it('`/user/list` en échec → connexion créée quand même, sans login', async () => {
    // Dégradé assumé : verrou par connexion et aucune propagation. Jamais un échec de connexion.
    const { connecter, enregistre } = setup({ users: new TradovateApiError('unavailable', 500, 'user/list') });

    await expect(connecter()).resolves.toMatchObject({ status: 'select_account' });

    expect(enregistre[0].externalUserId).toBeNull();
  });

  it('`/user/list` vide → aucun login inventé', async () => {
    const { connecter, enregistre } = setup({ users: [] });
    await connecter();
    expect(enregistre[0].externalUserId).toBeNull();
  });

  it('choisir un autre compte ne retouche PAS le login', async () => {
    // Changer de compte ne change pas l'utilisateur authentifié. Écrire `target.userId` ici
    // écraserait le bon login par l'identifiant de la firme — c'était le second foyer du bug.
    const conn = {
      id: 'c1', userId: 'u1', accountId: 'a1',
      provider: BrokerProvider.TRADOVATE, status: BrokerConnectionStatus.CONNECTED,
      accessTokenEnc: encryptToken('AT-1', key), refreshTokenEnc: encryptToken('RT-1', key),
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000), refreshTokenExpiresAt: null,
      externalUserId: '5751613',
      availableAccounts: [{ id: '40570856', name: 'PAAPEX136790000011', env: 'demo', userId: '699523' }],
    } as unknown as BrokerConnection;
    const prisma = {
      brokerConnection: {
        findFirst: vi.fn().mockResolvedValue(conn),
        findMany: vi.fn().mockResolvedValue([]), // aucun autre utilisateur sur ce compte
        update: vi.fn().mockResolvedValue({ ...conn, externalAccountId: '40570856' }),
      },
      tradingAccount: { update: vi.fn().mockResolvedValue({}) },
    };
    const api = { get: vi.fn().mockResolvedValue([]) };
    const redis = { client: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn() } };
    const service = new TradovateConnectionService(
      prisma as never, api as never, config as never, redis as never,
    );

    await service.selectAccount('u1', 'a1', '40570856');

    const data = prisma.brokerConnection.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('externalUserId');
    expect(data.externalAccountId).toBe('40570856');
  });
});

/**
 * Garde-fou : un compte broker ne peut être relié qu'à UN seul compte MyTradingCoach.
 *
 * Deux connexions sur le même compte Tradovate se volent leur jeton — renouveler invalide la copie
 * de l'autre — et `propagateToSiblings` est scopé au `userId` MTC, donc il ne peut pas réparer entre
 * deux utilisateurs. Constaté en vrai le 2026-09-27 : un compte relié par deux comptes MTC, l'un
 * vivant, l'autre définitivement « à reconnecter ».
 */
describe('Un compte Tradovate ne se relie qu’à un seul compte MTC', () => {
  const key = randomBytes(32);
  const SECRET = 'secret-de-test';
  const config = {
    get: (k: string) =>
      ({ BROKER_TOKEN_ENCRYPTION_KEY: key.toString('base64'), JWT_SECRET: SECRET })[k],
  };

  function contexte(opts: { comptes: { id: number; name: string }[]; pris: string[] }) {
    const enregistre: Record<string, unknown>[] = [];
    const prisma = {
      tradingAccount: {
        findFirst: vi.fn().mockResolvedValue({ id: 'a1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      brokerConnection: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue(opts.pris.map((id) => ({ externalAccountId: id }))),
        upsert: vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => {
          enregistre.push(create);
          return Promise.resolve({ id: 'c1', ...create });
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const api = {
      isConfigured: vi.fn().mockReturnValue(true),
      exchangeCode: vi.fn().mockResolvedValue({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 3600 }),
      get: vi.fn().mockImplementation((env: string, path: string) => {
        if (path === '/account/list') return Promise.resolve(env === 'demo' ? opts.comptes : []);
        if (path === '/user/list') return Promise.resolve([{ id: 5751613, name: 'APEX_13679' }]);
        return Promise.resolve([]);
      }),
    };
    const redis = { client: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn() } };
    const service = new TradovateConnectionService(
      prisma as never, api as never, config as never, redis as never,
    );
    const state = signOAuthState({ userId: 'u1', accountId: 'a1', origin: 'settings' }, SECRET);
    return {
      service, prisma, enregistre,
      connecter: () => service.completeAuthorization({ code: 'CODE', state }, state),
    };
  }

  const COMPTE = { id: 40517838, name: 'PAAPEX136790000010' };
  const AUTRE = { id: 40570856, name: 'PAAPEX136790000011' };

  it('seul compte disponible, déjà relié ailleurs → refus explicite, rien n’est enregistré', async () => {
    const { connecter, enregistre } = contexte({ comptes: [COMPTE], pris: ['40517838'] });

    await expect(connecter()).resolves.toMatchObject({
      status: 'error',
      reason: 'account_already_linked',
    });
    expect(enregistre).toHaveLength(0);
  });

  it('plusieurs comptes, un seul pris → le pris n’est ni choisi ni même proposé', async () => {
    const { connecter, enregistre } = contexte({ comptes: [COMPTE, AUTRE], pris: ['40517838'] });

    await connecter();

    // Choix automatique sur le seul compte restant, et la liste stockée ne contient plus l'autre.
    expect(enregistre[0].externalAccountId).toBe('40570856');
    expect(enregistre[0].availableAccounts).toEqual([
      expect.objectContaining({ id: '40570856' }),
    ]);
  });

  it('aucun compte pris → comportement inchangé', async () => {
    const { connecter, enregistre } = contexte({ comptes: [COMPTE], pris: [] });
    await connecter();
    expect(enregistre[0].externalAccountId).toBe('40517838');
  });

  it('la recherche ne regarde que les AUTRES utilisateurs : se reconnecter reste possible', async () => {
    const { connecter, prisma } = contexte({ comptes: [COMPTE], pris: [] });

    await connecter();

    expect(prisma.brokerConnection.findMany).toHaveBeenCalledWith({
      where: {
        provider: 'TRADOVATE',
        userId: { not: 'u1' },
        externalAccountId: { in: ['40517838'] },
      },
      select: { externalAccountId: true },
    });
  });

  it('choix explicite d’un compte pris → erreur nommée, pas une disparition silencieuse', async () => {
    // Ici l'utilisateur a désigné CE compte : il doit savoir pourquoi on le refuse.
    const conn = {
      id: 'c1', userId: 'u1', accountId: 'a1',
      provider: BrokerProvider.TRADOVATE, status: BrokerConnectionStatus.CONNECTED,
      accessTokenEnc: encryptToken('AT-1', key), refreshTokenEnc: encryptToken('RT-1', key),
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000), refreshTokenExpiresAt: null,
      availableAccounts: [{ id: '40517838', name: 'PAAPEX136790000010', env: 'demo' }],
    } as unknown as BrokerConnection;
    const prisma = {
      brokerConnection: {
        findFirst: vi.fn().mockResolvedValue(conn),
        findMany: vi.fn().mockResolvedValue([{ externalAccountId: '40517838' }]),
        update: vi.fn().mockResolvedValue({}),
      },
      tradingAccount: { update: vi.fn().mockResolvedValue({}) },
    };
    const service = new TradovateConnectionService(
      prisma as never,
      { get: vi.fn().mockResolvedValue([]) } as never,
      config as never,
      { client: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn() } } as never,
    );

    await expect(service.selectAccount('u1', 'a1', '40517838')).rejects.toMatchObject({
      code: 'TRADOVATE_ACCOUNT_ALREADY_LINKED',
    });
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
  });
});
