import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { BrokerConnection } from '@prisma/client';
import { decryptToken } from '@api/common/utils/token-cipher.util';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateConnectionService } from './tradovate-connection.service';
import { signOAuthState } from './oauth-state.util';

/**
 * Connexion OAuth de bout en bout sur un compte d'évaluation dont l'hôte demo est DÉDIÉ (forme
 * « apex »). Vrai `TradovateApiClient`, seul `fetch` est simulé : on vérifie les URL réellement
 * appelées. `/auth/oauthtoken` ne porte pas `apiHosts` → `renewAccessToken` (sur live) les donne,
 * la liste des comptes part sur l'hôte dédié, et c'est lui qui est enregistré.
 */
const HOTES = {
  live: 'live.tradovateapi.com',
  demo: 'apex-demo.tradovateapi.com',
  reportingLive: 'rpt-live.tradovateapi.com',
  reportingDemo: 'apex-rpt-demo.tradovateapi.com',
};
const COMPTE = { id: 90000010, name: 'PAAPEX100000000010', userId: 699523 };
const TRADER = [{ id: 9100001, name: 'APEX_10000' }];

describe('Connexion OAuth Tradovate — hôte demo dédié (prop firm)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const key = randomBytes(32);
    const SECRET = 'secret-de-test';
    const env: Record<string, string> = {
      TRADOVATE_OAUTH_CLIENT_ID: 'cid',
      TRADOVATE_OAUTH_CLIENT_SECRET: 'secret',
      TRADOVATE_OAUTH_REDIRECT_URI: 'https://api.example/tradovate/callback',
      BROKER_TOKEN_ENCRYPTION_KEY: key.toString('base64'),
      JWT_SECRET: SECRET,
    };
    const config = { get: (k: string) => env[k] };

    const appels: { url: string; auth: string | null }[] = [];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = String(input);
      const auth = new Headers(init.headers).get('authorization');
      appels.push({ url, auth });
      if (url === 'https://live.tradovateapi.com/auth/oauthtoken') {
        // Réponse réelle : pas d'`apiHosts`.
        return json({ access_token: 'AT-OAUTH', refresh_token: 'RT-1', expires_in: 4800 });
      }
      if (url === 'https://live.tradovateapi.com/v1/auth/renewaccesstoken') {
        return json({
          accessToken: 'AT-RENEW',
          expirationTime: new Date(Date.now() + 80 * 60_000).toISOString(),
          apiHosts: HOTES,
        });
      }
      if (url === 'https://live.tradovateapi.com/v1/account/list') return json([]);
      if (url === 'https://apex-demo.tradovateapi.com/v1/account/list') return json([COMPTE]);
      if (url === 'https://apex-demo.tradovateapi.com/v1/user/list') return json(TRADER);
      // Hôte demo historique : ne répond plus pour cette organisation.
      return new Response(null, { status: 421 });
    }));

    const enregistre: Record<string, unknown>[] = [];
    const prisma = {
      tradingAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'a1' }), update: vi.fn() },
      brokerConnection: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => {
          enregistre.push(create);
          return Promise.resolve({ id: 'c1', ...create } as BrokerConnection);
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const redis = { client: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn() } };
    const api = new TradovateApiClient(config as never);
    const service = new TradovateConnectionService(prisma as never, api, config as never, redis as never);
    const state = signOAuthState({ userId: 'u1', accountId: 'a1', origin: 'settings' }, SECRET);
    const connecter = () => service.completeAuthorization({ code: 'CODE', state }, state);
    return { connecter, appels, enregistre, key };
  }

  it('hôtes lus par renewAccessToken, comptes listés sur l’hôte dédié, hôte dédié enregistré', async () => {
    const { connecter, appels, enregistre, key } = setup();

    await expect(connecter()).resolves.toMatchObject({ status: 'select_account', accountId: 'a1' });

    const urls = appels.map((a) => a.url);
    // exchangeWithHosts : échange du code, PUIS hôtes lus avant toute liste de comptes.
    expect(urls.slice(0, 2)).toEqual([
      'https://live.tradovateapi.com/auth/oauthtoken',
      'https://live.tradovateapi.com/v1/auth/renewaccesstoken',
    ]);
    expect(appels[1].auth).toBe('Bearer AT-OAUTH');
    // discoverAccounts : hôte demo DÉDIÉ, avec le jeton renouvelé ; jamais l'hôte historique.
    expect(appels).toContainEqual({ url: 'https://apex-demo.tradovateapi.com/v1/account/list', auth: 'Bearer AT-RENEW' });
    expect(urls.some((u) => u.includes('://demo.tradovateapi.com'))).toBe(false);

    expect(enregistre).toHaveLength(1);
    const saved = enregistre[0];
    expect(saved.apiHosts).toEqual(HOTES);
    expect(saved.apiHostsAt).toBeInstanceOf(Date);
    expect(saved.availableAccounts).toEqual([
      { id: '90000010', name: 'PAAPEX100000000010', env: 'demo', userId: '699523' },
    ]);
    expect(saved.externalUserId).toBe('9100001');
    // Jeton stocké = celui que les hôtes accompagnent (le renouvelé), pas celui de l'échange.
    expect(decryptToken(saved.accessTokenEnc as string, key)).toBe('AT-RENEW');
  });
});
